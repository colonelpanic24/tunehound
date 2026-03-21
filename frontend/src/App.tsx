import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import DashboardPage from "@/pages/DashboardPage";
import ArtistsPage from "@/pages/ArtistsPage";
import ArtistDetailPage from "@/pages/ArtistDetailPage";
import AlbumDetailPage from "@/pages/AlbumDetailPage";
import AlbumsPage from "@/pages/AlbumsPage";
import DownloadsPage from "@/pages/DownloadsPage";
import SettingsPage from "@/pages/SettingsPage";
import { onWsEvent, useWebSocket } from "@/context/WebSocketContext";
import type { DownloadJob, DownloadTrackJob, Stats } from "@/types";

/** Keeps the download-jobs and stats caches fresh via WebSocket — no polling needed. */
function DownloadSyncEffect() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubJob = onWsEvent("job_update", (msg) => {
      const jobUpdate = msg.payload;
      queryClient.setQueryData<DownloadJob[]>(["download-jobs"], (old = []) => {
        const idx = old.findIndex((j) => j.id === jobUpdate.id);
        if (idx === -1) return [{ ...jobUpdate, track_jobs: [] }, ...old];
        const updated = [...old];
        // job_update payloads don't carry track_jobs — preserve the existing array
        const { track_jobs: _, ...rest } = jobUpdate;
        updated[idx] = { ...updated[idx], ...rest };
        return updated;
      });
      syncStats(queryClient);
    });

    const unsubTrack = onWsEvent("track_update", (msg) => {
      const p = msg.payload as {
        job_id: number;
        track_job: DownloadTrackJob;
        job_progress: { completed: number; total: number; current_track: string };
      };
      queryClient.setQueryData<DownloadJob[]>(["download-jobs"], (old = []) =>
        old.map((job) => {
          if (job.id !== p.job_id) return job;
          return {
            ...job,
            completed_tracks: p.job_progress.completed,
            total_tracks: p.job_progress.total,
            current_track_title: p.job_progress.current_track,
            track_jobs: job.track_jobs.map((tj) =>
              tj.id === p.track_job.id ? { ...tj, ...p.track_job } : tj
            ),
          };
        })
      );
      syncStats(queryClient);
    });

    const unsubArtist = onWsEvent("artist_ready", () => {
      queryClient.invalidateQueries({ queryKey: ["artists"] });
    });

    return () => { unsubJob(); unsubTrack(); unsubArtist(); };
  }, [queryClient]);

  return null;
}

function syncStats(queryClient: ReturnType<typeof useQueryClient>) {
  const jobs = queryClient.getQueryData<DownloadJob[]>(["download-jobs"]) ?? [];
  const active = jobs.filter((j) => j.status === "queued" || j.status === "running");
  queryClient.setQueryData<Stats>(["stats"], (old) =>
    old
      ? {
          ...old,
          active_downloads: active.length,
          download_tracks_completed: active.reduce((s, j) => s + j.completed_tracks, 0),
          download_tracks_total: active.reduce((s, j) => s + j.total_tracks, 0),
        }
      : old
  );
}

export default function App() {
  useWebSocket();

  return (
    <Layout>
      <DownloadSyncEffect />
      <Routes>
        <Route path="/" element={<Navigate to="/artists" replace />} />
        <Route path="/library" element={<DashboardPage />} />
        <Route path="/artists" element={<ArtistsPage />} />
        <Route path="/artists/:id" element={<ArtistDetailPage />} />
        <Route path="/albums" element={<AlbumsPage />} />
        <Route path="/albums/:id" element={<AlbumDetailPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
