import { useState, useEffect } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, UserX, ArrowUp, ArrowDown } from "lucide-react";
import { listArtists, listAlbums, unsubscribeArtist } from "@/api/client";
import AddArtistModal from "@/components/AddArtistModal";
import type { Artist } from "@/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type ArtistSortField = "name" | "added" | "avail";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { value: ArtistSortField; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "added", label: "Date added" },
  { value: "avail", label: "Availability" },
];

const DIR_LABELS: Record<ArtistSortField, { asc: string; desc: string }> = {
  name:  { asc: "A → Z",        desc: "Z → A" },
  added: { asc: "Oldest first",  desc: "Newest first" },
  avail: { asc: "Least first",   desc: "Most first" },
};

/** Interpolates green (100%) → yellow (75%) → red (≤25%) */
function availColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct));
  if (p >= 75) {
    const t = (p - 75) / 25;
    return `hsl(${Math.round(50 + t * 92)} 75% 45%)`;
  }
  if (p >= 25) {
    const t = (p - 25) / 50;
    return `hsl(${Math.round(t * 50)} 80% 50%)`;
  }
  return "hsl(0 72% 50%)";
}

export default function ArtistsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const [field, setField] = useState<ArtistSortField>(
    () => (localStorage.getItem("artistList.sortField") as ArtistSortField) ?? "name"
  );
  const [dir, setDir] = useState<SortDir>(
    () => (localStorage.getItem("artistList.sortDir") as SortDir) ?? "asc"
  );

  const { data: artists = [], isLoading } = useQuery({
    queryKey: ["artists"],
    queryFn: listArtists,
  });

  const { data: albums = [] } = useQuery({
    queryKey: ["albums"],
    queryFn: listAlbums,
    staleTime: 60_000,
  });

  // availability: fraction of albums on disk per artist (0–1)
  const availMap = new Map<number, number>();
  for (const artist of artists) {
    const artistAlbums = albums.filter((a) => a.artist_id === artist.id);
    availMap.set(
      artist.id,
      artistAlbums.length === 0
        ? 0
        : artistAlbums.filter((a) => a.folder_path !== null).length / artistAlbums.length
    );
  }

  const sorted = [...artists].sort((a, b) => {
    let cmp = 0;
    if (field === "name")  cmp = (a.sort_name ?? a.name).localeCompare(b.sort_name ?? b.name);
    if (field === "added") cmp = a.created_at.localeCompare(b.created_at);
    if (field === "avail") cmp = (availMap.get(a.id) ?? 0) - (availMap.get(b.id) ?? 0);
    return dir === "desc" ? -cmp : cmp;
  });

  const setSort = (f: ArtistSortField, d: SortDir) => {
    setField(f); setDir(d);
    localStorage.setItem("artistList.sortField", f);
    localStorage.setItem("artistList.sortDir", d);
  };

  useEffect(() => {
    if (!folderNotice) return;
    const id = setTimeout(() => setFolderNotice(null), 6000);
    return () => clearTimeout(id);
  }, [folderNotice]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Artists</h1>
        <div className="flex items-center gap-2">
          <select
            value={field}
            onChange={(e) => setSort(e.target.value as ArtistSortField, dir)}
            aria-label="Sort by"
            className="text-sm bg-muted border border-border rounded-md px-3 py-1.5 text-foreground focus:outline-none focus:border-primary"
          >
            {SORT_FIELDS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={DIR_LABELS[field][dir]}
                  onClick={() => setSort(field, dir === "asc" ? "desc" : "asc")}
                />
              }
            >
              {dir === "asc" ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
            </TooltipTrigger>
            <TooltipContent>{DIR_LABELS[field][dir]}</TooltipContent>
          </Tooltip>
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="w-4 h-4" />
            Add Artist
          </Button>
        </div>
      </div>

      {folderNotice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-muted border border-border text-sm text-foreground flex items-center justify-between gap-4">
          <span>
            Artist folder <span className="font-medium">"{folderNotice}"</span> already exists in your library and has been linked.
          </span>
          <button
            onClick={() => setFolderNotice(null)}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-square shimmer rounded-xl" />
              <div className="h-4 shimmer rounded mt-2 mx-2" />
            </div>
          ))}
        </div>
      ) : artists.length === 0 ? (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-lg">No artists yet.</p>
          <p className="text-sm mt-1">Click "Add Artist" to subscribe to your first artist.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {sorted.map((artist) => (
            <ArtistCard
              key={artist.id}
              artist={artist}
              availability={availMap.get(artist.id) ?? 0}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddArtistModal
          onClose={() => setShowAdd(false)}
          onAdded={(artist) => {
            if (artist.folder_name) setFolderNotice(artist.folder_name);
          }}
        />
      )}
    </div>
  );
}

function ArtistCard({
  artist,
  availability,
}: {
  artist: Artist;
  availability: number;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => unsubscribeArtist(artist.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["artists"] }),
  });

  const pct = Math.round(availability * 100);

  return (
    <div
      className="group relative cursor-pointer"
      onClick={() => navigate(`/artists/${artist.id}`)}
    >
      <div className="aspect-square bg-muted rounded-xl overflow-hidden relative">
        {artist.image_url ? (
          <img
            src={artist.image_url}
            alt={artist.name}
            className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-4xl font-bold select-none">
            {artist.name.charAt(0).toUpperCase()}
          </div>
        )}
        {/* Name overlay */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent pt-8 pb-2 px-2">
          <p className="text-sm font-semibold text-white leading-tight truncate drop-shadow">
            {artist.name}
          </p>
          {artist.disambiguation && (
            <p className="text-xs text-white/70 truncate">{artist.disambiguation}</p>
          )}
        </div>
        {/* Availability badge */}
        <div
          className="absolute bottom-2 right-2 bg-black/60 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums"
          style={{ color: availColor(pct) }}
        >
          {pct}%
        </div>
      </div>

      {/* Remove button */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${artist.name}`}
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Remove ${artist.name}?`)) removeMutation.mutate();
              }}
              className="absolute top-2 right-2 bg-card/80 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-all"
            />
          }
        >
          <UserX className="w-3.5 h-3.5" />
        </TooltipTrigger>
        <TooltipContent>Remove artist</TooltipContent>
      </Tooltip>
    </div>
  );
}
