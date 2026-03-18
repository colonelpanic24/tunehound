import { useState } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Music2, Disc3, ListMusic, HardDrive, Download, Plus, ScanLine, FileAudio, Trash2,
} from "lucide-react";
import { getStats, listArtists, getOrphanedFiles } from "@/api/client";
import AddArtistModal from "@/components/AddArtistModal";
import { useImport } from "@/context/ImportContext";
import { ArtistSearchDialog } from "@/components/ArtistSearchDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Artist, ImportResult, OrphanedFile } from "@/types";

type LibTab = "import" | "orphaned";

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
  const { data: artists = [] } = useQuery({ queryKey: ["artists"], queryFn: listArtists });

  const { state, startScan, clearAll, reset, importReviewItem, skipReviewItem } = useImport();
  const { phase, scanDone, scanTotal, importDone, importTotal, currentStep, log, finalResult, error, needsReview } = state;
  const importActive = phase === "scanning" || phase === "importing" || phase === "linking";

  const orphanedQuery = useInfiniteQuery({
    queryKey: ["library-orphaned"],
    queryFn: ({ pageParam }) => getOrphanedFiles(pageParam as number, 250),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.has_more ? lastPage.offset + 250 : undefined,
    enabled: libTab === "orphaned",
  });

  const recentArtists = [...artists]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  const downloadActive = (stats?.active_downloads ?? 0) > 0;
  const downloadProgress =
    downloadActive && stats!.download_tracks_total > 0
      ? Math.round((stats!.download_tracks_completed / stats!.download_tracks_total) * 100)
      : 0;

  const orphanTotal = orphanedQuery.data?.pages[0]?.total;

  return (
    <div className="p-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">Your library at a glance</p>
        </div>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" />
          Add Artist
        </Button>
      </div>

      {folderNotice && (
        <div className="mb-6 px-4 py-3 rounded-lg bg-muted border border-border text-sm text-foreground flex items-center justify-between gap-4">
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

      <div className="space-y-10">
        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            icon={<Music2 className="w-4 h-4" />}
            label="Artists"
            value={stats?.artists}
            onClick={() => navigate("/artists")}
          />
          <StatCard
            icon={<Disc3 className="w-4 h-4" />}
            label="Albums"
            value={stats?.albums}
            onClick={() => navigate("/albums")}
          />
          <StatCard icon={<ListMusic className="w-4 h-4" />} label="Tracks" value={stats?.tracks} />
          <StatCard icon={<HardDrive className="w-4 h-4" />} label="Files on Disk" value={stats?.files_linked} />
        </div>

        {/* Active download progress */}
        {downloadActive && (
          <div className="rounded-xl border border-border bg-card px-5 py-4 space-y-2.5">
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

        {/* Recently added */}
        {recentArtists.length > 0 && (
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Recently Added
              </h2>
              <button onClick={() => navigate("/artists")} className="text-xs text-primary hover:underline">
                All artists
              </button>
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-3">
              {recentArtists.map((artist) => (
                <RecentArtistTile
                  key={artist.id}
                  artist={artist}
                  onClick={() => navigate(`/artists/${artist.id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Library tools */}
        <section>
          <div className="border-b border-border -mx-8 px-8 mb-6">
            <Tabs value={libTab} onValueChange={(v) => setLibTab(v as LibTab)}>
              <TabsList variant="line" className="h-auto gap-0">
                <TabsTrigger value="import" className="px-4 py-3 rounded-none gap-2">
                  Import
                  {importActive && (
                    <Badge variant="default" className="h-4 px-1.5 text-xs animate-pulse">
                      •
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
          </div>

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
              finalResult={finalResult}
              error={error}
              needsReview={needsReview}
              startScan={startScan}
              clearAll={clearAll}
              reset={reset}
              importReviewItem={importReviewItem}
              skipReviewItem={skipReviewItem}
            />
          )}
          {libTab === "orphaned" && <OrphanedTab query={orphanedQuery} />}
        </section>
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

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(onClick && "cursor-pointer hover:border-primary/50 transition-colors")}
      onClick={onClick}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-2 text-xs">
          {icon}
          {label}
        </div>
        <div className="text-2xl font-bold text-foreground tabular-nums">
          {value === undefined ? (
            <span className="text-muted-foreground/40">—</span>
          ) : (
            value.toLocaleString()
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Recent artist tile ─────────────────────────────────────────────────────────

function RecentArtistTile({ artist, onClick }: { artist: Artist; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group text-left">
      <div className="aspect-square rounded-xl overflow-hidden bg-muted border border-border mb-1.5 ring-1 ring-foreground/5">
        {artist.image_url ? (
          <img
            src={artist.image_url}
            alt={artist.name}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-200"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Music2 className="w-6 h-6 text-muted-foreground/30" />
          </div>
        )}
      </div>
      <p className="text-xs font-medium text-foreground truncate leading-snug group-hover:text-primary transition-colors">
        {artist.name}
      </p>
    </button>
  );
}

// ── Import tab ─────────────────────────────────────────────────────────────────

function ImportTab({
  isActive, phase, scanDone, scanTotal, importDone, importTotal,
  currentStep, log, finalResult, error, needsReview, startScan, clearAll, reset,
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
  finalResult: ImportResult | null;
  error: string | null;
  needsReview: import("@/context/ImportContext").NeedsReviewItem[];
  startScan: () => void;
  clearAll: () => void;
  reset: () => void;
  importReviewItem: (folder: string, mbid: string) => Promise<void>;
  skipReviewItem: (folder: string) => void;
}) {
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearConfirm = async () => {
    setClearing(true);
    await clearAll();
    setClearing(false);
    setClearConfirmOpen(false);
  };

  return (
    <div className="max-w-2xl">
      <p className="text-muted-foreground mb-6">
        Scan your music directory to discover and import artists automatically.
      </p>

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
          <Button variant="destructive" onClick={() => setClearConfirmOpen(true)} className="ml-auto">
            Clear All Artists
          </Button>
        </div>
      )}

      <Dialog open={clearConfirmOpen} onOpenChange={(o) => { if (!o) setClearConfirmOpen(false); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Clear all artists from the library?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              This will remove all artists, albums, and track records from TuneHound's database.
            </p>
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5">
              <p className="text-foreground font-medium">Your music files will not be touched.</p>
              <p className="mt-0.5">
                No files will be deleted from disk. You can re-import your library at any time by scanning again.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearConfirm} disabled={clearing}>
              {clearing ? (
                <span className="flex items-center gap-1.5">Clearing…</span>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear library
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          <p className="text-sm text-foreground">
            {scanTotal === 0
              ? "Discovering folders…"
              : `Searching MusicBrainz — ${scanDone} / ${scanTotal}`}
          </p>
          {scanTotal > 0 && (
            <Progress value={scanTotal > 0 ? Math.round((scanDone / scanTotal) * 100) : 0} />
          )}
        </div>
      )}

      {(phase === "importing" || phase === "linking") && (
        <div className="mt-6 space-y-2">
          <p className="text-sm text-foreground">
            {phase === "linking"
              ? "Linking files on disk…"
              : `Importing — ${importDone} / ${importTotal}`}
          </p>
          {phase === "importing" && (
            <Progress value={importTotal > 0 ? Math.round((importDone / importTotal) * 100) : 0} />
          )}
          {currentStep && (
            <p className="text-xs text-muted-foreground truncate">{currentStep}</p>
          )}
          <ImportLog log={log} />
        </div>
      )}

      {phase === "done" && (
        <div className="mt-6 space-y-4">
          {finalResult ? (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <p className="font-medium text-foreground">Import complete</p>
                <ul className="text-sm space-y-1">
                  <li className="text-success">
                    {finalResult.imported.length} artist
                    {finalResult.imported.length !== 1 ? "s" : ""} imported
                  </li>
                  {finalResult.skipped.length > 0 && (
                    <li className="text-muted-foreground">
                      {finalResult.skipped.length} already in library (skipped)
                    </li>
                  )}
                  <li className="text-muted-foreground">
                    {finalResult.files_linked} existing file
                    {finalResult.files_linked !== 1 ? "s" : ""} linked
                  </li>
                  {finalResult.errors.length > 0 && (
                    <li className="text-destructive">
                      {finalResult.errors.length} error{finalResult.errors.length !== 1 ? "s" : ""}
                    </li>
                  )}
                </ul>
                {finalResult.errors.length > 0 && (
                  <details className="text-xs text-destructive mt-1">
                    <summary className="cursor-pointer">Show errors</summary>
                    <ul className="mt-1 space-y-1">
                      {finalResult.errors.map((e) => (
                        <li key={e.mbid}>{e.mbid}: {e.error}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground text-sm">No new artists found to import.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Orphaned tab ───────────────────────────────────────────────────────────────

function OrphanedTab({ query }: { query: ReturnType<typeof useInfiniteQuery> }) {
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } =
    query as ReturnType<typeof useInfiniteQuery<import("@/types").OrphanedFilePage>>;

  if (isLoading) return <p className="text-sm text-muted-foreground">Scanning…</p>;

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
          <div key={file.path} className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/50">
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
          <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
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
  item, onImport, onSkip,
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
            <Button size="sm" variant="outline" disabled={importing} onClick={() => handleImport(top.mbid)}>
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
        onConfirm={(mbid) => handleImport(mbid)}
      />
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
              entry.type === "imported" ? "text-success"
                : entry.type === "skipped" ? "text-muted-foreground"
                : "text-destructive"
            )}>
              {entry.type === "imported" ? "✓" : entry.type === "skipped" ? "–" : "✗"}
            </span>
            <span className={cn(
              "flex-1",
              entry.type === "imported" ? "text-foreground"
                : entry.type === "skipped" ? "text-muted-foreground/50"
                : "text-destructive"
            )}>
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
