import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Disc3, ArrowUp, ArrowDown, Search, X, LayoutList, LayoutGrid } from "lucide-react";
import { listAlbums, listAlbumGroups, listArtists } from "@/api/client";
import AlbumSection from "@/components/AlbumSection";
import AlbumCard from "@/components/AlbumCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AlbumCounts } from "@/types";

type Tab = "all" | "on-disk" | "missing";
type AlbumSortField = "date" | "title" | "avail";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { value: AlbumSortField; label: string }[] = [
  { value: "date",  label: "Release date" },
  { value: "title", label: "Title" },
  { value: "avail", label: "Availability" },
];

const DIR_LABELS: Record<AlbumSortField, { asc: string; desc: string }> = {
  date:  { asc: "Oldest first", desc: "Newest first" },
  title: { asc: "A → Z",        desc: "Z → A" },
  avail: { asc: "Missing first", desc: "On disk first" },
};

const FLAT_PAGE = 96;
const GROUP_PAGE = 20; // artists per page in grouped mode

function useSentinel(onVisible: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const cbRef = useRef(onVisible);
  useLayoutEffect(() => { cbRef.current = onVisible; });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) cbRef.current();
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

export default function AlbumsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("all");
  const [searchValue, setSearchValue] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
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

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchValue), 300);
    return () => clearTimeout(t);
  }, [searchValue]);

  const commonParams = {
    avail: tab,
    search: debouncedSearch,
    watched_only: watchedOnly,
  };

  const flatQuery = useInfiniteQuery({
    queryKey: ["albums", "flat", { field, dir, ...commonParams }],
    queryFn: ({ pageParam }) =>
      listAlbums({ offset: pageParam, limit: FLAT_PAGE, sort: field, dir, ...commonParams }),
    enabled: !grouped,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    staleTime: 60_000,
  });

  const groupedQuery = useInfiniteQuery({
    queryKey: ["albums", "grouped", { dir, ...commonParams }],
    queryFn: ({ pageParam }) =>
      listAlbumGroups({ offset: pageParam, limit: GROUP_PAGE, dir, ...commonParams }),
    enabled: grouped,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((s, p) => s + p.items.length, 0);
      return loaded < lastPage.total ? loaded : undefined;
    },
    staleTime: 60_000,
  });

  // For the flat view we still need artist names for cards
  const { data: artists = [] } = useQuery({
    queryKey: ["artists"],
    queryFn: listArtists,
    staleTime: 60_000,
  });
  const artistMap = Object.fromEntries(artists.map((a) => [a.id, a]));

  const activeQuery = grouped ? groupedQuery : flatQuery;
  const isLoading = activeQuery.isLoading;
  const isFetchingMore = activeQuery.isFetchingNextPage;
  const hasMore = activeQuery.hasNextPage;

  const counts: AlbumCounts = activeQuery.data?.pages[0]?.counts ?? { all: 0, on_disk: 0, missing: 0 };

  const flatItems = flatQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const groupItems = groupedQuery.data?.pages.flatMap((p) => p.items) ?? [];

  const flatSentinelRef = useSentinel(() => {
    if (!grouped && flatQuery.hasNextPage && !flatQuery.isFetchingNextPage)
      flatQuery.fetchNextPage();
  });
  const groupSentinelRef = useSentinel(() => {
    if (grouped && groupedQuery.hasNextPage && !groupedQuery.isFetchingNextPage)
      groupedQuery.fetchNextPage();
  });

  const setSort = (f: AlbumSortField, d: SortDir) => {
    setField(f); setDir(d);
    localStorage.setItem("albumList.sortField", f);
    localStorage.setItem("albumList.sortDir", d);
  };

  const totalShown = grouped
    ? groupItems.reduce((s, g) => s + g.albums.length, 0)
    : flatItems.length;
  const needle = debouncedSearch;

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
                  { key: "all",     label: "All" },
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
                    {(counts[key === "on-disk" ? "on_disk" : key] ?? 0).toLocaleString()}
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
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="text-sm bg-muted border border-border rounded-md pl-8 pr-8 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary w-48"
              />
              {searchValue && (
                <button
                  onClick={() => setSearchValue("")}
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
        ) : totalShown === 0 && !hasMore ? (
          <p className="text-muted-foreground text-sm py-12 text-center">
            {needle
              ? `No albums match "${needle}".`
              : tab === "missing"
              ? "Nothing missing — you have everything!"
              : "No albums found."}
          </p>
        ) : grouped ? (
          <div className="space-y-10">
            {groupItems.map((group) => (
              <section key={group.artist_id}>
                <button
                  onClick={() => navigate(`/artists/${group.artist_id}`)}
                  className="flex items-center gap-2 mb-3 group"
                >
                  {group.artist_image_url && (
                    <img
                      src={group.artist_image_url}
                      alt=""
                      className="w-6 h-6 rounded-full object-cover object-top shrink-0"
                    />
                  )}
                  <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                    {group.artist_name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {group.albums.length} album{group.albums.length !== 1 ? "s" : ""}
                  </span>
                </button>
                <AlbumSection
                  items={group.albums.map((album) => ({
                    album,
                    onDisk: album.folder_path !== null,
                  }))}
                  artistName={group.artist_name}
                />
              </section>
            ))}
            {hasMore && <div ref={groupSentinelRef} className="h-8" />}
            {isFetchingMore && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="aspect-square bg-muted rounded-xl" />
                    <div className="h-4 bg-muted rounded mt-2" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {flatItems.map((album) => (
                <AlbumCard
                  key={album.id}
                  album={album}
                  artistName={artistMap[album.artist_id]?.name ?? ""}
                  onDisk={album.folder_path !== null}
                  showArtist
                />
              ))}
            </div>
            {hasMore && <div ref={flatSentinelRef} className="h-8 mt-4" />}
            {isFetchingMore && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 mt-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="animate-pulse">
                    <div className="aspect-square bg-muted rounded-xl" />
                    <div className="h-4 bg-muted rounded mt-2" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
