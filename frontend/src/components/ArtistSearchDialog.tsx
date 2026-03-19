import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { searchArtists, getArtistThumb } from "@/api/client";
import type { MBArtistCandidate } from "@/types";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Music2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ArtistSearchDialogProps {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
  title?: string;
  onConfirm: (mbid: string) => void;
  confirmLabel?: string;
}

export function ArtistSearchDialog({
  open,
  onClose,
  initialQuery = "",
  title = "Find artist",
  onConfirm,
  confirmLabel = "Import",
}: ArtistSearchDialogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<MBArtistCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<MBArtistCandidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [thumbPreview, setThumbPreview] = useState<{ url: string; rect: DOMRect } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setResults([]);
      setSelected(null);
      setConfirming(false);
      setThumbPreview(null);
    }
  }, [open, initialQuery]);

  // Debounced search
  useEffect(() => {
    if (!open || query.length < 2) {
      setResults([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchArtists(query));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query]);

  // Lazy-load thumbnails whenever results change
  useEffect(() => {
    setThumbs({});
    if (results.length === 0) return;
    results.forEach((r) => {
      getArtistThumb(r.mbid)
        .then((data) => setThumbs((prev) => ({ ...prev, [r.mbid]: data.image_url })))
        .catch(() => setThumbs((prev) => ({ ...prev, [r.mbid]: null })));
    });
  }, [results]);

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setSelected(null); }}
                placeholder="Search MusicBrainz…"
                className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary placeholder:text-muted-foreground"
                autoFocus
              />
              {searching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                </div>
              )}
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {results.map((c) => (
                <button
                  key={c.mbid}
                  onClick={() => setSelected(c)}
                  className={cn(
                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-3",
                    selected?.mbid === c.mbid
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted text-foreground"
                  )}
                >
                  {/* Thumbnail */}
                  <div
                    className="w-8 h-8 rounded bg-muted border border-border flex-shrink-0 overflow-hidden flex items-center justify-center"
                    onMouseEnter={(e) => {
                      const url = thumbs[c.mbid];
                      if (url) setThumbPreview({ url, rect: e.currentTarget.getBoundingClientRect() });
                    }}
                    onMouseLeave={() => setThumbPreview(null)}
                  >
                    {thumbs[c.mbid] ? (
                      <img src={thumbs[c.mbid]!} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Music2 className="w-3.5 h-3.5 text-muted-foreground/40" />
                    )}
                  </div>

                  {/* Name + disambiguation */}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium truncate block">{c.name}</span>
                    {c.disambiguation && (
                      <span
                        className={cn(
                          "text-xs truncate block",
                          selected?.mbid === c.mbid ? "text-primary-foreground/70" : "text-muted-foreground"
                        )}
                      >
                        {c.disambiguation}
                      </span>
                    )}
                  </div>

                  {/* Score */}
                  <span
                    className={cn(
                      "text-xs tabular-nums flex-shrink-0",
                      selected?.mbid === c.mbid ? "text-primary-foreground/70" : "text-muted-foreground"
                    )}
                  >
                    {c.score}%
                  </span>
                </button>
              ))}
              {results.length === 0 && !searching && query.length >= 2 && (
                <p className="text-xs text-muted-foreground px-1">No results</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={confirming} />}>Cancel</DialogClose>
            <Button
              disabled={!selected || confirming}
              onClick={async () => {
                if (!selected) return;
                setConfirming(true);
                try {
                  await onConfirm(selected.mbid);
                } finally {
                  setConfirming(false);
                }
              }}
            >
              {confirming && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirming ? "Saving…" : confirmLabel}
            </Button>
          </DialogFooter>
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
