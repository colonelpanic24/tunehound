import { useState, useEffect, useRef } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ListMusic, HardDrive, Download, Plus, ScanLine, FileAudio, Square, Link, Tag,
} from "lucide-react";
import { getStats, getOrphanedFiles, syncFileLinks, rescanTags } from "@/api/client";
import AddArtistModal from "@/components/AddArtistModal";
import { useImport } from "@/context/ImportContext";
import { ArtistSearchDialog } from "@/components/ArtistSearchDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { OrphanedFile } from "@/types";

type LibTab = "import" | "review" | "orphaned";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [addOpen, setAddOpen] = useState(false);
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [libTab, setLibTab] = useState<LibTab>("import");

  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: getStats, staleTime: 30_000 });

  const { state, startScan, cancelScan, reset, importReviewItem, skipReviewItem } = useImport();
  const { phase, scanDone, scanTotal, importDone, importTotal, currentStep, log, summary, error, needsReview, completedAt } = state;
  const importActive = phase === "scanning";

  const orphanedQuery = useInfiniteQuery({
    queryKey: ["library-orphaned"],
    queryFn: ({ pageParam }) => getOrphanedFiles(pageParam as number, 250),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.offset + 250 : undefined,
    enabled: libTab === "orphaned",
  });

  const downloadActive = (stats?.active_downloads ?? 0) > 0;
  const downloadProgress =
    downloadActive && stats!.download_tracks_total > 0
      ? Math.round((stats!.download_tracks_completed / stats!.download_tracks_total) * 100)
      : 0;

  const orphanTotal = orphanedQuery.data?.pages[0]?.total;

  return (
    <div className="flex flex-col min-h-full">
      {/* Top bar: tabs left, stats + actions right */}
      <div className="border-b border-border px-6 pt-4">
        <div className="flex items-end justify-between">
          <Tabs value={libTab} onValueChange={(v) => setLibTab(v as LibTab)}>
            <TabsList variant="line" className="h-auto gap-0">
              <TabsTrigger value="import" className="px-4 py-3 rounded-none gap-2">
                Import
                {importActive && (
                  <Badge variant="default" className="h-4 px-1.5 text-xs animate-pulse">•</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="review" className="px-4 py-3 rounded-none gap-2">
                Needs Review
                {needsReview.length > 0 && (
                  <Badge
                    variant={libTab === "review" ? "default" : "secondary"}
                    className="h-4 px-1.5 text-xs"
                  >
                    {needsReview.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="orphaned" className="px-4 py-3 rounded-none gap-2">
                Orphaned Files
                {orphanTotal !== undefined && orphanTotal > 0 && (
                  <Badge
                    variant={libTab === "orphaned" ? "default" : "secondary"}
                    className="h-4 px-1.5 text-xs"
                  >
                    {orphanTotal.toLocaleString()}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Inline stats + Add Artist */}
          <div className="flex items-center gap-5 pb-3">
            {stats !== undefined && (
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ListMusic className="w-3.5 h-3.5" />
                  {stats.tracks.toLocaleString()} tracks
                </span>
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  {stats.files_linked.toLocaleString()} files on disk
                </span>
              </div>
            )}
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4" />
              Add Artist
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6 flex-1 space-y-4">
        {folderNotice && (
          <div className="px-4 py-3 rounded-lg bg-muted border border-border text-sm text-foreground flex items-center justify-between gap-4">
            <span>
              Artist folder <span className="font-medium">"{folderNotice}"</span> already exists in your library and has been linked.
            </span>
            <button
              onClick={() => setFolderNotice(null)}
              className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
            >
              ✕
            </button>
          </div>
        )}

        {downloadActive && (
          <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-2.5 max-w-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground flex items-center gap-2">
                <Download className="w-4 h-4 text-primary" />
                Downloading
              </span>
              <button onClick={() => navigate("/downloads")} className="text-xs text-primary hover:underline">
                View all
              </button>
            </div>
            <Progress value={downloadProgress} />
            <p className="text-xs text-muted-foreground">
              {stats!.download_tracks_completed.toLocaleString()} /{" "}
              {stats!.download_tracks_total.toLocaleString()} tracks
            </p>
          </div>
        )}

        {libTab === "import" && (
          <ImportTab
            isActive={importActive}
            phase={phase}
            scanDone={scanDone}
            scanTotal={scanTotal}
            importDone={importDone}
            importTotal={importTotal}
            currentStep={currentStep}
            log={log}
            summary={summary}
            completedAt={completedAt}
            error={error}
            startScan={startScan}
            cancelScan={cancelScan}
            reset={reset}
          />
        )}
        {libTab === "review" && (
          <NeedsReviewTab
            needsReview={needsReview}
            importReviewItem={importReviewItem}
            skipReviewItem={skipReviewItem}
          />
        )}
        {libTab === "orphaned" && <OrphanedTab query={orphanedQuery} />}
      </div>

      {addOpen && (
        <AddArtistModal
          onClose={() => setAddOpen(false)}
          onAdded={(artist) => {
            if (artist.folder_name) setFolderNotice(artist.folder_name);
          }}
        />
      )}
    </div>
  );
}

// ── Import tab ─────────────────────────────────────────────────────────────────

function formatCompletedAt(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return null;
  }
}

function ImportTab({
  isActive, phase, scanDone, scanTotal, importDone, importTotal,
  currentStep, log, summary, completedAt, error, startScan, cancelScan, reset,
}: {
  isActive: boolean;
  phase: string;
  scanDone: number;
  scanTotal: number;
  importDone: number;
  importTotal: number;
  currentStep: string | null;
  log: import("@/context/ImportContext").ImportLogEntry[];
  summary: import("@/context/ImportContext").ScanSummary | null;
  completedAt: string | null;
  error: string | null;
  startScan: () => void;
  cancelScan: () => Promise<void>;
  reset: () => void;
}) {
  const [syncState, setSyncState] = useState<"idle" | "running" | "done">("idle");
  const [syncResult, setSyncResult] = useState<{ artists_processed: number; files_linked: number; files_unlinked: number } | null>(null);
  const [rescanState, setRescanState] = useState<"idle" | "running" | "done">("idle");
  const [rescanResult, setRescanResult] = useState<{ tracks_updated: number } | null>(null);

  const handleSyncFiles = async () => {
    setSyncState("running");
    setSyncResult(null);
    try {
      const result = await syncFileLinks();
      setSyncResult(result);
      setSyncState("done");
    } catch {
      setSyncState("idle");
    }
  };

  const handleRescanTags = async () => {
    setRescanState("running");
    setRescanResult(null);
    try {
      const result = await rescanTags();
      setRescanResult(result);
      setRescanState("done");
    } catch {
      setRescanState("idle");
    }
  };

  return (
    <div className="max-w-2xl space-y-8">

      {/* ── Scan for New Artists ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <ScanLine className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Scan for New Artists</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-1">
          Looks for <strong className="text-foreground">new</strong> top-level folders in your music library and imports them into TuneHound. Artists already in your library are skipped.
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Use this when you've added new artist folders to your music directory.
        </p>

        {isActive ? (
          <Button variant="outline" onClick={cancelScan}>
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop scan
          </Button>
        ) : (
          <div className="flex items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger render={
                  <Button onClick={startScan}>
                    <ScanLine className="w-4 h-4" />
                    {phase === "done" ? "Scan for New Artists" : "Scan Library"}
                  </Button>
                } />
                <TooltipContent side="bottom">
                  Scans top-level folders in your music directory. Already-imported artists are skipped.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {phase === "done" && (
              <Button variant="ghost" onClick={reset}>Clear</Button>
            )}
          </div>
        )}

        {error && <p className="mt-4 text-destructive text-sm">{error}</p>}

        {/* Active scan progress */}
        {phase === "scanning" && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-foreground">
                {scanTotal === 0
                  ? "Discovering folders…"
                  : scanDone < scanTotal
                    ? `Scanning ${scanDone} / ${scanTotal} folders`
                    : importTotal > 0
                      ? `Importing artists…`
                      : "Finalising…"}
              </span>
              {importTotal > 0 && (
                <span className="text-xs text-muted-foreground">
                  {importDone} / {importTotal} imported
                </span>
              )}
            </div>
            {scanTotal > 0 && (
              <Progress value={Math.round((scanDone / scanTotal) * 100)} />
            )}
            {currentStep && (
              <p className="text-xs text-muted-foreground truncate">{currentStep}</p>
            )}
            <ImportLog log={log} />
          </div>
        )}

        {/* Persistent summary after scan */}
        {phase === "done" && summary && (
          <div className="mt-6 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Last scan results</span>
              <div className="flex items-center gap-3">
                {completedAt && (
                  <span className="text-xs text-muted-foreground">{formatCompletedAt(completedAt)}</span>
                )}
                <Button variant="ghost" size="sm" onClick={reset} className="h-6 px-2 text-xs">
                  Clear
                </Button>
              </div>
            </div>
            <ul className="text-sm space-y-0.5 text-muted-foreground">
              <li>
                <span className="text-foreground">{summary.artistsImported}</span> artist{summary.artistsImported !== 1 ? "s" : ""} imported
                {" · "}
                <span className="text-foreground">{summary.albumsImported}</span> album{summary.albumsImported !== 1 ? "s" : ""}
              </li>
              <li><span className="text-foreground">{summary.filesLinked}</span> file{summary.filesLinked !== 1 ? "s" : ""} linked</li>
              {summary.needsReviewCount > 0 && (
                <li className="text-warning">
                  {summary.needsReviewCount} folder{summary.needsReviewCount !== 1 ? "s" : ""} need review — check the Needs Review tab
                </li>
              )}
            </ul>
          </div>
        )}

        {phase === "done" && !summary && (
          <p className="mt-6 text-muted-foreground text-sm">No new artists found.</p>
        )}
      </div>

      <div className="border-t border-border" />

      {/* ── Re-link Files ────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Link className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Re-link Files</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-1">
          Matches audio files on disk to the tracks TuneHound already knows about. Removes broken links for files that no longer exist.
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Use this after downloading new albums for existing artists, renaming files, or deleting tracks.
        </p>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleSyncFiles}
            disabled={syncState === "running"}
          >
            <Link className="w-4 h-4" />
            {syncState === "running" ? "Re-linking…" : "Re-link Files"}
          </Button>
          {syncState === "done" && syncResult && (
            <Button variant="ghost" onClick={() => { setSyncState("idle"); setSyncResult(null); }}>
              Clear
            </Button>
          )}
        </div>

        {syncState === "done" && syncResult && (
          <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-sm font-medium text-foreground mb-1">Re-link complete</p>
            <ul className="text-sm space-y-0.5 text-muted-foreground">
              <li><span className="text-foreground">{syncResult.artists_processed}</span> artist{syncResult.artists_processed !== 1 ? "s" : ""} processed</li>
              <li><span className="text-foreground">{syncResult.files_linked}</span> file{syncResult.files_linked !== 1 ? "s" : ""} linked</li>
              {syncResult.files_unlinked > 0 && (
                <li><span className="text-foreground">{syncResult.files_unlinked}</span> broken link{syncResult.files_unlinked !== 1 ? "s" : ""} cleared</li>
              )}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t border-border" />

      {/* ── Rescan Tags ──────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Tag className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Rescan Tags</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-1">
          Re-reads ID3 / Vorbis tags from every linked file on disk and updates TuneHound's tag snapshots.
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Use this after editing track tags externally (e.g. with beets, MusicBrainz Picard, or a tag editor).
        </p>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={handleRescanTags}
            disabled={rescanState === "running"}
          >
            <Tag className="w-4 h-4" />
            {rescanState === "running" ? "Scanning tags…" : "Rescan Tags"}
          </Button>
          {rescanState === "done" && rescanResult && (
            <Button variant="ghost" onClick={() => { setRescanState("idle"); setRescanResult(null); }}>
              Clear
            </Button>
          )}
        </div>

        {rescanState === "done" && rescanResult && (
          <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
            <p className="text-sm font-medium text-foreground mb-1">Tag rescan complete</p>
            <p className="text-sm text-muted-foreground">
              <span className="text-foreground">{rescanResult.tracks_updated}</span> track{rescanResult.tracks_updated !== 1 ? "s" : ""} updated
            </p>
          </div>
        )}
      </div>

    </div>
  );
}

// ── Orphaned tab ───────────────────────────────────────────────────────────────

function OrphanedTab({ query }: { query: ReturnType<typeof useInfiniteQuery> }) {
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    query as ReturnType<typeof useInfiniteQuery<import("@/types").OrphanedFilePage>>;

  const [relinkState, setRelinkState] = useState<"idle" | "running" | "done">("idle");
  const [relinkResult, setRelinkResult] = useState<{ files_linked: number; files_unlinked: number } | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!isLoading) return;
    startRef.current = Date.now();
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [isLoading]);

  const handleRelink = async () => {
    setRelinkState("running");
    setRelinkResult(null);
    try {
      const result = await syncFileLinks();
      setRelinkResult(result);
      setRelinkState("done");
    } catch {
      setRelinkState("idle");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">
          Walking music library… <span className="tabular-nums">{elapsed}s</span>
        </p>
        <p className="text-xs text-muted-foreground/60">
          This walks every file on disk — can take a while for large libraries.
        </p>
      </div>
    );
  }

  const total = data?.pages[0]?.total ?? 0;
  const files: OrphanedFile[] = data?.pages.flatMap((p) => p.items) ?? [];

  // Group by top-level folder (first path segment)
  const groups = files.reduce<Record<string, OrphanedFile[]>>((acc, file) => {
    const folder = file.relative_path.split("/")[0] ?? "—";
    if (!acc[folder]) acc[folder] = [];
    acc[folder].push(file);
    return acc;
  }, {});

  return (
    <div className="max-w-2xl space-y-5">
      {/* Action bar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            {total > 0
              ? <>{total.toLocaleString()} file{total !== 1 ? "s" : ""} on disk not linked to any track.</>
              : "No orphaned files found."}
          </p>
          {total > 0 && (
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              Most orphaned files are new albums for existing artists. Try re-linking first.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRelink}
            disabled={relinkState === "running"}
          >
            <Link className="w-3.5 h-3.5" />
            {relinkState === "running" ? "Re-linking…" : "Re-link Files"}
          </Button>
        </div>
      </div>

      {relinkState === "done" && relinkResult && (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm">
          <span className="font-medium text-foreground">{relinkResult.files_linked}</span>
          <span className="text-muted-foreground"> file{relinkResult.files_linked !== 1 ? "s" : ""} linked</span>
          {relinkResult.files_unlinked > 0 && (
            <>
              <span className="text-muted-foreground"> · </span>
              <span className="font-medium text-foreground">{relinkResult.files_unlinked}</span>
              <span className="text-muted-foreground"> broken link{relinkResult.files_unlinked !== 1 ? "s" : ""} cleared</span>
            </>
          )}
          {relinkResult.files_linked === 0 && relinkResult.files_unlinked === 0 && (
            <span className="text-muted-foreground"> — no changes. Remaining files can't be matched to known tracks.</span>
          )}
        </div>
      )}

      {/* Grouped file list */}
      {Object.entries(groups).map(([folder, folderFiles]) => (
        <div key={folder}>
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-xs font-semibold text-foreground">{folder}</p>
            <span className="text-xs text-muted-foreground">
              {folderFiles.length} file{folderFiles.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="space-y-0.5">
            {folderFiles.map((file) => (
              <div key={file.path} className="flex items-center gap-3 px-3 py-1.5 rounded-md hover:bg-muted/50">
                <FileAudio className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{file.filename}</p>
                  {file.relative_path.split("/").length > 2 && (
                    <p className="text-xs text-muted-foreground truncate">
                      {file.relative_path.split("/").slice(1, -1).join("/")}
                    </p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                  {formatBytes(file.size_bytes)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {hasNextPage && (
        <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage
            ? "Loading…"
            : `Load more (${(total - files.length).toLocaleString()} remaining)`}
        </Button>
      )}
    </div>
  );
}

// ── Needs Review tab ───────────────────────────────────────────────────────────

function NeedsReviewTab({
  needsReview,
  importReviewItem,
  skipReviewItem,
}: {
  needsReview: import("@/context/ImportContext").NeedsReviewItem[];
  importReviewItem: (folder: string, mbid: string) => Promise<void>;
  skipReviewItem: (folder: string) => void;
}) {
  if (needsReview.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No folders need review right now.
      </p>
    );
  }

  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-sm text-muted-foreground">
        These folders were found during the last scan but couldn't be matched with enough confidence.
        Review each one and either import it as the suggested artist or search for the correct match.
      </p>
      {needsReview.map((item) => (
        <NeedsReviewCard
          key={item.folder}
          item={item}
          onImport={importReviewItem}
          onSkip={skipReviewItem}
        />
      ))}
    </div>
  );
}

// ── Folder rename helper ───────────────────────────────────────────────────────

function toExpectedFolderName(artistName: string): string {
  // Mirror the Python _safe() function in downloader.py
  // eslint-disable-next-line no-control-regex
  return artistName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^[.\s]+|[.\s]+$/g, "");
}

// ── NeedsReviewCard ────────────────────────────────────────────────────────────

interface RenamePrompt {
  mbid: string;
  currentFolder: string;
  suggestedFolder: string;
}

function NeedsReviewCard({
  item, onImport, onSkip,
}: {
  item: import("@/context/ImportContext").NeedsReviewItem;
  onImport: (folder: string, mbid: string) => Promise<void>;
  onSkip: (folder: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renamePrompt, setRenamePrompt] = useState<RenamePrompt | null>(null);
  const top = item.candidates[0];

  const handleImport = async (mbid: string, artistName: string) => {
    setSearchOpen(false);
    const suggested = toExpectedFolderName(artistName);
    if (suggested !== item.folder) {
      setRenamePrompt({ mbid, currentFolder: item.folder, suggestedFolder: suggested });
      return;
    }
    setImporting(true);
    await onImport(item.folder, mbid);
  };

  const handleRenameChoice = async (rename: boolean) => {
    if (!renamePrompt) return;
    const { mbid, currentFolder, suggestedFolder } = renamePrompt;
    setRenamePrompt(null);
    setImporting(true);
    if (rename) {
      try {
        await fetch("/api/library/rename-folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ old_name: currentFolder, new_name: suggestedFolder }),
        });
        await onImport(suggestedFolder, mbid);
      } catch {
        await onImport(currentFolder, mbid);
      }
    } else {
      await onImport(currentFolder, mbid);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/60 border border-border">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{item.folder}</p>
          {top && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Best match: <span className="text-foreground">{top.name}</span>
              {top.disambiguation && (
                <span className="text-muted-foreground"> · {top.disambiguation}</span>
              )}
              <span className="ml-1 text-warning">{top.score}% confidence</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {top && (
            <Button
              size="sm"
              variant="outline"
              disabled={importing}
              onClick={() => handleImport(top.mbid, top.name)}
            >
              {importing ? "Importing…" : `Import as ${top.name}`}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSearchOpen(true)}>Search…</Button>
          <Button size="sm" variant="ghost" onClick={() => onSkip(item.folder)} className="text-muted-foreground">
            Skip
          </Button>
        </div>
      </div>

      <ArtistSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initialQuery={item.folder}
        title={`Find artist for "${item.folder}"`}
        onConfirm={(mbid, name) => handleImport(mbid, name)}
      />

      {renamePrompt && (
        <Dialog open onOpenChange={(o) => { if (!o) setRenamePrompt(null); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Rename folder before importing?</DialogTitle>
            </DialogHeader>
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                This artist would match better with the canonical folder name.
              </p>
              <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5 font-mono text-xs space-y-1">
                <p><span className="text-muted-foreground">Current: </span><span className="text-foreground">{renamePrompt.currentFolder}</span></p>
                <p><span className="text-muted-foreground">Suggested: </span><span className="text-foreground">{renamePrompt.suggestedFolder}</span></p>
              </div>
            </div>
            <DialogFooter>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<Button variant="outline" onClick={() => handleRenameChoice(false)}>No, keep as is</Button>} />
                  <TooltipContent side="bottom">
                    Your directory won't be changed, but you'll have this matching issue if you ever clear and rescan your library.
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger render={<Button onClick={() => handleRenameChoice(true)}>Yes, rename</Button>} />
                  <TooltipContent side="bottom">
                    This will rename the folder on disk but won't change any music files inside it.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ── Import log ─────────────────────────────────────────────────────────────────

function ImportLog({ log }: { log: import("@/context/ImportContext").ImportLogEntry[] }) {
  if (!log.length) return null;
  return (
    <ScrollArea className="max-h-52 mt-2">
      <div className="space-y-0.5">
        {log.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-sm py-0.5">
            <span className={cn(
              entry.type === "imported"     ? "text-success" :
              entry.type === "skipped"      ? "text-muted-foreground" :
              entry.type === "needs_review" ? "text-warning" :
              "text-destructive"
            )}>
              {entry.type === "imported" ? "✓" : entry.type === "skipped" ? "–" : entry.type === "needs_review" ? "⚠" : "✗"}
            </span>
            <span className={cn(
              "flex-1",
              entry.type === "imported"     ? "text-foreground" :
              entry.type === "skipped"      ? "text-muted-foreground/50" :
              entry.type === "needs_review" ? "text-warning/80" :
              "text-destructive"
            )}>
              {entry.type === "needs_review" ? `${entry.label} — needs review` : entry.label}
            </span>
            {entry.albumCount !== undefined && (
              <span className="text-xs text-muted-foreground shrink-0">
                {entry.albumCount} album{entry.albumCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
