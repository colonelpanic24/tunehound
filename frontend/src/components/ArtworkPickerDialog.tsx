import { useState, useRef } from "react";
import { Loader2, Upload, Check, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ArtworkOption } from "@/types";

interface Props {
  title: string;
  options: ArtworkOption[];
  loading: boolean;
  onSelect: (url: string, writeToDisk: boolean) => void;
  onUpload: (file: File, writeToDisk: boolean) => void;
  onClose: () => void;
  isPending?: boolean;
  showWriteToDisk?: boolean;
  writeToDiskLabel?: string;
}

export function ArtworkPickerDialog({
  title,
  options,
  loading,
  onSelect,
  onUpload,
  onClose,
  isPending,
  showWriteToDisk = false,
  writeToDiskLabel = "Copy to music folder",
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [writeToDisk, setWriteToDisk] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-2xl p-0 gap-0 overflow-hidden"
      >
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : options.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No options found from online sources.
            </p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {options.map((opt) => (
                <button
                  key={opt.url}
                  onClick={() => setSelected(opt.url)}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    selected === opt.url
                      ? "border-primary ring-2 ring-primary/30"
                      : "border-border hover:border-primary/50"
                  }`}
                >
                  <img
                    src={opt.thumbnail_url}
                    alt={opt.label}
                    className="w-full h-full object-cover"
                  />
                  {selected === opt.url && (
                    <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                      <Check className="w-6 h-6 text-primary drop-shadow" />
                    </div>
                  )}
                  <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1">
                    <p className="text-xs text-white truncate">{opt.label}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border bg-muted/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUpload(file, writeToDisk);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={isPending}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload image
            </Button>
            {showWriteToDisk && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={writeToDisk}
                  onChange={(e) => setWriteToDisk(e.target.checked)}
                  className="w-4 h-4 accent-primary"
                />
                {writeToDiskLabel}
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={<span />} className="cursor-default" onClick={(e) => e.preventDefault()}>
                      <Info className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-60">
                      <span>
                        Writes/overwrites the artist image in the artist music directory. Media servers
                        like Plex, Jellyfin, and Kodi will automatically use this.
                      </span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </label>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => selected && onSelect(selected, writeToDisk)}
              disabled={!selected || isPending}
            >
              {isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : null}
              Use this image
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
