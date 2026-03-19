export interface Artist {
  id: number;
  mbid: string;
  name: string;
  sort_name: string | null;
  disambiguation: string | null;
  image_url: string | null;
  wikidata_id: string | null;
  bio: string | null;
  folder_name: string | null;
  subscribed: boolean;
  created_at: string;
}

export interface ReleaseGroup {
  id: number;
  mbid: string;
  artist_id: number;
  title: string;
  primary_type: string | null;
  secondary_types: string | null;
  first_release_date: string | null;
  cover_art_url: string | null;
  folder_path: string | null;
  cover_art_hash: string | null;
  description: string | null;
  watched: boolean;
  tracks_fetched: boolean;
  track_count: number;
}

export interface Track {
  id: number;
  mbid: string | null;
  release_group_id: number;
  title: string;
  track_number: number | null;
  disc_number: number;
  duration_ms: number | null;
  file_path: string | null;
  tag_title: string | null;
  tag_artist: string | null;
  tag_album: string | null;
  tag_track_number: string | null;
  tag_art_hash: string | null;
  tags_scanned_at: string | null;
}

export interface DownloadTrackJob {
  id: number;
  job_id: number;
  track_id: number;
  status: "queued" | "downloading" | "completed" | "failed";
  yt_video_id: string | null;
  yt_search_query: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface DownloadJob {
  id: number;
  release_group_id: number | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  total_tracks: number;
  completed_tracks: number;
  current_track_title: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  track_jobs: DownloadTrackJob[];
}

export interface DownloadSettings {
  id: number;
  audio_format: string;
  yt_format: string;
  delay_min: number;
  delay_max: number;
  cookies_file: string | null;
  rate_limit_bps: number | null;
  album_languages: string;
  scan_min_confidence: number;
  max_retries: number;
  concurrent_fragment_downloads: number;
  geo_bypass: boolean;
  proxy: string | null;
  sponsorblock_remove: string;
  yt_search_results: number;
  search_query_template: string;
  release_types: string;
}

export interface MBArtistCandidate {
  mbid: string;
  name: string;
  sort_name: string;
  disambiguation: string | null;
  score: number;
}

export interface ImportResult {
  imported: Artist[];
  skipped: string[];
  errors: { mbid: string; error: string }[];
  files_linked: number;
}

export interface Stats {
  artists: number;
  albums: number;
  tracks: number;
  files_linked: number;
  active_downloads: number;
  download_tracks_completed: number;
  download_tracks_total: number;
}

export interface DiskFolder {
  folder_name: string;
  folder_path: string;
  file_count: number;
}

export interface MatchedAlbum {
  release_group: ReleaseGroup;
  folder_path: string;
  file_count: number;
}

export interface ArtistDiskStatus {
  matched: MatchedAlbum[];
  missing: ReleaseGroup[];
  unmatched_folders: DiskFolder[];
}

export interface MissingAlbum {
  release_group: ReleaseGroup;
  artist_name: string;
  artist_id: number;
  tracks_fetched: boolean;
}

export interface OrphanedFile {
  path: string;
  filename: string;
  relative_path: string;
  size_bytes: number;
}

export interface OrphanedFilePage {
  items: OrphanedFile[];
  total: number;
  offset: number;
  has_more: boolean;
}

// ── Artwork ────────────────────────────────────────────────────────────────────

export interface ArtworkOption {
  source: string;
  label: string;
  url: string;
  thumbnail_url: string;
  front?: boolean;
}

// ── Tag status ─────────────────────────────────────────────────────────────────

export interface TagFieldStatus {
  field: string;
  expected: string | null;
  actual: string | null;
}

export interface TrackTagStatus {
  track_id: number;
  file_path: string | null;
  tags_scanned_at: string | null;
  in_sync: boolean;
  issues: TagFieldStatus[];
}

export interface AlbumTagStatus {
  release_group_id: number;
  tracks: TrackTagStatus[];
}

// ── Retag jobs ─────────────────────────────────────────────────────────────────

export interface RetagTrackJobIn {
  track_id: number;
  fields: string[];
}

export interface RetagJobIn {
  release_group_id: number;
  track_jobs: RetagTrackJobIn[];
}

export interface RetagTrackJobOut {
  id: number;
  track_id: number;
  fields: string[];
  status: string;
  error_message: string | null;
}

export interface RetagJobOut {
  id: number;
  release_group_id: number | null;
  status: string;
  total_tracks: number;
  completed_tracks: number;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  track_jobs: RetagTrackJobOut[];
}

// WebSocket message types
export type WSMessage =
  | { type: "job_update"; payload: DownloadJob }
  | {
      type: "track_update";
      payload: {
        job_id: number;
        track_job: DownloadTrackJob;
        job_progress: {
          completed: number;
          total: number;
          current_track: string;
        };
      };
    }
  | {
      type: "retag_progress";
      payload: {
        job_id: number;
        status: string;
        total: number;
        completed: number;
      };
    }
  | {
      type: "retag_complete";
      payload: { job_id: number; status: string };
    }
  | { type: "artist_ready"; payload: Artist }
  | { type: "scan_started"; total: number }
  | {
      type: "scan_progress";
      scan_done: number;
      scan_total: number;
      import_done: number;
      import_total: number;
      current_step: string | null;
    }
  | { type: "scan_log"; entry: { type: string; label: string; album_count?: number } }
  | {
      type: "scan_done";
      completed_at: string | null;
      summary: {
        artists_imported: number;
        albums_imported: number;
        files_linked: number;
        needs_review_count: number;
        elapsed_seconds: number;
      };
    }
  | { type: "scan_error"; error: string };
