import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test the request() function indirectly via exported API functions.
// fetch is mocked globally.

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mockFetch(status: number, body: unknown) {
  const text = JSON.stringify(body);
  (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(text),
  });
}

describe("listArtists", () => {
  it("calls /api/artists and returns parsed JSON", async () => {
    const { listArtists } = await import("@/api/client");
    const artists = [{ id: 1, name: "Blur", mbid: "abc" }];
    mockFetch(200, artists);

    const result = await listArtists();
    expect(result).toEqual(artists);
    expect(fetch).toHaveBeenCalledWith(
      "/api/artists",
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it("throws on non-ok response", async () => {
    const { listArtists } = await import("@/api/client");
    mockFetch(500, { detail: "Internal error" });

    await expect(listArtists()).rejects.toThrow("500");
  });
});

describe("listAlbums", () => {
  it("calls /api/albums", async () => {
    const { listAlbums } = await import("@/api/client");
    mockFetch(200, []);

    await listAlbums();
    expect(fetch).toHaveBeenCalledWith(
      "/api/albums?",
      expect.anything()
    );
  });
});

describe("getDownloadSettings", () => {
  it("returns settings object", async () => {
    const { getDownloadSettings } = await import("@/api/client");
    const settings = { id: 1, audio_format: "opus", yt_format: "bestaudio" };
    mockFetch(200, settings);

    const result = await getDownloadSettings();
    expect(result).toMatchObject({ audio_format: "opus" });
  });
});

describe("updateDownloadSettings", () => {
  it("sends PATCH with body", async () => {
    const { updateDownloadSettings } = await import("@/api/client");
    const updated = { id: 1, audio_format: "flac" };
    mockFetch(200, updated);

    await updateDownloadSettings({ audio_format: "flac" });
    expect(fetch).toHaveBeenCalledWith(
      "/api/downloads/settings",
      expect.objectContaining({ method: "PATCH" })
    );
  });
});

describe("unsubscribeArtist", () => {
  it("sends DELETE with delete_files=false by default", async () => {
    const { unsubscribeArtist } = await import("@/api/client");
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      json: () => Promise.resolve(undefined),
      text: () => Promise.resolve(""),
    });

    await unsubscribeArtist(42);
    expect(fetch).toHaveBeenCalledWith(
      "/api/artists/42?delete_files=false",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
