import { useState, useEffect } from "react";
import { HardDrive, ScanLine, FileAudio, Square } from "lucide-react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useImport } from "@/context/ImportContext";
import { ArtistSearchDialog } from "@/components/ArtistSearchDialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getMissingAlbums, getOrphanedFiles } from "@/api/client";
import type { MissingAlbum, OrphanedFile } from "@/types";
import AlbumCard from "@/components/AlbumCard";

type Tab = "import" | "missing" | "orphaned";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function LibraryPage() {
  const { state, startScan, cancelScan, clearAll, reset, importReviewItem, skipReviewItem } = useImport();
  const { phase, scanDone, scanTotal, importDone, importTotal, currentStep, log, summary, error, needsReview } = state;
  const isActive = phase === "scanning";

  const [tab, setTab] = useState<Tab>("import");

  const missingQuery = useQuery({
    queryKey: ["library-missing"],
    queryFn: getMissingAlbums,
    staleTime: 2 * 60 * 1000,
  });

  const orphanedQuery = useInfiniteQuery({
    queryKey: ["library-orphaned"],
    queryFn: ({ pageParam }) => getOrphanedFiles(pageParam, 250),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.offset + 250 : undefined,
    enabled: tab === "orphaned",
  });

  return (
    <div className="flex flex-col min-h-full">
      {/* Header + tabs */}
      <div className="border-b border-border px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3 mb-4">
          <HardDrive className="w-6 h-6 text-primary" />
          Library
        </h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line" className="h-auto gap-0">
            <TabsTrigger value="import" className="px-4 py-3 rounded-none">
              Import
            </TabsTrigger>
            <TabsTrigger value="missing" className="px-4 py-3 rounded-none gap-2">
              Missing
              {missingQuery.data !== undefined && (
                <Badge
                  variant={tab === "missing" ? "default" : "secondary"}
                  className="h-4 px-1.5 text-xs"
                >
                  {missingQuery.data.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orphaned" className="px-4 py-3 rounded-none gap-2">
              Orphaned
              {orphanedQuery.data && (
                <Badge
                  variant={tab === "orphaned" ? "default" : "secondary"}
                  className="h-4 px-1.5 text-xs"
                >
                  {orphanedQuery.data.pages[0].total.toLocaleString()}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      <div className="p-6 flex-1">
        {tab === "import" && (
          <ImportTab
            isActive={isActive}
            phase={phase}
            scanDone={scanDone}
            scanTotal={scanTotal}
            importDone={importDone}
            importTotal={importTotal}
            currentStep={currentStep}
            log={log}
            summary={summary}
            error={error}
            needsReview={needsReview}
            startScan={startScan}
            cancelScan={cancelScan}
            clearAll={clearAll}
            reset={reset}
            importReviewItem={importReviewItem}
            skipReviewItem={skipReviewItem}
          />
        )}
        {tab === "missing" && <MissingTab missingQuery={missingQuery} />}
        {tab === "orphaned" && <OrphanedTab query={orphanedQuery} />}
      </div>
    </div>
  );
}

// ── Import tab ─────────────────────────────────────────────────────────────────

function ImportTab({
  isActive, phase, scanDone, scanTotal, importDone, importTotal,
  currentStep, log, summary, error, needsReview, startScan, cancelScan, clearAll, reset,
  importReviewItem, skipReviewItem,
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
  error: string | null;
  needsReview: import("@/context/ImportContext").NeedsReviewItem[];
  startScan: () => void;
  cancelScan: () => Promise<void>;
  clearAll: () => Promise<void>;
  reset: () => void;
  importReviewItem: (folder: string, mbid: string) => Promise<void>;
  skipReviewItem: (folder: string) => void;
}) {
  const [summaryVisible, setSummaryVisible] = useState(false);

  useEffect(() => {
    if (phase === "done" && summary) {
      const show = setTimeout(() => setSummaryVisible(true), 0);
      const hide = setTimeout(() => setSummaryVisible(false), 12000);
      return () => { clearTimeout(show); clearTimeout(hide); };
    }
  }, [phase, summary]);

  return (
    <div className="max-w-2xl">
      <p className="text-muted-foreground mb-6">
        Scan your music directory to discover and import artists automatically.
      </p>

      {isActive && (
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={cancelScan}>
            <Square className="w-3.5 h-3.5 fill-current" />
            Stop scan
          </Button>
        </div>
      )}

      {!isActive && (
        <div className="flex items-center gap-3">
          <Button onClick={startScan}>
            <ScanLine className="w-4 h-4" />
            {phase === "done" ? "Scan Again" : "Scan Library"}
          </Button>
          {phase === "done" && (
            <Button variant="ghost" onClick={reset}>
              Clear
            </Button>
          )}
          <Button variant="destructive" onClick={clearAll} className="ml-auto">
            Clear All Artists
          </Button>
        </div>
      )}

      {error && <p className="mt-4 text-destructive text-sm">{error}</p>}

      {needsReview.length > 0 && (
        <div className="mt-6 space-y-3">
          <p className="text-sm font-medium text-foreground">
            Needs Review
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {needsReview.length} folder{needsReview.length !== 1 ? "s" : ""} below confidence threshold
            </span>
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
      )}

      {phase === "scanning" && (
        <div className="mt-6 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground">
              {scanTotal === 0
                ? "Discovering folders…"
                : `Scanning ${scanDone} / ${scanTotal} folders`}
            </span>
            {importTotal > 0 && (
              <span className="text-xs text-muted-foreground">
                {importDone} / {importTotal} artists imported
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

      {phase === "done" && summaryVisible && summary && (
        <div className="mt-6 rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Library scan complete</span>
            <span className="text-xs text-muted-foreground">{formatElapsed(summary.elapsedSeconds)}</span>
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
                {summary.needsReviewCount} folder{summary.needsReviewCount !== 1 ? "s" : ""} need review
              </li>
            )}
          </ul>
        </div>
      )}

      {phase === "done" && !summary && (
        <p className="mt-6 text-muted-foreground text-sm">No new artists found.</p>
      )}
    </div>
  );
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Missing tab ────────────────────────────────────────────────────────────────

function MissingTab({ missingQuery }: { missingQuery: ReturnType<typeof useQuery> }) {
  const { data, isLoading } = missingQuery as ReturnType<typeof useQuery<MissingAlbum[]>>;

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 max-w-5xl">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="animate-pulse">
            <div className="aspect-square bg-muted rounded-xl" />
            <div className="h-4 bg-muted rounded mt-2" />
          </div>
        ))}
      </div>
    );
  }

  if (!data || data.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing missing — you have everything!</p>;
  }

  // Group by artist
  const byArtist = data.reduce<Record<string, MissingAlbum[]>>((acc, item) => {
    const key = `${item.artist_id}:${item.artist_name}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-8 max-w-5xl">
      {Object.entries(byArtist).map(([key, albums]) => {
        const artistName = key.split(":").slice(1).join(":");
        return (
          <section key={key}>
            <div className="flex items-baseline gap-2 mb-3">
              <h2 className="text-sm font-semibold text-foreground">{artistName}</h2>
              <span className="text-xs text-muted-foreground">
                {albums.length} album{albums.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {albums.map((item) => (
                <AlbumCard
                  key={item.release_group.id}
                  album={
                    item.tracks_fetched
                      ? item.release_group
                      : { ...item.release_group, track_count: 0 }
                  }
                  artistName={item.artist_name}
                  onDisk={false}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Orphaned tab ───────────────────────────────────────────────────────────────

function OrphanedTab({ query }: { query: ReturnType<typeof useInfiniteQuery> }) {
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    query as ReturnType<typeof useInfiniteQuery<import("@/types").OrphanedFilePage>>;

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Scanning…</p>;
  }

  const total = data?.pages[0]?.total ?? 0;
  const files: OrphanedFile[] = data?.pages.flatMap((p) => p.items) ?? [];

  if (files.length === 0) {
    return <p className="text-muted-foreground text-sm">No orphaned files found.</p>;
  }

  return (
    <div className="max-w-2xl">
      <p className="text-xs text-muted-foreground mb-4">
        {total.toLocaleString()} audio file{total !== 1 ? "s" : ""} on disk not linked to any track in the database.
      </p>
      <div className="space-y-1">
        {files.map((file) => (
          <div
            key={file.path}
            className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50"
          >
            <FileAudio className="w-4 h-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">{file.filename}</p>
              <p className="text-xs text-muted-foreground truncate">
                {file.relative_path.split("/").slice(0, -1).join("/")}
              </p>
            </div>
            <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
              {formatBytes(file.size_bytes)}
            </span>
          </div>
        ))}
      </div>
      {hasNextPage && (
        <div className="mt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage
              ? "Loading…"
              : `Load more (${(total - files.length).toLocaleString()} remaining)`}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── NeedsReviewCard ────────────────────────────────────────────────────────────

function NeedsReviewCard({
  item,
  onImport,
  onSkip,
}: {
  item: import("@/context/ImportContext").NeedsReviewItem;
  onImport: (folder: string, mbid: string) => Promise<void>;
  onSkip: (folder: string) => void;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const top = item.candidates[0];

  const handleImport = async (mbid: string) => {
    setImporting(true);
    setSearchOpen(false);
    await onImport(item.folder, mbid);
  };

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-muted/60 border border-border">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{item.folder}</p>
          {top && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Best match:{" "}
              <span className="text-foreground">{top.name}</span>
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
              onClick={() => handleImport(top.mbid)}
            >
              {importing ? "Importing…" : `Import as ${top.name}`}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSearchOpen(true)}>
            Search…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSkip(item.folder)}
            className="text-muted-foreground"
          >
            Skip
          </Button>
        </div>
      </div>
      <ArtistSearchDialog
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initialQuery={item.folder}
        title={`Find artist for "${item.folder}"`}
        onConfirm={(mbid) => handleImport(mbid)}
      />
    </>
  );
}

// ── Import log (shared) ────────────────────────────────────────────────────────

function ImportLog({ log }: { log: import("@/context/ImportContext").ImportLogEntry[] }) {
  if (!log.length) return null;
  return (
    <ScrollArea className="max-h-52 mt-2">
      <div className="space-y-0.5">
        {log.map((entry, i) => (
          <div key={i} className="flex items-center gap-2 text-sm py-0.5">
            <span
              className={cn(
                entry.type === "imported"
                  ? "text-success"
                  : entry.type === "skipped"
                  ? "text-muted-foreground"
                  : "text-destructive"
              )}
            >
              {entry.type === "imported" ? "✓" : entry.type === "skipped" ? "–" : "✗"}
            </span>
            <span
              className={cn(
                "flex-1",
                entry.type === "imported"
                  ? "text-foreground"
                  : entry.type === "skipped"
                  ? "text-muted-foreground/50"
                  : "text-destructive"
              )}
            >
              {entry.label}
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
