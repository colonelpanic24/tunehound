import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, UserX } from "lucide-react";
import { listArtists, unsubscribeArtist } from "@/api/client";
import AddArtistModal from "@/components/AddArtistModal";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import type { Artist } from "@/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function ArtistsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [folderNotice, setFolderNotice] = useState<string | null>(null);
  const { data: artists = [], isLoading } = useQuery({
    queryKey: ["artists"],
    queryFn: listArtists,
  });

  useEffect(() => {
    if (!folderNotice) return;
    const id = setTimeout(() => setFolderNotice(null), 6000);
    return () => clearTimeout(id);
  }, [folderNotice]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Artists</h1>
        <Button onClick={() => setShowAdd(true)}>
          <Plus className="w-4 h-4" />
          Add Artist
        </Button>
      </div>

      {folderNotice && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-muted border border-border text-sm text-foreground flex items-center justify-between gap-4">
          <span>
            Artist folder <span className="font-medium">"{folderNotice}"</span> already exists in your library and has been linked.
          </span>
          <button
            onClick={() => setFolderNotice(null)}
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
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
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

function ArtistCard({ artist }: { artist: Artist }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: () => unsubscribeArtist(artist.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["artists"] }),
  });

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
      </div>

      {/* Remove button */}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
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
