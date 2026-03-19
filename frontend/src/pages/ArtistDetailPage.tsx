import { useState, useRef, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Image, Link2, Loader2, RefreshCw, Trash2, UserMinus } from "lucide-react";
import {
  getArtist, getArtistDiskStatus, relinkArtist, rematchArtist, unsubscribeArtist,
  getArtistArtworkOptions, updateArtistArtwork, updateArtistArtworkUpload,
} from "@/api/client";
import { ArtistSearchDialog } from "@/components/ArtistSearchDialog";
import { ArtworkPickerDialog } from "@/components/ArtworkPickerDialog";
import AlbumSection from "@/components/AlbumSection";
import type { DiskFolder } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Tab = "all" | "on-disk" | "missing" | "unmatched";

export default function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [watchedOnly, setWatchedOnly] = useState<boolean>(
    () => localStorage.getItem("albumList.watchedOnly") === "true"
  );
  // Albums optimistically moved to "On Disk" when download is queued
  const [optimisticOnDisk, setOptimisticOnDisk] = useState<Set<number>>(new Set());

  const { data: artist, isLoading: artistLoading } = useQuery({
    queryKey: ["artists", artistId],
    queryFn: () => getArtist(artistId),
    enabled: !!artistId,
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["disk-status", artistId],
    queryFn: () => getArtistDiskStatus(artistId),
    enabled: !!artistId,
  });

  const queryClient = useQueryClient();
  const [relinkMessage, setRelinkMessage] = useState<string | null>(null);
  const relinkMutation = useMutation({
    mutationFn: () => relinkArtist(artistId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["disk-status", artistId] });
      setRelinkMessage(`${data.files_linked} file${data.files_linked !== 1 ? "s" : ""} linked`);
      setTimeout(() => setRelinkMessage(null), 3000);
    },
  });

  const [bioExpanded, setBioExpanded] = useState(false);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [rematchMessage, setRematchMessage] = useState<string | null>(null);
  const rematchMutation = useMutation({
    mutationFn: (mbid: string) => rematchArtist(artistId, mbid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artists", artistId] });
      queryClient.invalidateQueries({ queryKey: ["disk-status", artistId] });
      setMatchDialogOpen(false);
      setRematchMessage("Artist updated");
      setTimeout(() => setRematchMessage(null), 3000);
    },
  });

  // ── Artwork picker ──────────────────────────────────────────────────────────
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false);

  const { data: artworkOptions = [], isLoading: artworkOptionsLoading } = useQuery({
    queryKey: ["artist-artwork-options", artistId],
    queryFn: () => getArtistArtworkOptions(artistId),
    enabled: artworkPickerOpen,
  });

  const updateArtworkMutation = useMutation({
    mutationFn: ({ url, writeToDisk }: { url: string; writeToDisk: boolean }) =>
      updateArtistArtwork(artistId, url, writeToDisk),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artists", artistId] });
      setArtworkPickerOpen(false);
    },
  });

  const uploadArtworkMutation = useMutation({
    mutationFn: ({ file, writeToDisk }: { file: File; writeToDisk: boolean }) =>
      updateArtistArtworkUpload(artistId, file, writeToDisk),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["artists", artistId] });
      setArtworkPickerOpen(false);
    },
  });

  const [untrackMenuOpen, setUntrackMenuOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const untrackMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!untrackMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (untrackMenuRef.current && !untrackMenuRef.current.contains(e.target as Node)) {
        setUntrackMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [untrackMenuOpen]);

  const untrackMutation = useMutation({
    mutationFn: (deleteFiles: boolean) => unsubscribeArtist(artistId, deleteFiles),
    onSuccess: () => navigate("/artists", { replace: true }),
  });

  if (artistLoading) {
    return (
      <div>
        {/* Hero skeleton */}
        <div className="relative bg-card overflow-hidden px-6 pt-4 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 shimmer rounded-md" />
            <div className="flex-1" />
            <div className="w-32 h-7 shimmer rounded-lg" />
            <div className="w-44 h-9 shimmer rounded-lg" />
          </div>
          <div className="flex items-end gap-5">
            <div className="w-28 h-28 shimmer rounded-xl shrink-0" />
            <div className="flex-1 pb-1 space-y-2">
              <div className="h-8 shimmer rounded w-48" />
              <div className="h-4 shimmer rounded w-32" />
            </div>
          </div>
          <div className="mt-4 space-y-2 max-w-2xl">
            <div className="h-3.5 shimmer rounded" />
            <div className="h-3.5 shimmer rounded w-4/5" />
            <div className="h-3.5 shimmer rounded w-3/5" />
          </div>
        </div>
        {/* Tab bar skeleton */}
        <div className="border-b border-border px-6 py-3 flex gap-6">
          {[80, 64, 72, 80].map((w, i) => (
            <div key={i} className={`h-4 shimmer rounded`} style={{ width: w }} />
          ))}
        </div>
        {/* Albums skeleton */}
        <div className="p-6 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square shimmer rounded-xl" />
              <div className="h-4 shimmer rounded mt-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!artist) return <div className="p-6 text-muted-foreground">Artist not found.</div>;

  const s = status ?? { matched: [], missing: [], unmatched_folders: [] };

  const byReleaseDate = (
    dateA: string | null | undefined, titleA: string,
    dateB: string | null | undefined, titleB: string,
  ) => {
    const da = dateA ?? "";
    const db = dateB ?? "";
    if (db !== da) return db.localeCompare(da); // descending date
    return titleA.localeCompare(titleB);         // ascending title as tiebreak
  };

  // Albums in missing that the user just queued for download
  const pendingAlbums = s.missing.filter((rg) => optimisticOnDisk.has(rg.id));
  // Merged "on disk" list: real matches + pending downloads (shown as partial)
  const onDiskAlbums = [
    ...s.matched,
    ...pendingAlbums.map((rg) => ({ release_group: rg, folder_path: "", file_count: 0 })),
  ].sort((a, b) => byReleaseDate(
    a.release_group.first_release_date, a.release_group.title,
    b.release_group.first_release_date, b.release_group.title,
  ));
  const missingAlbums = s.missing
    .filter((rg) => !optimisticOnDisk.has(rg.id))
    .sort((a, b) => byReleaseDate(a.first_release_date, a.title, b.first_release_date, b.title));

  const visibleOnDisk = watchedOnly ? onDiskAlbums.filter((m) => m.release_group.watched) : onDiskAlbums;
  const visibleMissing = watchedOnly ? missingAlbums.filter((rg) => rg.watched) : missingAlbums;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All", count: visibleOnDisk.length + visibleMissing.length + s.unmatched_folders.length },
    { key: "on-disk", label: "On Disk", count: visibleOnDisk.length },
    { key: "missing", label: "Missing", count: visibleMissing.length },
    { key: "unmatched", label: "Unmatched", count: s.unmatched_folders.length },
  ];

  return (
    <div>
      {/* Artist hero */}
      <div className="relative bg-card overflow-hidden">
        {/* Blurred full-bleed background */}
        {artist.image_url && (
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={artist.image_url}
              alt=""
              aria-hidden
              className="w-full h-full object-cover scale-110 blur-2xl opacity-25 saturate-150"
            />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/40 to-background" />

        {/* Content */}
        <div className="relative px-6 pt-4 pb-6">
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => navigate(-1)}
              className="bg-background/40 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1" />
            {rematchMessage && (
              <span className="text-xs text-success">{rematchMessage}</span>
            )}
            {/* Change Artwork button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setArtworkPickerOpen(true)}
              className="h-7 text-xs bg-background/40 border border-border/50 rounded-lg"
            >
              <Image className="w-3.5 h-3.5" />
              Change artwork
            </Button>

            {/* Grouped action buttons */}
            <div className="flex items-center gap-px bg-background/40 border border-border/50 rounded-lg p-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMatchDialogOpen(true)}
                className="h-7 text-xs"
                disabled={rematchMutation.isPending}
              >
                {rematchMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Fix match
              </Button>
              <div className="w-px h-4 bg-border/60 mx-0.5" />
              <div className="relative" ref={untrackMenuRef}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUntrackMenuOpen((v) => !v)}
                  className="h-7 text-xs text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                  disabled={untrackMutation.isPending}
                >
                  {untrackMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserMinus className="w-3.5 h-3.5" />
                  )}
                  Stop tracking
                  <ChevronDown className={`w-3 h-3 transition-transform ${untrackMenuOpen ? "rotate-180" : ""}`} />
                </Button>
                {untrackMenuOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 bg-popover border border-border rounded-lg shadow-lg overflow-hidden z-50">
                    <button
                      onClick={() => { setUntrackMenuOpen(false); untrackMutation.mutate(false); }}
                      className="w-full text-left px-4 py-3 text-sm hover:bg-muted transition-colors"
                    >
                      <div className="font-medium">Stop tracking</div>
                      <div className="text-xs text-muted-foreground mt-0.5">Removes this artist from TuneHound. Your music files stay on disk.</div>
                    </button>
                    <div className="border-t border-border" />
                    <button
                      onClick={() => { setUntrackMenuOpen(false); setDeleteConfirmOpen(true); }}
                      className="w-full text-left px-4 py-3 text-sm hover:bg-destructive/10 transition-colors"
                    >
                      <div className="font-medium text-destructive">Stop tracking &amp; delete music</div>
                      <div className="text-xs text-destructive/70 mt-0.5">Removes this artist and permanently deletes all music files from disk.</div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-end gap-5">
            {/* Portrait thumbnail — contained so cropping is not a problem */}
            {artist.image_url && (
              <div className="w-28 h-28 rounded-xl overflow-hidden bg-muted shrink-0 shadow-lg ring-1 ring-white/10">
                <img
                  src={artist.image_url}
                  alt={artist.name}
                  className="w-full h-full object-cover object-top"
                />
              </div>
            )}

            <div className="min-w-0 pb-1">
              <h1 className="text-3xl font-bold text-foreground leading-tight drop-shadow">
                {artist.name}
              </h1>
              {artist.disambiguation && (
                <p className="text-sm text-muted-foreground mt-0.5">{artist.disambiguation}</p>
              )}
            </div>
          </div>

          {/* Bio */}
          {artist.bio && (
            <div className="mt-4 max-w-2xl">
              <p className={`text-sm text-muted-foreground/90 leading-relaxed ${bioExpanded ? "" : "line-clamp-3"}`}>
                {artist.bio}
              </p>
              <button
                onClick={() => setBioExpanded((v) => !v)}
                className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {bioExpanded ? "Show less" : "More…"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="border-b border-border px-6">
        <div className="flex items-end justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line" className="h-auto gap-0">
              {tabs.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-2 px-4 py-3 rounded-none">
                  {t.label}
                  <Badge
                    variant={tab === t.key ? "default" : "secondary"}
                    className="h-4 px-1.5 text-xs"
                  >
                    {t.count}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2 pb-2">
            {relinkMessage && (
              <span className="text-xs text-success">{relinkMessage}</span>
            )}
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={watchedOnly}
                onChange={(e) => {
                  setWatchedOnly(e.target.checked);
                  localStorage.setItem("albumList.watchedOnly", e.target.checked ? "true" : "false");
                }}
                className="w-4 h-4 accent-primary"
              />
              Watched only
            </label>
            {artist.folder_name && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => relinkMutation.mutate()}
                disabled={relinkMutation.isPending}
              >
                {relinkMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Link2 className="w-3.5 h-3.5" />
                )}
                Re-link files
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {statusLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i}>
                <div className="aspect-square shimmer rounded-xl" />
                <div className="h-4 shimmer rounded mt-2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-8">
            {(tab === "all" || tab === "on-disk") && (
              <AlbumSection
                title={tab === "all" ? "On Disk" : undefined}
                items={visibleOnDisk.map((m) => ({
                  album: m.release_group,
                  onDisk: true,
                  fileCount: m.file_count,
                }))}
                artistName={artist.name}
              />
            )}

            {(tab === "all" || tab === "missing") && visibleMissing.length > 0 && (
              <section>
                {tab === "all" && <Separator className="mb-8" />}
                <AlbumSection
                  title={tab === "all" ? "Missing" : undefined}
                  items={visibleMissing.map((rg) => ({
                    album: rg,
                    onDisk: false,
                    onDownloadQueued: () =>
                      setOptimisticOnDisk((prev) => new Set([...prev, rg.id])),
                  }))}
                  artistName={artist.name}
                />
              </section>
            )}

            {(tab === "all" || tab === "unmatched") && s.unmatched_folders.length > 0 && (
              <section>
                {tab === "all" && (
                  <>
                    <Separator className="mb-8" />
                    <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Unmatched on Disk
                    </h2>
                  </>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {s.unmatched_folders.map((f) => (
                    <UnmatchedFolderCard key={f.folder_path} folder={f} />
                  ))}
                </div>
              </section>
            )}

            {!statusLoading &&
              onDiskAlbums.length === 0 &&
              missingAlbums.length === 0 &&
              s.unmatched_folders.length === 0 && (
                <p className="text-muted-foreground text-sm">No releases found.</p>
              )}
            {tab === "on-disk" && onDiskAlbums.length === 0 && (
              <p className="text-muted-foreground text-sm">No releases found on disk.</p>
            )}
            {tab === "missing" && missingAlbums.length === 0 && (
              <p className="text-muted-foreground text-sm">Nothing missing — you have everything!</p>
            )}
            {tab === "unmatched" && s.unmatched_folders.length === 0 && (
              <p className="text-muted-foreground text-sm">No unmatched folders.</p>
            )}
          </div>
        )}
      </div>

      {artist && (
        <ArtistSearchDialog
          open={matchDialogOpen}
          onClose={() => setMatchDialogOpen(false)}
          initialQuery={artist.name}
          title={`Reassign "${artist.name}" to a different artist`}
          onConfirm={(mbid, _name) => rematchMutation.mutate(mbid)}
          confirmLabel="Reassign"
        />
      )}

      {artworkPickerOpen && artist && (
        <ArtworkPickerDialog
          title={`Choose artwork for ${artist.name}`}
          options={artworkOptions}
          loading={artworkOptionsLoading}
          onSelect={(url, writeToDisk) => updateArtworkMutation.mutate({ url, writeToDisk })}
          onUpload={(file, writeToDisk) => uploadArtworkMutation.mutate({ file, writeToDisk })}
          onClose={() => setArtworkPickerOpen(false)}
          showWriteToDisk={!!artist.folder_name}
          writeToDiskLabel="Write art to music directory"
          isPending={updateArtworkMutation.isPending || uploadArtworkMutation.isPending}
        />
      )}

      {deleteConfirmOpen && artist && (
        <Dialog open onOpenChange={(open) => { if (!open) setDeleteConfirmOpen(false); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Permanently delete all music for {artist.name}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                This will delete the following folder and everything inside it:
              </p>
              {artist.folder_name && (
                <p className="font-mono text-xs bg-muted px-3 py-2 rounded-md break-all">
                  {artist.folder_name}
                </p>
              )}
              <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 space-y-1">
                <p className="font-semibold text-destructive">This cannot be undone.</p>
                <p className="text-destructive/80">
                  All audio files, album artwork, and any other content in this folder will be
                  permanently deleted from your disk. TuneHound will also stop tracking this artist.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteConfirmOpen(false)}
                disabled={untrackMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => untrackMutation.mutate(true)}
                disabled={untrackMutation.isPending}
              >
                {untrackMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                Delete forever
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function UnmatchedFolderCard({ folder }: { folder: DiskFolder }) {
  return (
    <div className="bg-card border border-warning/30 rounded-xl overflow-hidden flex flex-col">
      <div className="aspect-square bg-muted flex items-center justify-center text-warning">
        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1}
            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
          />
        </svg>
      </div>
      <div className="p-3">
        <p className="font-medium text-sm leading-tight line-clamp-2 text-foreground">
          {folder.folder_name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {folder.file_count} file{folder.file_count !== 1 ? "s" : ""}
        </p>
      </div>
    </div>
  );
}
