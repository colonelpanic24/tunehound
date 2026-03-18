import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ChevronDown,
  ChevronUp,
  Square,
  X,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DownloadJob } from "@/types";
import { stopDownloadJob, deleteDownloadJob } from "@/api/client";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface Props {
  job: DownloadJob;
}

const statusColors: Record<string, string> = {
  queued: "text-muted-foreground",
  running: "text-info",
  completed: "text-success",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
};

const statusIcons: Record<string, React.ReactNode> = {
  queued: <Clock className="w-4 h-4" />,
  running: <Loader2 className="w-4 h-4 animate-spin" />,
  completed: <CheckCircle2 className="w-4 h-4" />,
  failed: <XCircle className="w-4 h-4" />,
  cancelled: <XCircle className="w-4 h-4" />,
};

export default function DownloadJobCard({ job }: Props) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(job.status === "running");
  const [stopping, setStopping] = useState(false);

  const pct =
    job.total_tracks > 0
      ? Math.round((job.completed_tracks / job.total_tracks) * 100)
      : 0;

  const stopMutation = useMutation({
    mutationFn: () => stopDownloadJob(job.id),
    onSuccess: () => setStopping(true),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDownloadJob(job.id),
    onSuccess: () => {
      queryClient.setQueryData<DownloadJob[]>(["download-jobs"], (old = []) =>
        old.filter((j) => j.id !== job.id)
      );
    },
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Header row */}
      <div className="px-4 py-3 flex items-center gap-3">
        <span className={statusColors[job.status] ?? "text-muted-foreground"}>
          {statusIcons[job.status]}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate text-foreground">
              Job #{job.id}
            </span>
            <span className={cn("text-xs font-medium capitalize", statusColors[job.status])}>
              {stopping && job.status === "running" ? "stopping…" : job.status}
            </span>
          </div>

          {/* Progress bar */}
          {job.total_tracks > 0 && (
            <div className="mt-1.5">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>
                  {job.current_track_title
                    ? `Downloading: ${job.current_track_title}`
                    : `${job.completed_tracks} / ${job.total_tracks} tracks`}
                </span>
                <span>{pct}%</span>
              </div>
              <Progress
                value={pct}
                className={cn(
                  job.status === "completed"
                    ? "[&_[data-slot=progress-indicator]]:bg-success"
                    : job.status === "failed"
                    ? "[&_[data-slot=progress-indicator]]:bg-destructive"
                    : ""
                )}
              />
            </div>
          )}

          {job.error_message && (
            <p className="text-xs text-destructive mt-1 truncate">{job.error_message}</p>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {job.status === "running" && !stopping && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => stopMutation.mutate()}
                    disabled={stopMutation.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  />
                }
              >
                <Square className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent>Stop download</TooltipContent>
            </Tooltip>
          )}

          {job.status === "queued" && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  />
                }
              >
                <X className="w-4 h-4" />
              </TooltipTrigger>
              <TooltipContent>Remove from queue</TooltipContent>
            </Tooltip>
          )}

          {(job.status === "completed" ||
            job.status === "failed" ||
            job.status === "cancelled") && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    className="text-muted-foreground hover:text-destructive"
                  />
                }
              >
                <Trash2 className="w-3.5 h-3.5" />
              </TooltipTrigger>
              <TooltipContent>Clear from history</TooltipContent>
            </Tooltip>
          )}

          {/* Expand toggle */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Track list */}
      {expanded && (job.track_jobs?.length ?? 0) > 0 && (
        <div className="border-t border-border divide-y divide-border/50">
          {job.track_jobs.map((tj) => (
            <div key={tj.id} className="px-4 py-2 flex items-center gap-2 text-xs">
              <span className={statusColors[tj.status] ?? "text-muted-foreground"}>
                {statusIcons[tj.status]}
              </span>
              <span className="flex-1 text-muted-foreground truncate">
                {tj.yt_search_query ?? `Track #${tj.track_id}`}
              </span>
              <span className={cn("capitalize font-medium", statusColors[tj.status])}>
                {tj.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
