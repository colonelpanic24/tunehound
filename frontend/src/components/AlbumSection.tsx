import type { ReactNode } from "react";
import type { ReleaseGroup } from "@/types";
import AlbumCard from "@/components/AlbumCard";

interface AlbumItem {
  album: ReleaseGroup;
  onDisk?: boolean;
  fileCount?: number;
  onDownloadQueued?: () => void;
}

interface Props {
  /** Section heading — omit to render without a header */
  title?: ReactNode;
  items: AlbumItem[];
  artistName: string;
}

/**
 * A titled grid section of AlbumCards. Used by ArtistDetailPage, AlbumsPage,
 * and DashboardPage wherever album grids appear.
 */
export default function AlbumSection({ title, items, artistName }: Props) {
  if (items.length === 0) return null;
  return (
    <section>
      {title && (
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {title}
        </h2>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {items.map(({ album, onDisk, fileCount, onDownloadQueued }) => (
          <AlbumCard
            key={album.id}
            album={album}
            artistName={artistName}
            onDisk={onDisk}
            fileCount={fileCount}
            onDownloadQueued={onDownloadQueued}
          />
        ))}
      </div>
    </section>
  );
}
