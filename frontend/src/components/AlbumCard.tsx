import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, EyeOff, Loader2, CheckCircle2, CircleDashed } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { updateAlbum, createDownloadJob } from "@/api/client";
import type { ReleaseGroup } from "@/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  album: ReleaseGroup;
  artistName: string;
  onDisk?: boolean;
  fileCount?: number;
  onDownloadQueued?: () => void;
}

export default function AlbumCard({ album, onDisk = false, fileCount, onDownloadQueued }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [downloadQueued, setDownloadQueued] = useState(false);

  const isPartial =
    onDisk &&
    fileCount !== undefined &&
    album.track_count > 0 &&
    fileCount < album.track_count;

  const watchMutation = useMutation({
    mutationFn: () => updateAlbum(album.id, { watched: !album.watched }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["disk-status", album.artist_id] });
      queryClient.invalidateQueries({ queryKey: ["albums"] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: () => createDownloadJob(album.id),
    onSuccess: () => {
      setDownloadQueued(true);
      onDownloadQueued?.();
      queryClient.invalidateQueries({ queryKey: ["download-jobs"] });
    },
  });

  const year = album.first_release_date?.slice(0, 4) ?? "–";
  const typeLabel = [album.primary_type, ...(album.secondary_types?.split(",") ?? [])]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "bg-card border border-border rounded-xl overflow-hidden flex flex-col transition-opacity cursor-pointer",
        !album.watched && "opacity-50"
      )}
      onClick={() => navigate(`/albums/${album.id}`)}
    >
      {/* Cover art */}
      <div className="aspect-square bg-muted relative">
        {album.cover_art_url ? (
          <img
            src={album.cover_art_url}
            alt={album.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
          </div>
        )}
        {onDisk && !isPartial && (
          <div className="absolute top-2 right-2 bg-success/90 rounded-full p-0.5">
            <CheckCircle2 className="w-4 h-4 text-success-foreground" />
          </div>
        )}
        {isPartial && (
          <div className="absolute top-2 right-2 bg-warning/90 rounded-full p-0.5">
            <CircleDashed className="w-4 h-4 text-warning-foreground" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex-1">
          <p className="font-medium text-sm leading-tight line-clamp-2 text-foreground">{album.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {year}{typeLabel ? ` · ${typeLabel}` : ""}
            {onDisk && fileCount !== undefined && (
              <span className={cn("ml-1", isPartial ? "text-warning" : "text-success")}>
                · {fileCount} files
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-1.5 mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => watchMutation.mutate()}
                  disabled={watchMutation.isPending}
                />
              }
            >
              {album.watched ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </TooltipTrigger>
            <TooltipContent>{album.watched ? "Unwatch" : "Watch"}</TooltipContent>
          </Tooltip>

          {(!onDisk || isPartial) && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    onClick={() => downloadMutation.mutate()}
                    disabled={downloadMutation.isPending || downloadQueued || !album.watched}
                    size="sm"
                    className={cn(
                      "ml-auto gap-1.5",
                      isPartial
                        ? "bg-warning hover:bg-warning/90 text-warning-foreground"
                        : "bg-primary hover:bg-primary/90 text-primary-foreground"
                    )}
                  />
                }
              >
                {downloadMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                {isPartial ? "Missing" : "Download"}
              </TooltipTrigger>
              {downloadQueued && <TooltipContent>Download queued</TooltipContent>}
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
