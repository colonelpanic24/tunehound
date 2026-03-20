import type {
  AlbumGroupsPage,
  AlbumTagStatus,
  AlbumsPage,
  Artist,
  ArtistDiskStatus,
  ArtworkOption,
  DownloadJob,
  DownloadSettings,
  MBArtistCandidate,
  MissingAlbum,
  OrphanedFilePage,
  ReleaseGroup,
  RetagJobIn,
  RetagJobOut,
  Stats,
  Track,
} from "@/types";

const BASE = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Artists ────────────────────────────────────────────────────────────────────

export const searchArtists = (q: string) =>
  request<MBArtistCandidate[]>(`/artists/search?q=${encodeURIComponent(q)}`);

export const getArtistThumb = (mbid: string) =>
  request<{ image_url: string | null }>(`/artists/thumb/${mbid}`);

export const listArtists = () => request<Artist[]>("/artists");

export const getArtist = (id: number) => request<Artist>(`/artists/${id}`);

export const subscribeArtist = (mbid: string, name: string) =>
  request<Artist>("/artists", {
    method: "POST",
    body: JSON.stringify({ mbid, name }),
  });

export const unsubscribeArtist = (id: number, deleteFiles = false) =>
  request<void>(`/artists/${id}?delete_files=${deleteFiles}`, { method: "DELETE" });

export const getArtistAlbums = (artistId: number) =>
  request<ReleaseGroup[]>(`/artists/${artistId}/albums`);

export const getArtistDiskStatus = (artistId: number) =>
  request<ArtistDiskStatus>(`/artists/${artistId}/disk-status`);

export const relinkArtist = (id: number) =>
  request<{ files_linked: number }>(`/artists/${id}/relink`, { method: "POST" });

export const rematchArtist = (id: number, mbid: string) =>
  request<Artist>(`/artists/${id}/rematch`, {
    method: "POST",
    body: JSON.stringify({ mbid }),
  });

// ── Albums ─────────────────────────────────────────────────────────────────────

export interface AlbumParams {
  offset?: number;
  limit?: number;
  sort?: string;
  dir?: string;
  avail?: string;
  search?: string;
  watched_only?: boolean;
}

export const listAlbums = (params: AlbumParams = {}) => {
  const q = new URLSearchParams();
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.sort) q.set("sort", params.sort);
  if (params.dir) q.set("dir", params.dir);
  if (params.avail) q.set("avail", params.avail);
  if (params.search) q.set("search", params.search);
  if (params.watched_only) q.set("watched_only", "true");
  return request<AlbumsPage>(`/albums?${q}`);
};

export const listAlbumGroups = (params: AlbumParams = {}) => {
  const q = new URLSearchParams();
  q.set("grouped", "true");
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.dir) q.set("dir", params.dir);
  if (params.avail) q.set("avail", params.avail);
  if (params.search) q.set("search", params.search);
  if (params.watched_only) q.set("watched_only", "true");
  return request<AlbumGroupsPage>(`/albums?${q}`);
};

export const getAlbum = (id: number) => request<ReleaseGroup>(`/albums/${id}`);

export const updateAlbum = (id: number, patch: { watched?: boolean }) =>
  request<ReleaseGroup>(`/albums/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export const getAlbumTracks = (id: number) =>
  request<Track[]>(`/albums/${id}/tracks`);

// ── Downloads ──────────────────────────────────────────────────────────────────

export const createDownloadJob = (release_group_id: number) =>
  request<DownloadJob>("/downloads/jobs", {
    method: "POST",
    body: JSON.stringify({ release_group_id }),
  });

export const createTrackDownloadJob = (track_id: number) =>
  request<DownloadJob>("/downloads/track-jobs", {
    method: "POST",
    body: JSON.stringify({ track_id }),
  });

export const listDownloadJobs = () =>
  request<DownloadJob[]>("/downloads/jobs");

export const getDownloadJob = (id: number) =>
  request<DownloadJob>(`/downloads/jobs/${id}`);

export const stopDownloadJob = (id: number) =>
  request<void>(`/downloads/jobs/${id}/stop`, { method: "POST" });

export const deleteDownloadJob = (id: number) =>
  request<void>(`/downloads/jobs/${id}`, { method: "DELETE" });

export const clearAllDownloadJobs = () =>
  request<void>("/downloads/jobs", { method: "DELETE" });

export const getDownloadSettings = () =>
  request<DownloadSettings>("/downloads/settings");

export const updateDownloadSettings = (patch: Partial<DownloadSettings>) =>
  request<DownloadSettings>("/downloads/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

// ── Stats ──────────────────────────────────────────────────────────────────────

export const getStats = () => request<Stats>("/stats");

// ── Library ────────────────────────────────────────────────────────────────────

export const getMissingAlbumCount = () =>
  request<{ count: number }>("/library/missing/count");
export const getMissingAlbums = () => request<MissingAlbum[]>("/library/missing");
export const getOrphanedFiles = (offset = 0, limit = 250) =>
  request<OrphanedFilePage>(`/library/orphaned?offset=${offset}&limit=${limit}`);

export const syncFileLinks = () =>
  request<{ artists_processed: number; files_linked: number; files_unlinked: number }>(
    "/library/sync-files",
    { method: "POST" }
  );

export const rescanTags = () =>
  request<{ tracks_updated: number }>("/library/rescan-tags", { method: "POST" });

// ── Artwork ─────────────────────────────────────────────────────────────────────

export const getArtistArtworkOptions = (id: number) =>
  request<ArtworkOption[]>(`/artists/${id}/artwork-options`);

export const updateArtistArtwork = (id: number, url: string, writeToDisk = true) =>
  request<Artist>(`/artists/${id}/artwork`, {
    method: "POST",
    body: JSON.stringify({ url, write_to_folder: writeToDisk }),
  });

export const updateArtistArtworkUpload = (id: number, file: File, writeToDisk = true) => {
  const form = new FormData();
  form.append("file", file);
  form.append("write_to_folder", writeToDisk ? "1" : "0");
  return fetch(`/api/artists/${id}/artwork/upload`, { method: "POST", body: form })
    .then((r) => r.json()) as Promise<Artist>;
};

export const getAlbumArtworkOptions = (id: number) =>
  request<ArtworkOption[]>(`/albums/${id}/artwork-options`);

export const updateAlbumArtwork = (id: number, url: string) =>
  request<ReleaseGroup>(`/albums/${id}/artwork`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });

export const updateAlbumArtworkUpload = (id: number, file: File) => {
  const form = new FormData();
  form.append("file", file);
  return fetch(`/api/albums/${id}/artwork/upload`, { method: "POST", body: form })
    .then((r) => r.json()) as Promise<ReleaseGroup>;
};

// ── Tag status ──────────────────────────────────────────────────────────────────

export const getAlbumTagStatus = (id: number) =>
  request<AlbumTagStatus>(`/albums/${id}/tag-status`);

export const scanAlbumTags = (id: number) =>
  request<AlbumTagStatus>(`/albums/${id}/scan-tags`, { method: "POST" });

// ── Retag jobs ──────────────────────────────────────────────────────────────────

export const createRetagJob = (body: RetagJobIn) =>
  request<RetagJobOut>("/retag-jobs", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getRetagJob = (id: number) =>
  request<RetagJobOut>(`/retag-jobs/${id}`);

export const getLatestRetagJob = (albumId: number) =>
  request<RetagJobOut | null>(`/retag-jobs/album/${albumId}`);
