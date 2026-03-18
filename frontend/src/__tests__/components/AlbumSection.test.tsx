import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import AlbumSection from "@/components/AlbumSection";
import type { ReleaseGroup } from "@/types";

const makeAlbum = (id: number, title: string): ReleaseGroup => ({
  id,
  mbid: `rg-${id}`,
  artist_id: 1,
  title,
  primary_type: "Album",
  secondary_types: null,
  first_release_date: "2000",
  cover_art_url: null,
  folder_path: null,
  cover_art_hash: null,
  description: null,
  watched: true,
  tracks_fetched: true,
  track_count: 0,
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AlbumSection", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(
      <AlbumSection items={[]} artistName="Nobody" />,
      { wrapper }
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders all album cards", () => {
    const items = [
      { album: makeAlbum(1, "First Record") },
      { album: makeAlbum(2, "Second Record") },
    ];
    render(<AlbumSection items={items} artistName="Band" />, { wrapper });
    expect(screen.getByText("First Record")).toBeInTheDocument();
    expect(screen.getByText("Second Record")).toBeInTheDocument();
  });

  it("renders section title when provided", () => {
    const items = [{ album: makeAlbum(1, "An Album") }];
    render(
      <AlbumSection title="Albums" items={items} artistName="Band" />,
      { wrapper }
    );
    expect(screen.getByText("Albums")).toBeInTheDocument();
  });

  it("does not render a heading when title is omitted", () => {
    const items = [{ album: makeAlbum(1, "Untitled") }];
    const { container } = render(
      <AlbumSection items={items} artistName="Band" />,
      { wrapper }
    );
    expect(container.querySelector("h2")).toBeNull();
  });
});
