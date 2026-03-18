import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listDownloadJobs, clearAllDownloadJobs } from "@/api/client";
import DownloadJobCard from "@/components/DownloadJobCard";
import type { DownloadJob } from "@/types";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export default function DownloadsPage() {
  const queryClient = useQueryClient();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // WS keeps this fresh — App.tsx's DownloadSyncEffect handles all updates
  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["download-jobs"],
    queryFn: listDownloadJobs,
  });

  const clearMutation = useMutation({
    mutationFn: clearAllDownloadJobs,
    onSuccess: () => {
      queryClient.setQueryData<DownloadJob[]>(["download-jobs"], []);
      setShowClearConfirm(false);
    },
  });

  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  const finished = jobs.filter((j) => j.status !== "queued" && j.status !== "running");

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Downloads</h1>
        <div className="flex items-center gap-2">
          {jobs.length > 0 && (
            <Button
              variant="outline"
              onClick={() => setShowClearConfirm(true)}
              className="gap-2 text-muted-foreground hover:text-destructive hover:border-destructive"
            >
              <Trash2 className="w-4 h-4" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse h-16 bg-muted rounded-xl" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p>No downloads yet.</p>
          <p className="text-sm mt-1">Click "Download" on an album to start.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Active ({active.length})
              </h2>
              <div className="space-y-3">
                {active.map((job) => (
                  <DownloadJobCard key={job.id} job={job} />
                ))}
              </div>
            </section>
          )}
          {finished.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                History
              </h2>
              <div className="space-y-3">
                {finished.map((job) => (
                  <DownloadJobCard key={job.id} job={job} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear all downloads?</DialogTitle>
            <DialogDescription>
              This will stop any active download, remove all queued jobs, and clear the
              history. Downloaded files on disk won't be affected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 mt-2">
            <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending}
            >
              Clear all
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

