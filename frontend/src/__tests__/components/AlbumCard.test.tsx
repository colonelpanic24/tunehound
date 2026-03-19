import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AlbumCard from "@/components/AlbumCard";
import type { ReleaseGroup } from "@/types";

const mockAlbum: ReleaseGroup = {
  id: 1,
  mbid: "rg-test-1",
  artist_id: 10,
  title: "Dummy Album",
  primary_type: "Album",
  secondary_types: null,
  first_release_date: "2003-06-09",
  cover_art_url: null,
  folder_path: null,
  cover_art_hash: null,
  description: null,
  watched: true,
  tracks_fetched: true,
  track_count: 10,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AlbumCard", () => {
  it("renders album title", () => {
    render(<AlbumCard album={mockAlbum} artistName="Test Artist" />, { wrapper });
    expect(screen.getByText("Dummy Album")).toBeInTheDocument();
  });

  it("renders release year", () => {
    render(<AlbumCard album={mockAlbum} artistName="Test Artist" />, { wrapper });
    expect(screen.getByText(/2003/)).toBeInTheDocument();
  });

  it("shows Download button when not on disk", () => {
    render(<AlbumCard album={mockAlbum} artistName="Test Artist" onDisk={false} />, { wrapper });
    expect(screen.getByText("Download")).toBeInTheDocument();
  });

  it("hides Download button when fully on disk", () => {
    render(
      <AlbumCard
        album={mockAlbum}
        artistName="Test Artist"
        onDisk={true}
        fileCount={10}
      />,
      { wrapper }
    );
    expect(screen.queryByText("Download")).not.toBeInTheDocument();
  });

  it("shows Missing button when partially on disk", () => {
    render(
      <AlbumCard
        album={mockAlbum}
        artistName="Test Artist"
        onDisk={true}
        fileCount={5}
      />,
      { wrapper }
    );
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("renders cover art when url is provided", () => {
    const albumWithArt = { ...mockAlbum, cover_art_url: "/images/covers/rg-test-1.jpg" };
    render(<AlbumCard album={albumWithArt} artistName="Test Artist" />, { wrapper });
    const img = screen.getByAltText("Dummy Album") as HTMLImageElement;
    expect(img.src).toContain("/images/covers/rg-test-1.jpg");
  });

  it("applies reduced opacity when unwatched", () => {
    const unwatched = { ...mockAlbum, watched: false };
    const { container } = render(
      <AlbumCard album={unwatched} artistName="Test Artist" />,
      { wrapper }
    );
    expect(container.firstChild).toHaveClass("opacity-50");
  });

  it("has full opacity when watched", () => {
    const { container } = render(
      <AlbumCard album={mockAlbum} artistName="Test Artist" />,
      { wrapper }
    );
    expect(container.firstChild).not.toHaveClass("opacity-50");
  });

  it("shows artist name when showArtist is true", () => {
    render(
      <AlbumCard album={mockAlbum} artistName="Test Artist" showArtist />,
      { wrapper }
    );
    expect(screen.getByText("Test Artist")).toBeInTheDocument();
  });

  it("hides artist name when showArtist is false", () => {
    render(
      <AlbumCard album={mockAlbum} artistName="Test Artist" showArtist={false} />,
      { wrapper }
    );
    expect(screen.queryByText("Test Artist")).not.toBeInTheDocument();
  });

  it("shows 0% availability badge when not on disk", () => {
    render(<AlbumCard album={mockAlbum} artistName="Test Artist" onDisk={false} />, {
      wrapper,
    });
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("shows 100% availability badge when fully on disk", () => {
    render(
      <AlbumCard album={mockAlbum} artistName="Test Artist" onDisk={true} fileCount={10} />,
      { wrapper }
    );
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("shows partial availability badge when partially on disk", () => {
    render(
      <AlbumCard album={mockAlbum} artistName="Test Artist" onDisk={true} fileCount={5} />,
      { wrapper }
    );
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
