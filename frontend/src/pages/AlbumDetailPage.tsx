import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Download, Image, Info, Loader2, CheckCircle2, Music,
  AlertTriangle, Tags,
} from "lucide-react";
import {
  getAlbum, getAlbumTracks, createDownloadJob, createTrackDownloadJob,
  getAlbumArtworkOptions, updateAlbumArtwork, updateAlbumArtworkUpload,
  getAlbumTagStatus, scanAlbumTags, createRetagJob,
} from "@/api/client";
import type { Track, TrackTagStatus, TagFieldStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArtworkPickerDialog } from "@/components/ArtworkPickerDialog";
import { RetagDialog } from "@/components/RetagDialog";
import { cn } from "@/lib/utils";

function formatDuration(ms: number | null): string {
  if (!ms) return "–";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function AlbumDetailPage() {
  const { id } = useParams<{ id: string }>();
  const albumId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: album, isLoading: albumLoading } = useQuery({
    queryKey: ["album", albumId],
    queryFn: () => getAlbum(albumId),
    enabled: !!albumId,
  });

  const { data: tracks = [], isLoading: tracksLoading } = useQuery({
    queryKey: ["album-tracks", albumId],
    queryFn: () => getAlbumTracks(albumId),
    enabled: !!albumId,
  });

  const [albumDownloadQueued, setAlbumDownloadQueued] = useState(false);

  const downloadAlbumMutation = useMutation({
    mutationFn: () => createDownloadJob(albumId),
    onSuccess: () => {
      setAlbumDownloadQueued(true);
      queryClient.invalidateQueries({ queryKey: ["download-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["album-tracks", albumId] });
    },
  });

  // ── Artwork picker ────────────────────────────────────────────────────────────
  const [artworkPickerOpen, setArtworkPickerOpen] = useState(false);

  const { data: artworkOptions = [], isLoading: artworkOptionsLoading } = useQuery({
    queryKey: ["album-artwork-options", albumId],
    queryFn: () => getAlbumArtworkOptions(albumId),
    enabled: artworkPickerOpen,
  });

  const updateArtworkMutation = useMutation({
    mutationFn: (url: string) => updateAlbumArtwork(albumId, url),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["album", albumId] });
      setArtworkPickerOpen(false);
    },
  });

  const uploadArtworkMutation = useMutation({
    mutationFn: (file: File) => updateAlbumArtworkUpload(albumId, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["album", albumId] });
      setArtworkPickerOpen(false);
    },
  });

  // ── Tag status ────────────────────────────────────────────────────────────────
  const { data: tagStatus, isLoading: tagStatusLoading } = useQuery({
    queryKey: ["tag-status", albumId],
    queryFn: () => getAlbumTagStatus(albumId),
    enabled: !!albumId,
  });

  const scanTagsMutation = useMutation({
    mutationFn: () => scanAlbumTags(albumId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tag-status", albumId] });
    },
  });

  const [retagDialogTracks, setRetagDialogTracks] = useState<
    Array<{ track: Track; issues: TagFieldStatus[] }> | null
  >(null);
  const [activeRetagJobId, setActiveRetagJobId] = useState<number | null>(null);

  const retagMutation = useMutation({
    mutationFn: (trackJobs: Array<{ track_id: number; fields: string[] }>) =>
      createRetagJob({ release_group_id: albumId, track_jobs: trackJobs }),
    onSuccess: (job) => {
      setRetagDialogTracks(null);
      setActiveRetagJobId(job.id);
    },
  });

  // Listen for WebSocket retag_complete to invalidate tag status
  useEffect(() => {
    if (!activeRetagJobId) return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (
          msg.type === "retag_complete" &&
          msg.payload?.job_id === activeRetagJobId
        ) {
          queryClient.invalidateQueries({ queryKey: ["tag-status", albumId] });
          queryClient.invalidateQueries({ queryKey: ["album-tracks", albumId] });
          setActiveRetagJobId(null);
        }
      } catch {
        // ignore malformed messages
      }
    };
    // Find the shared WS — attach to the global socket if available
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("message", handler);
    return () => {
      ws.removeEventListener("message", handler);
      ws.close();
    };
  }, [activeRetagJobId, albumId, queryClient]);

  // Build track lookup for retag dialog
  const trackById = Object.fromEntries(tracks.map((t) => [t.id, t]));

  const outOfSyncStatuses =
    tagStatus?.tracks.filter((ts) => !ts.in_sync && ts.file_path) ?? [];

  const openRetagForAll = () => {
    const items = outOfSyncStatuses
      .map((ts) => {
        const track = trackById[ts.track_id];
        if (!track) return null;
        return { track, issues: ts.issues };
      })
      .filter(Boolean) as Array<{ track: Track; issues: TagFieldStatus[] }>;
    setRetagDialogTracks(items);
  };

  const openRetagForTrack = (ts: TrackTagStatus) => {
    const track = trackById[ts.track_id];
    if (!track) return;
    setRetagDialogTracks([{ track, issues: ts.issues }]);
  };

  if (albumLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-32 shimmer rounded" />
        <div className="h-48 shimmer rounded-xl" />
      </div>
    );
  }

  if (!album) return <div className="p-6 text-muted-foreground">Album not found.</div>;

  const year = album.first_release_date?.slice(0, 4) ?? "–";
  const typeLabel = [album.primary_type, ...(album.secondary_types?.split(",") ?? [])]
    .filter(Boolean)
    .join(" · ");

  const missingTracks = tracks.filter((t) => !t.file_path);
  const localTracks = tracks.filter((t) => t.file_path);
  const isPartial = localTracks.length > 0 && missingTracks.length > 0;

  // Group tracks by disc
  const discs = tracks.reduce<Record<number, Track[]>>((acc, t) => {
    const d = t.disc_number ?? 1;
    (acc[d] ??= []).push(t);
    return acc;
  }, {});
  const discNumbers = Object.keys(discs)
    .map(Number)
    .sort((a, b) => a - b);
  const isMultiDisc = discNumbers.length > 1;

  return (
    <div>
      {/* Header */}
      <div className="p-6 flex gap-5 items-start border-b border-border">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>

        {/* Cover art — clicking opens artwork picker */}
        <div
          className="w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-muted relative group cursor-pointer"
          onClick={() => setArtworkPickerOpen(true)}
        >
          {album.cover_art_url ? (
            <img src={album.cover_art_url} alt={album.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              <Music className="w-10 h-10" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Image className="w-6 h-6 text-white" />
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
            {typeLabel || "Album"}
          </p>
          <h1 className="text-2xl font-bold leading-tight text-foreground">{album.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{year}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {tracks.length > 0 && (
              <>
                {localTracks.length}/{tracks.length} tracks local
                {isPartial && <span className="ml-2 text-warning">· Partial</span>}
                {!isPartial && localTracks.length === tracks.length && tracks.length > 0 && (
                  <span className="ml-2 text-success">· Complete</span>
                )}
              </>
            )}
          </p>
          {album.description && (
            <p className="text-xs text-muted-foreground mt-3 line-clamp-4 leading-relaxed max-w-prose">
              {album.description}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Change artwork button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setArtworkPickerOpen(true)}
            className="gap-1.5"
          >
            <Image className="w-3.5 h-3.5" />
            Artwork
          </Button>

          {/* Fix All Tags button — only shown when there are out-of-sync tracks */}
          {outOfSyncStatuses.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={openRetagForAll}
              className="gap-1.5 border-warning/50 text-warning hover:bg-warning/10"
            >
              <Tags className="w-3.5 h-3.5" />
              Fix tags ({outOfSyncStatuses.length})
            </Button>
          )}

          {/* Album download button */}
          {missingTracks.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    onClick={() => downloadAlbumMutation.mutate()}
                    disabled={downloadAlbumMutation.isPending || albumDownloadQueued}
                    className={cn(
                      "gap-2",
                      isPartial
                        ? "bg-warning hover:bg-warning/90 text-warning-foreground"
                        : "bg-primary hover:bg-primary/90 text-primary-foreground"
                    )}
                  />
                }
              >
                {downloadAlbumMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                {isPartial ? `Download missing (${missingTracks.length})` : "Download album"}
              </TooltipTrigger>
              {albumDownloadQueued && <TooltipContent>Download queued</TooltipContent>}
            </Tooltip>
          )}
        </div>
      </div>

      {/* Track list */}
      <div className="p-6">
        {tracksLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 shimmer rounded" />
            ))}
          </div>
        ) : tracks.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tracks found.</p>
        ) : (
          <ScrollArea>
            <div className="space-y-6">
              {discNumbers.map((disc) => (
                <div key={disc}>
                  {isMultiDisc && (
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      Disc {disc}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {discs[disc]
                      .sort((a, b) => (a.track_number ?? 0) - (b.track_number ?? 0))
                      .map((track) => {
                        const ts = tagStatus?.tracks.find((s) => s.track_id === track.id);
                        return (
                          <TrackRow
                            key={track.id}
                            track={track}
                            tagStatus={ts}
                            onDownloaded={() => {
                              queryClient.invalidateQueries({ queryKey: ["album-tracks", albumId] });
                              queryClient.invalidateQueries({ queryKey: ["download-jobs"] });
                            }}
                            onRetag={openRetagForTrack}
                          />
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* Tag status footer */}
      <div className="px-6 pb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => scanTagsMutation.mutate()}
            disabled={scanTagsMutation.isPending || tagStatusLoading}
            className="gap-1.5"
          >
            {scanTagsMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Tags className="w-3.5 h-3.5" />
            )}
            Check Tags
          </Button>
          {tagStatus && (
            <span className="text-xs text-muted-foreground">
              {outOfSyncStatuses.length === 0
                ? `All ${tagStatus.tracks.length} tagged tracks are in sync`
                : `${outOfSyncStatuses.length} track${outOfSyncStatuses.length !== 1 ? "s" : ""} out of sync`}
            </span>
          )}
          {activeRetagJobId && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Writing tags…
            </span>
          )}
        </div>
      </div>

      {/* Artwork picker dialog */}
      {artworkPickerOpen && (
        <ArtworkPickerDialog
          title={`Choose artwork for "${album.title}"`}
          options={artworkOptions}
          loading={artworkOptionsLoading}
          onSelect={(url) => updateArtworkMutation.mutate(url)}
          onUpload={(file) => uploadArtworkMutation.mutate(file)}
          onClose={() => setArtworkPickerOpen(false)}
          isPending={updateArtworkMutation.isPending || uploadArtworkMutation.isPending}
        />
      )}

      {/* Retag dialog */}
      {retagDialogTracks && retagDialogTracks.length > 0 && (
        <RetagDialog
          tracks={retagDialogTracks}
          onConfirm={(trackJobs) => retagMutation.mutate(trackJobs)}
          onClose={() => setRetagDialogTracks(null)}
          isPending={retagMutation.isPending}
        />
      )}
    </div>
  );
}

function TrackRow({
  track,
  tagStatus,
  onDownloaded,
  onRetag,
}: {
  track: Track;
  tagStatus?: TrackTagStatus;
  onDownloaded: () => void;
  onRetag: (ts: TrackTagStatus) => void;
}) {
  const isLocal = !!track.file_path;
  const hasTagIssues = tagStatus && !tagStatus.in_sync;

  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg group hover:bg-muted/50",
        !isLocal && "opacity-60"
      )}
    >
      <span className="w-6 text-right text-xs text-muted-foreground shrink-0">
        {track.track_number ?? "·"}
      </span>

      <span className="shrink-0">
        {isLocal ? (
          hasTagIssues ? (
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
          )
        ) : (
          <div className="w-3.5 h-3.5 rounded-full border border-border" />
        )}
      </span>

      <span className="flex-1 text-sm truncate text-foreground">{track.title}</span>

      <span className="text-xs text-muted-foreground shrink-0">{formatDuration(track.duration_ms)}</span>

      <div className="flex items-center gap-1 shrink-0">
        {hasTagIssues && tagStatus && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onRetag(tagStatus)}
                  className="text-warning hover:text-warning opacity-0 group-hover:opacity-100 transition-opacity"
                />
              }
            >
              <Tags className="w-3.5 h-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              {tagStatus.issues.length} tag issue{tagStatus.issues.length !== 1 ? "s" : ""}
            </TooltipContent>
          </Tooltip>
        )}

        <div className="w-6">
          {isLocal ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity p-0.5" />
                }
              >
                <Info className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs break-all font-mono text-xs">
                {track.file_path}
              </TooltipContent>
            </Tooltip>
          ) : (
            <TrackDownloadButton trackId={track.id} onDownloaded={onDownloaded} />
          )}
        </div>
      </div>
    </div>
  );
}

function TrackDownloadButton({ trackId, onDownloaded }: { trackId: number; onDownloaded: () => void }) {
  const [queued, setQueued] = useState(false);
  const mutation = useMutation({
    mutationFn: () => createTrackDownloadJob(trackId),
    onSuccess: () => {
      setQueued(true);
      onDownloaded();
    },
  });

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || queued}
            className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          />
        }
      >
        {mutation.isPending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Download className="w-3.5 h-3.5" />
        )}
      </TooltipTrigger>
      <TooltipContent>{queued ? "Download queued" : "Download track"}</TooltipContent>
    </Tooltip>
  );
}
