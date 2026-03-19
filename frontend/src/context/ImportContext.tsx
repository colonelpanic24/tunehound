import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWebSocketMessage } from "@/context/WebSocketContext";
import type { Stats, WSMessage } from "@/types";

const BASE = "/api";

export type ImportPhase = "idle" | "scanning" | "done";

export interface ImportLogEntry {
  type: "imported" | "skipped" | "error" | "needs_review";
  label: string;
  albumCount?: number;
}

export interface NeedsReviewItem {
  folder: string;
  candidates: import("@/types").MBArtistCandidate[];
}

export interface ScanSummary {
  artistsImported: number;
  albumsImported: number;
  filesLinked: number;
  needsReviewCount: number;
  elapsedSeconds: number;
}

export interface ImportState {
  phase: ImportPhase;
  scanDone: number;
  scanTotal: number;
  importDone: number;
  importTotal: number;
  currentStep: string | null;
  log: ImportLogEntry[];
  summary: ScanSummary | null;
  error: string | null;
  needsReview: NeedsReviewItem[];
}

interface ImportContextValue {
  state: ImportState;
  startScan: () => Promise<void>;
  clearAll: () => Promise<void>;
  reset: () => void;
  importReviewItem: (folder: string, mbid: string) => Promise<void>;
  skipReviewItem: (folder: string) => void;
}

const INITIAL: ImportState = {
  phase: "idle",
  scanDone: 0,
  scanTotal: 0,
  importDone: 0,
  importTotal: 0,
  currentStep: null,
  log: [],
  summary: null,
  error: null,
  needsReview: [],
};

// Convert snake_case log entry from API to camelCase
function mapLogEntry(raw: { type: string; label: string; album_count?: number }): ImportLogEntry {
  return {
    type: raw.type as ImportLogEntry["type"],
    label: raw.label,
    albumCount: raw.album_count,
  };
}

// Convert full backend state (snake_case) to frontend ImportState
function mapBackendState(raw: Record<string, unknown>): ImportState {
  const rawLog = (raw.log as { type: string; label: string; album_count?: number }[]) ?? [];
  const rawNR = (raw.needs_review as { folder: string; candidates: import("@/types").MBArtistCandidate[] }[]) ?? [];
  const rawSummary = raw.summary as {
    artists_imported: number;
    albums_imported: number;
    files_linked: number;
    needs_review_count: number;
    elapsed_seconds: number;
  } | null;

  return {
    phase: (raw.phase as ImportPhase) ?? "idle",
    scanDone: (raw.scan_done as number) ?? 0,
    scanTotal: (raw.scan_total as number) ?? 0,
    importDone: (raw.import_done as number) ?? 0,
    importTotal: (raw.import_total as number) ?? 0,
    currentStep: (raw.current_step as string | null) ?? null,
    log: rawLog.map(mapLogEntry),
    needsReview: rawNR,
    error: (raw.error as string | null) ?? null,
    summary: rawSummary
      ? {
          artistsImported: rawSummary.artists_imported,
          albumsImported: rawSummary.albums_imported,
          filesLinked: rawSummary.files_linked,
          needsReviewCount: rawSummary.needs_review_count,
          elapsedSeconds: rawSummary.elapsed_seconds,
        }
      : null,
  };
}

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

const ImportContext = createContext<ImportContextValue | null>(null);

export function ImportProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ImportState>(INITIAL);
  const queryClient = useQueryClient();

  // Hydrate state from backend on mount
  useEffect(() => {
    fetch(`${BASE}/library/scan-job`)
      .then((r) => r.ok ? r.json() : null)
      .then((raw) => {
        if (raw) setState(mapBackendState(raw as Record<string, unknown>));
      })
      .catch(() => {});
  }, []);

  // WebSocket-driven updates
  useWebSocketMessage((msg: WSMessage) => {
    switch (msg.type) {
      case "scan_started":
        setState((s) => ({
          ...s,
          phase: "scanning",
          scanTotal: msg.total,
          scanDone: 0,
          importDone: 0,
          importTotal: 0,
          log: [],
          needsReview: [],
          summary: null,
          error: null,
          currentStep: null,
        }));
        break;

      case "scan_progress":
        setState((s) => ({
          ...s,
          scanDone: msg.scan_done,
          scanTotal: msg.scan_total,
          importDone: msg.import_done,
          importTotal: msg.import_total,
          currentStep: msg.current_step,
        }));
        break;

      case "scan_log":
        setState((s) => ({
          ...s,
          log: [...s.log, mapLogEntry(msg.entry)],
        }));
        // Optimistically update stats counter when an artist is successfully imported
        if (msg.entry.type === "imported") {
          queryClient.setQueryData<Stats>(["stats"], (old) =>
            old
              ? {
                  ...old,
                  artists: old.artists + 1,
                  albums: old.albums + (msg.entry.album_count ?? 0),
                }
              : old
          );
        }
        break;

      case "scan_done":
        setState((s) => ({
          ...s,
          phase: "done",
          currentStep: null,
          summary: {
            artistsImported: msg.summary.artists_imported,
            albumsImported: msg.summary.albums_imported,
            filesLinked: msg.summary.files_linked,
            needsReviewCount: msg.summary.needs_review_count,
            elapsedSeconds: msg.summary.elapsed_seconds,
          },
        }));
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
        break;

      case "scan_error":
        setState((s) => ({ ...s, phase: "idle", error: msg.error }));
        break;

      case "artist_ready":
        // Refresh the artists list so the new artist appears live
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        break;
    }
  });

  const startScan = useCallback(async () => {
    // Optimistically set scanning state so the UI responds immediately,
    // even if the WS scan_started event hasn't arrived yet.
    setState({
      phase: "scanning",
      scanDone: 0,
      scanTotal: 0,
      importDone: 0,
      importTotal: 0,
      currentStep: null,
      log: [],
      needsReview: [],
      summary: null,
      error: null,
    });
    await fetch(`${BASE}/library/scan-job`, { method: "POST" });
  }, []);

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
    setState((s) => ({
      ...s,
      needsReview: s.needsReview.filter((i) => i.folder !== folder),
    }));
    // Also remove from backend state so it doesn't reappear on refresh
    fetch(`${BASE}/library/scan-job/review-item?folder=${encodeURIComponent(folder)}`, {
      method: "DELETE",
    }).catch(() => {});
  }, []);

  const importReviewItem = useCallback(async (folder: string, mbid: string) => {
    setState((s) => ({
      ...s,
      needsReview: s.needsReview.filter((i) => i.folder !== folder),
    }));
    fetch(`${BASE}/library/scan-job/review-item?folder=${encodeURIComponent(folder)}`, {
      method: "DELETE",
    }).catch(() => {});

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
          setState((s) => ({
            ...s,
            log: [...s.log, { type: "imported", label: e.name as string, albumCount }],
          }));
          queryClient.setQueryData<Stats>(["stats"], (old) =>
            old
              ? { ...old, artists: old.artists + 1, albums: old.albums + (albumCount ?? 0) }
              : old
          );
          queryClient.invalidateQueries({ queryKey: ["artists"] });
        }
      }
    } catch {} // eslint-disable-line no-empty
  }, [queryClient]);

  return (
    <ImportContext.Provider
      value={{ state, startScan, clearAll, reset, importReviewItem, skipReviewItem }}
    >
      {children}
    </ImportContext.Provider>
  );
}

export function useImport() {
  const ctx = useContext(ImportContext);
  if (!ctx) throw new Error("useImport must be used within ImportProvider");
  return ctx;
}
