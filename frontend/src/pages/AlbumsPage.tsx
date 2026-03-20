import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Disc3, ArrowUp, ArrowDown, Search, X, LayoutList, LayoutGrid } from "lucide-react";
import { listAlbums, listArtists } from "@/api/client";
import AlbumSection from "@/components/AlbumSection";
import AlbumCard from "@/components/AlbumCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ReleaseGroup } from "@/types";

type Tab = "all" | "on-disk" | "missing";
type AlbumSortField = "date" | "title" | "avail";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { value: AlbumSortField; label: string }[] = [
  { value: "date",   label: "Release date" },
  { value: "title",  label: "Title" },
  { value: "avail",  label: "Availability" },
];

const DIR_LABELS: Record<AlbumSortField, { asc: string; desc: string }> = {
  date:   { asc: "Oldest first", desc: "Newest first" },
  title:  { asc: "A → Z",       desc: "Z → A" },
  avail:  { asc: "Missing first", desc: "On disk first" },
};

const PAGE_SIZE = 96; // divisible by 2, 3, 4, 6 — fits every grid column count cleanly

/** Observes a sentinel element and calls onVisible each time it enters the viewport.
 *  The observer is created once — the callback is kept in a ref so it stays current
 *  without causing the observer to reconnect on every render. */
function useSentinel(onVisible: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onVisible);
  cbRef.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) cbRef.current();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []); // empty deps — observer lives for the component lifetime
  return ref;
}

export default function AlbumsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [field, setField] = useState<AlbumSortField>(
    () => (localStorage.getItem("albumList.sortField") as AlbumSortField) ?? "date"
  );
  const [dir, setDir] = useState<SortDir>(
    () => (localStorage.getItem("albumList.sortDir") as SortDir) ?? "asc"
  );
  const [grouped, setGrouped] = useState(
    () => localStorage.getItem("albumList.grouped") !== "false"
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

  const artistMap = useMemo(
    () => Object.fromEntries(artists.map((a) => [a.id, a])),
    [artists]
  );

  const needle = search.trim().toLowerCase();

  const base = useMemo(
    () => (watchedOnly ? albums.filter((a) => a.watched) : albums),
    [albums, watchedOnly]
  );

  const tabFiltered = useMemo(
    () =>
      tab === "on-disk"
        ? base.filter((a) => a.folder_path !== null)
        : tab === "missing"
        ? base.filter((a) => a.folder_path === null)
        : base,
    [base, tab]
  );

  const filtered = useMemo(
    () =>
      needle ? tabFiltered.filter((a) => a.title.toLowerCase().includes(needle)) : tabFiltered,
    [tabFiltered, needle]
  );

  const counts = useMemo(() => ({
    all: base.length,
    "on-disk": base.filter((a) => a.folder_path !== null).length,
    missing: base.filter((a) => a.folder_path === null).length,
  }), [base]);

  // Reset visible windows when search or filters change
  useEffect(() => { setVisibleFlat(PAGE_SIZE); setVisibleGroups(PAGE_SIZE); }, [needle]);

  const setSort = (f: AlbumSortField, d: SortDir) => {
    setField(f); setDir(d);
    localStorage.setItem("albumList.sortField", f);
    localStorage.setItem("albumList.sortDir", d);
  };

  const sortedFlat = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (field === "date")  cmp = (a.first_release_date ?? "").localeCompare(b.first_release_date ?? "");
      if (field === "title") cmp = a.title.localeCompare(b.title);
      if (field === "avail") cmp = (a.folder_path !== null ? 1 : 0) - (b.folder_path !== null ? 1 : 0);
      return dir === "desc" ? -cmp : cmp;
    });
    return copy;
  }, [filtered, field, dir]);

  const sortedGroups = useMemo(() => {
    const groups = new Map<number, ReleaseGroup[]>();
    for (const album of filtered) {
      if (!groups.has(album.artist_id)) groups.set(album.artist_id, []);
      groups.get(album.artist_id)!.push(album);
    }
    return [...groups.entries()].sort(([aId], [bId]) => {
      const a = artistMap[aId]?.sort_name ?? artistMap[aId]?.name ?? "";
      const b = artistMap[bId]?.sort_name ?? artistMap[bId]?.name ?? "";
      const cmp = a.localeCompare(b);
      return dir === "desc" ? -cmp : cmp;
    });
  }, [filtered, artistMap, dir]);

  // ── Incremental rendering ──────────────────────────────────────────────────
  // Instead of mounting all cards at once, start with PAGE_SIZE items and add
  // more as the user scrolls to the bottom sentinel. This keeps initial render
  // fast even with 1000+ albums.

  const [visibleFlat, setVisibleFlat] = useState(PAGE_SIZE);
  const [visibleGroups, setVisibleGroups] = useState(PAGE_SIZE);

  // Reset window whenever the filtered / sorted set changes
  useEffect(() => { setVisibleFlat(PAGE_SIZE); }, [tab, field, dir, watchedOnly, grouped]);
  useEffect(() => { setVisibleGroups(PAGE_SIZE); }, [tab, dir, watchedOnly, grouped]);

  const flatSentinelRef = useSentinel(() =>
    setVisibleFlat((n) => Math.min(n + PAGE_SIZE, sortedFlat.length))
  );
  const groupSentinelRef = useSentinel(() =>
    setVisibleGroups((n) => Math.min(n + PAGE_SIZE, sortedGroups.length))
  );

  const visibleFlatItems = sortedFlat.slice(0, visibleFlat);
  const visibleGroupItems = sortedGroups.slice(0, visibleGroups);

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
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="search"
                placeholder="Filter albums…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-sm bg-muted border border-border rounded-md pl-8 pr-8 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-48"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
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
              {!grouped && (
                <>
                  <select
                    value={field}
                    onChange={(e) => setSort(e.target.value as AlbumSortField, dir)}
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
                </>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant={grouped ? "default" : "outline"}
                      size="icon-sm"
                      aria-label={grouped ? "Show flat list" : "Group by artist"}
                      onClick={() => {
                        setGrouped((g) => {
                          localStorage.setItem("albumList.grouped", String(!g));
                          return !g;
                        });
                      }}
                    />
                  }
                >
                  {grouped ? <LayoutList className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
                </TooltipTrigger>
                <TooltipContent>{grouped ? "Show flat grid" : "Group by artist"}</TooltipContent>
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
            {needle
              ? `No albums match "${search}".`
              : tab === "missing"
              ? "Nothing missing — you have everything!"
              : "No albums found."}
          </p>
        ) : grouped ? (
          <div className="space-y-10">
            {visibleGroupItems.map(([artistId, artistAlbums]) => {
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
            {visibleGroups < sortedGroups.length && (
              <div ref={groupSentinelRef} className="h-8" />
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {visibleFlatItems.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  artistName={artistMap[album.artist_id]?.name ?? ""}
                  onDisk={album.folder_path !== null}
                  showArtist
                />
              ))}
            </div>
            {visibleFlat < sortedFlat.length && (
              <div ref={flatSentinelRef} className="h-8 mt-4" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
