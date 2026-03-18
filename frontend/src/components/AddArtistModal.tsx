import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { Search, UserPlus, Loader2, Music2 } from "lucide-react";
import { searchArtists, subscribeArtist, getArtistThumb } from "@/api/client";
import type { Artist, MBArtistCandidate } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  onClose: () => void;
  onAdded?: (artist: Artist) => void;
}

export default function AddArtistModal({ onClose, onAdded }: Props) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MBArtistCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [thumbPreview, setThumbPreview] = useState<{ url: string; rect: DOMRect } | null>(null);
  const queryClient = useQueryClient();

  const close = () => { setOpen(false); setThumbPreview(null); };

  const subscribeMutation = useMutation({
    mutationFn: (candidate: MBArtistCandidate) =>
      subscribeArtist(candidate.mbid, candidate.name),
    onSuccess: (artist) => {
      queryClient.invalidateQueries({ queryKey: ["artists"] });
      onAdded?.(artist);
      close();
      onClose();
    },
  });

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchArtists(query);
        setResults(data);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [query]);

  // Lazy-load thumbnails for each result
  useEffect(() => {
    setThumbs({});
    if (results.length === 0) return;
    results.forEach((r) => {
      getArtistThumb(r.mbid)
        .then((data) =>
          setThumbs((prev) => ({ ...prev, [r.mbid]: data.image_url }))
        )
        .catch(() =>
          setThumbs((prev) => ({ ...prev, [r.mbid]: null }))
        );
    });
  }, [results]);

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o) { close(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>Add Artist</DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              placeholder="Search MusicBrainz…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-muted border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-primary placeholder-muted-foreground text-foreground"
            />
            {searching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <Separator />
        <ScrollArea className="max-h-80">
          {results.length === 0 && query.length >= 2 && !searching && (
            <p className="text-center text-muted-foreground text-sm py-8">
              No artists found
            </p>
          )}
          {results.map((r) => {
            const isThisRowPending = subscribeMutation.isPending && subscribeMutation.variables?.mbid === r.mbid;
            return (
            <button
              key={r.mbid}
              onClick={() => subscribeMutation.mutate(r)}
              disabled={subscribeMutation.isPending}
              className={`w-full text-left px-5 py-3 hover:bg-muted transition-colors flex items-center gap-3 group border-b border-border last:border-0 ${subscribeMutation.isPending && !isThisRowPending ? "opacity-40" : ""}`}
            >
              {/* Thumbnail */}
              <div
                className="w-10 h-10 rounded-md bg-muted border border-border flex-shrink-0 overflow-hidden flex items-center justify-center"
                onMouseEnter={(e) => {
                  const url = thumbs[r.mbid];
                  if (url) setThumbPreview({ url, rect: e.currentTarget.getBoundingClientRect() });
                }}
                onMouseLeave={() => setThumbPreview(null)}
              >
                {thumbs[r.mbid] ? (
                  <img src={thumbs[r.mbid]!} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music2 className="w-4 h-4 text-muted-foreground/40" />
                )}
              </div>

              {/* Name + disambiguation */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{r.name}</p>
                {r.disambiguation && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {r.disambiguation}
                  </p>
                )}
              </div>

              {/* Score + add icon */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <Tooltip>
                  <TooltipTrigger render={<span />} className="text-xs text-muted-foreground/60 tabular-nums">
                    {r.score}%
                  </TooltipTrigger>
                  <TooltipContent side="left">Match confidence</TooltipContent>
                </Tooltip>
                {isThisRowPending ? (
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                ) : (
                  <Tooltip>
                    <TooltipTrigger render={<span />} className="flex items-center">
                      <UserPlus className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent side="left">Add artist</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </button>
            );
          })}
        </ScrollArea>

        {subscribeMutation.isError && (
          <>
            <Separator />
            <p className="px-5 py-3 text-sm text-destructive">
              {subscribeMutation.error.message}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>

    {thumbPreview && createPortal(
      <div
        className="pointer-events-none fixed z-[200] w-48 h-48 rounded-lg overflow-hidden shadow-2xl border border-border"
        style={{
          top: thumbPreview.rect.top + thumbPreview.rect.height / 2 - 96,
          left: thumbPreview.rect.left - 202,
        }}
      >
        <img src={thumbPreview.url} alt="" className="w-full h-full object-cover block" />
      </div>,
      document.body
    )}
    </>
  );
}
