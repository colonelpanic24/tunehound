import { useCallback } from "react";
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
import { useWebSocketMessage } from "@/context/WebSocketContext";
import type { DownloadJob, DownloadTrackJob, Stats, WSMessage } from "@/types";

/** Keeps the download-jobs and stats caches fresh via WebSocket — no polling needed. */
function DownloadSyncEffect() {
  const queryClient = useQueryClient();

  const handler = useCallback(
    (msg: WSMessage) => {
      if (msg.type === "job_update") {
        const jobUpdate = msg.payload as DownloadJob;
        queryClient.setQueryData<DownloadJob[]>(["download-jobs"], (old = []) => {
          const idx = old.findIndex((j) => j.id === jobUpdate.id);
          if (idx === -1) return [{ ...jobUpdate, track_jobs: [] }, ...old];
          const updated = [...old];
          // job_update payloads don't carry track_jobs — preserve the existing array
          const { track_jobs: _, ...rest } = jobUpdate;
          updated[idx] = { ...updated[idx], ...rest };
          return updated;
        });
      } else if (msg.type === "track_update") {
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
      } else if (msg.type === "artist_ready") {
        queryClient.invalidateQueries({ queryKey: ["artists"] });
        return;
      } else {
        return; // not a download event — skip stats update
      }

      // Recompute stats from the updated jobs cache
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
    },
    [queryClient]
  );

  useWebSocketMessage(handler);
  return null;
}

export default function App() {
  return (
    <Layout>
      <DownloadSyncEffect />
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/artists" element={<ArtistsPage />} />
        <Route path="/artists/:id" element={<ArtistDetailPage />} />
        <Route path="/albums" element={<AlbumsPage />} />
        <Route path="/albums/:id" element={<AlbumDetailPage />} />
        <Route path="/downloads" element={<DownloadsPage />} />
        <Route path="/library" element={<Navigate to="/" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
