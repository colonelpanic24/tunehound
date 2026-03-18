import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ImportResult, Stats } from "@/types";

const BASE = "/api";

async function* consumeSSE(response: Response): AsyncGenerator<unknown> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try { yield JSON.parse(line.slice(6)); } catch {} // eslint-disable-line no-empty
      }
    }
  }
}

export type ImportPhase = "idle" | "scanning" | "importing" | "linking" | "done";

export interface ImportLogEntry {
  type: "imported" | "skipped" | "error";
  label: string;
  albumCount?: number;
}

export interface NeedsReviewItem {
  folder: string;
  candidates: import("@/types").MBArtistCandidate[];
}

export interface ImportState {
  phase: ImportPhase;
  scanDone: number;
  scanTotal: number;
  importDone: number;
  importTotal: number;
  currentStep: string | null;
  log: ImportLogEntry[];
  finalResult: ImportResult | null;
  error: string | null;
  needsReview: NeedsReviewItem[];
}

const INITIAL: ImportState = {
  phase: "idle",
  scanDone: 0,
  scanTotal: 0,
  importDone: 0,
  importTotal: 0,
  currentStep: null,
  log: [],
  finalResult: null,
  error: null,
  needsReview: [],
};

interface ImportContextValue {
  state: ImportState;
  startScan: () => void;
  clearAll: () => Promise<void>;
  reset: () => void;
  importReviewItem: (folder: string, mbid: string) => Promise<void>;
  skipReviewItem: (folder: string) => void;
}

const ImportContext = createContext<ImportContextValue | null>(null);

export function ImportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportState>(INITIAL);
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);

  const startScan = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    let threshold = 80;
    try {
      const settingsRes = await fetch(`${BASE}/downloads/settings`);
      if (settingsRes.ok) {
        const s = await settingsRes.json();
        threshold = s.scan_min_confidence ?? 80;
      }
    } catch {} // eslint-disable-line no-empty

    setState({ ...INITIAL, phase: "scanning" });

    try {
      const res = await fetch(`${BASE}/library/scan`, { signal: abort.signal });
      if (!res.ok) throw new Error(`Scan failed: ${res.status}`);

      const artists: { mbid: string; folder: string }[] = [];
      for await (const raw of consumeSSE(res)) {
        if (abort.signal.aborted) return;
        const e = raw as Record<string, unknown>;
        if (e.type === "start") {
          setState(s => ({ ...s, scanTotal: e.total as number }));
        } else if (e.type === "result") {
          const cands = e.candidates as { mbid: string; score: number; name: string; sort_name: string; disambiguation: string | null }[];
          if (cands[0]?.score >= threshold) {
            artists.push({ mbid: cands[0].mbid, folder: e.folder as string });
          } else if (cands.length > 0) {
            setState(s => ({ ...s, needsReview: [...s.needsReview, { folder: e.folder as string, candidates: cands }] }));
          }
          setState(s => ({ ...s, scanDone: e.done as number }));
        }
      }

      if (!artists.length) {
        setState(s => ({ ...s, phase: "done" }));
        return;
      }

      setState(s => ({ ...s, phase: "importing", importTotal: artists.length }));

      const importRes = await fetch(`${BASE}/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artists }),
        signal: abort.signal,
      });
      if (!importRes.ok) throw new Error(`Import failed: ${importRes.status}`);

      for await (const raw of consumeSSE(importRes)) {
        if (abort.signal.aborted) return;
        const e = raw as Record<string, unknown>;
        if (e.type === "step") {
          const step = e.step as string;
          const name = (e.name ?? e.mbid) as string;
          const label =
            step === "artist_info" ? `${name} — fetching artist info` :
            step === "albums"      ? `${name} — fetching album list` :
            step === "cover_art"   ? `${name} — fetching cover art (${e.album_count} albums)` :
            step === "tracks"      ? `${name} — fetching track listings` :
            `${name} — ${step}`;
          setState(s => ({ ...s, currentStep: label }));
        } else if (e.type === "imported") {
          const albumCount = e.album_count as number | undefined;
          setState(s => ({ ...s, importDone: e.done as number, currentStep: null, log: [...s.log, { type: "imported", label: e.name as string, albumCount }] }));
          queryClient.setQueryData<Stats>(["stats"], (old) =>
            old ? { ...old, artists: old.artists + 1, albums: old.albums + (albumCount ?? 0) } : old
          );
        } else if (e.type === "skipped") {
          setState(s => ({ ...s, importDone: e.done as number, currentStep: null, log: [...s.log, { type: "skipped", label: e.mbid as string }] }));
        } else if (e.type === "error") {
          setState(s => ({ ...s, importDone: e.done as number, currentStep: null, log: [...s.log, { type: "error", label: `${e.mbid}: ${e.error}` }] }));
        } else if (e.type === "linking") {
          setState(s => ({ ...s, phase: "linking" }));
        } else if (e.type === "done") {
          setState(s => ({ ...s, phase: "done", finalResult: e.result as ImportResult }));
          queryClient.invalidateQueries({ queryKey: ["artists"] });
          queryClient.invalidateQueries({ queryKey: ["stats"] });
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setState(s => ({ ...s, phase: "idle", error: err instanceof Error ? err.message : "Failed" }));
    }
  }, [queryClient]);

  const clearAll = useCallback(async () => {
    await fetch(`${BASE}/library/artists`, { method: "DELETE" });
    queryClient.invalidateQueries({ queryKey: ["artists"] });
    queryClient.invalidateQueries({ queryKey: ["stats"] });
    queryClient.invalidateQueries({ queryKey: ["library-missing"] });
    queryClient.invalidateQueries({ queryKey: ["library-missing-count"] });
    queryClient.invalidateQueries({ queryKey: ["library-orphaned"] });
    queryClient.invalidateQueries({ queryKey: ["download-jobs"] });
    setState(INITIAL);
  }, [queryClient]);

  const reset = useCallback(() => setState(INITIAL), []);

  const skipReviewItem = useCallback((folder: string) => {
    setState(s => ({ ...s, needsReview: s.needsReview.filter(i => i.folder !== folder) }));
  }, []);

  const importReviewItem = useCallback(async (folder: string, mbid: string) => {
    setState(s => ({ ...s, needsReview: s.needsReview.filter(i => i.folder !== folder) }));
    try {
      const res = await fetch(`${BASE}/library/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artists: [{ mbid, folder }] }),
      });
      if (!res.ok) return;
      for await (const raw of consumeSSE(res)) {
        const e = raw as Record<string, unknown>;
        if (e.type === "imported") {
          const albumCount = e.album_count as number | undefined;
          setState(s => ({ ...s, log: [...s.log, { type: "imported", label: e.name as string, albumCount }] }));
          queryClient.setQueryData<Stats>(["stats"], (old) =>
            old ? { ...old, artists: old.artists + 1, albums: old.albums + (albumCount ?? 0) } : old
          );
          queryClient.invalidateQueries({ queryKey: ["artists"] });
        }
      }
    } catch {} // eslint-disable-line no-empty
  }, [queryClient]);

  return (
    <ImportContext.Provider value={{ state, startScan, clearAll, reset, importReviewItem, skipReviewItem }}>
      {children}
    </ImportContext.Provider>
  );
}

export function useImport() {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error("useImport must be used within ImportProvider");
  return ctx;
}
