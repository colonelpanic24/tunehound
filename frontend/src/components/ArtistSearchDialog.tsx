import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchArtists } from "@/api/client";
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
import { Loader2 } from "lucide-react";
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
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<MBArtistCandidate | null>(null);
  const [confirming, setConfirming] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchQuery = useQuery({
    queryKey: ["mb-search", debouncedQuery],
    queryFn: () => searchArtists(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setDebouncedQuery(initialQuery);
      setSelected(null);
      setConfirming(false);
    }
  }, [open, initialQuery]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(value), 800);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search MusicBrainz…"
            className="w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary placeholder:text-muted-foreground"
            autoFocus
          />
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {(searchQuery.isFetching || debouncedQuery !== query) && (
              <p className="text-xs text-muted-foreground px-1">Searching…</p>
            )}
            {searchQuery.data?.map((c) => (
              <button
                key={c.mbid}
                onClick={() => setSelected(c)}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                  selected?.mbid === c.mbid
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <span className="font-medium">{c.name}</span>
                {c.disambiguation && (
                  <span
                    className={cn(
                      "ml-1 text-xs",
                      selected?.mbid === c.mbid
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {c.disambiguation}
                  </span>
                )}
                <span
                  className={cn(
                    "ml-2 text-xs tabular-nums",
                    selected?.mbid === c.mbid
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  )}
                >
                  {c.score}%
                </span>
              </button>
            ))}
            {searchQuery.data?.length === 0 &&
              !searchQuery.isFetching &&
              query.length >= 2 && (
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
  );
}
