import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Track, TagFieldStatus } from "@/types";

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  track_number: "Track #",
  cover_art: "Cover art",
};

interface Props {
  tracks: Array<{ track: Track; issues: TagFieldStatus[] }>;
  onConfirm: (trackJobs: Array<{ track_id: number; fields: string[] }>) => void;
  onClose: () => void;
  isPending?: boolean;
}

export function RetagDialog({ tracks, onConfirm, onClose, isPending }: Props) {
  // Per-track, per-field checkbox state — default all issues checked
  const [checked, setChecked] = useState<Record<number, Set<string>>>(() => {
    const init: Record<number, Set<string>> = {};
    for (const { track, issues } of tracks) {
      init[track.id] = new Set(issues.map((i) => i.field));
    }
    return init;
  });

  const toggle = (trackId: number, field: string) => {
    setChecked((prev) => {
      const s = new Set(prev[trackId]);
      if (s.has(field)) s.delete(field);
      else s.add(field);
      return { ...prev, [trackId]: s };
    });
  };

  const handleConfirm = () => {
    const jobs = tracks
      .map(({ track }) => ({
        track_id: track.id,
        fields: Array.from(checked[track.id] ?? []),
      }))
      .filter((j) => j.fields.length > 0);
    onConfirm(jobs);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-2xl p-0 gap-0 overflow-hidden"
      >
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>Fix track tags</DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto">
          {tracks.map(({ track, issues }) => (
            <div
              key={track.id}
              className="px-5 py-3 border-b border-border last:border-0"
            >
              <p className="text-sm font-medium text-foreground mb-2">
                {track.track_number != null ? `${track.track_number}. ` : ""}
                {track.title}
              </p>
              <div className="space-y-1.5">
                {issues.map((issue) => (
                  <label
                    key={issue.field}
                    className="flex items-start gap-3 cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={checked[track.id]?.has(issue.field) ?? false}
                      onChange={() => toggle(track.id, issue.field)}
                      className="mt-0.5 accent-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {FIELD_LABELS[issue.field] ?? issue.field}
                      </span>
                      {issue.field !== "cover_art" ? (
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="text-xs text-destructive/80 line-through truncate max-w-[40%]">
                            {issue.actual ?? "(empty)"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            →
                          </span>
                          <span className="text-xs text-success truncate max-w-[40%]">
                            {issue.expected ?? "(empty)"}
                          </span>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {issue.actual
                            ? "Embedded art doesn't match album cover"
                            : "No embedded art — album cover will be written"}
                        </p>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Changes will be written to {tracks.length} file
            {tracks.length !== 1 ? "s" : ""} on disk.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirm} disabled={isPending}>
              {isPending && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              )}
              Write tags
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
