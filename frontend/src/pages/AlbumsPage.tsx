import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Disc3, ArrowUp, ArrowDown } from "lucide-react";
import { listAlbums, listArtists } from "@/api/client";
import AlbumSection from "@/components/AlbumSection";
import AlbumCard from "@/components/AlbumCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReleaseGroup } from "@/types";

type Tab = "all" | "on-disk" | "missing";
type AlbumSortField = "artist" | "date" | "title" | "avail";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { value: AlbumSortField; label: string }[] = [
  { value: "artist", label: "Artist" },
  { value: "date",   label: "Release date" },
  { value: "title",  label: "Title" },
  { value: "avail",  label: "Availability" },
];

const DIR_LABELS: Record<AlbumSortField, { asc: string; desc: string }> = {
  artist: { asc: "A → Z",       desc: "Z → A" },
  date:   { asc: "Oldest first", desc: "Newest first" },
  title:  { asc: "A → Z",       desc: "Z → A" },
  avail:  { asc: "Missing first", desc: "On disk first" },
};

export default function AlbumsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [field, setField] = useState<AlbumSortField>(
    () => (localStorage.getItem("albumList.sortField") as AlbumSortField) ?? "artist"
  );
  const [dir, setDir] = useState<SortDir>(
    () => (localStorage.getItem("albumList.sortDir") as SortDir) ?? "asc"
  );
  const [watchedOnly, setWatchedOnly] = useState(
    () => localStorage.getItem("albumList.watchedOnly") === "true"
  );

  const { data: albums = [], isLoading } = useQuery({
    queryKey: ["albums"],
    queryFn: listAlbums,
    staleTime: 60_000,
  });

  const { data: artists = [] } = useQuery({
    queryKey: ["artists"],
    queryFn: listArtists,
  });

  const artistMap = Object.fromEntries(artists.map((a) => [a.id, a]));

  const base = watchedOnly ? albums.filter((a) => a.watched) : albums;
  const filtered =
    tab === "on-disk"
      ? base.filter((a) => a.folder_path !== null)
      : tab === "missing"
      ? base.filter((a) => a.folder_path === null)
      : base;

  const counts = {
    all: base.length,
    "on-disk": base.filter((a) => a.folder_path !== null).length,
    missing: base.filter((a) => a.folder_path === null).length,
  };

  const setSort = (f: AlbumSortField, d: SortDir) => {
    setField(f); setDir(d);
    localStorage.setItem("albumList.sortField", f);
    localStorage.setItem("albumList.sortDir", d);
  };

  const isGroupedByArtist = field === "artist";

  const sortedFlat = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (field === "date")  cmp = (a.first_release_date ?? "").localeCompare(b.first_release_date ?? "");
    if (field === "title") cmp = a.title.localeCompare(b.title);
    if (field === "avail") cmp = (a.folder_path !== null ? 1 : 0) - (b.folder_path !== null ? 1 : 0);
    return dir === "desc" ? -cmp : cmp;
  });

  // Grouped by artist (for "artist" field)
  const groups = new Map<number, ReleaseGroup[]>();
  for (const album of filtered) {
    if (!groups.has(album.artist_id)) groups.set(album.artist_id, []);
    groups.get(album.artist_id)!.push(album);
  }
  const sortedGroups = [...groups.entries()].sort(([aId], [bId]) => {
    const a = artistMap[aId]?.sort_name ?? artistMap[aId]?.name ?? "";
    const b = artistMap[bId]?.sort_name ?? artistMap[bId]?.name ?? "";
    const cmp = a.localeCompare(b);
    return dir === "desc" ? -cmp : cmp;
  });

  return (
    <div className="flex flex-col min-h-full">
      {/* Header + tabs */}
      <div className="border-b border-border px-6 pt-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-3 mb-4">
          <Disc3 className="w-6 h-6 text-primary" />
          Albums
        </h1>
        <div className="flex items-end justify-between">
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList variant="line" className="h-auto gap-0">
              {(
                [
                  { key: "all", label: "All" },
                  { key: "on-disk", label: "On Disk" },
                  { key: "missing", label: "Missing" },
                ] as { key: Tab; label: string }[]
              ).map(({ key, label }) => (
                <TabsTrigger key={key} value={key} className="px-4 py-3 rounded-none gap-2">
                  {label}
                  <Badge
                    variant={tab === key ? "default" : "secondary"}
                    className="h-4 px-1.5 text-xs"
                  >
                    {counts[key].toLocaleString()}
                  </Badge>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="pb-2 flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={watchedOnly}
                onChange={(e) => {
                  setWatchedOnly(e.target.checked);
                  localStorage.setItem("albumList.watchedOnly", e.target.checked ? "true" : "false");
                }}
                className="w-4 h-4 accent-primary"
              />
              Watched only
            </label>
            <div className="flex items-center gap-1">
              <select
                value={field}
                onChange={(e) => setSort(e.target.value as AlbumSortField, dir)}
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
                      onClick={() => setSort(field, dir === "asc" ? "desc" : "asc")}
                    />
                  }
                >
                  {dir === "asc" ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                </TooltipTrigger>
                <TooltipContent>{DIR_LABELS[field][dir]}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-square bg-muted rounded-xl" />
                <div className="h-4 bg-muted rounded mt-2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm py-12 text-center">
            {tab === "missing" ? "Nothing missing — you have everything!" : "No albums found."}
          </p>
        ) : isGroupedByArtist ? (
          <div className="space-y-10">
            {sortedGroups.map(([artistId, artistAlbums]) => {
              const artist = artistMap[artistId];
              return (
                <section key={artistId}>
                  <button
                    onClick={() => navigate(`/artists/${artistId}`)}
                    className="flex items-center gap-2 mb-3 group"
                  >
                    {artist?.image_url && (
                      <img
                        src={artist.image_url}
                        alt=""
                        className="w-6 h-6 rounded-full object-cover object-top shrink-0"
                      />
                    )}
                    <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                      {artist?.name ?? `Artist ${artistId}`}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {artistAlbums.length} album{artistAlbums.length !== 1 ? "s" : ""}
                    </span>
                  </button>
                  <AlbumSection
                    items={artistAlbums.map((album) => ({
                      album,
                      onDisk: album.folder_path !== null,
                    }))}
                    artistName={artist?.name ?? ""}
                  />
                </section>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {sortedFlat.map((album) => (
              <AlbumCard
                key={album.id}
                album={album}
                artistName={artistMap[album.artist_id]?.name ?? ""}
                onDisk={album.folder_path !== null}
                showArtist
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
