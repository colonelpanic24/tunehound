import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getDownloadSettings, updateDownloadSettings } from "@/api/client";
import type { DownloadSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useTheme } from "@/hooks/useTheme";
import { useImport } from "@/context/ImportContext";
import { Sun, Moon, Trash2 } from "lucide-react";


const YT_FORMAT_PRESETS = [
  { label: "Best audio only (recommended)", value: "bestaudio" },
  { label: "Best WebM audio (Opus source)", value: "bestaudio[ext=webm]" },
  { label: "Best M4A audio (AAC source)", value: "bestaudio[ext=m4a]" },
  { label: "Best audio, fallback to video", value: "bestaudio/best" },
] as const;

const SPONSORBLOCK_CATEGORIES = [
  { value: "music_offtopic", label: "Non-music section", description: "Talking, commentary, or anything that isn't the actual music" },
  { value: "sponsor", label: "Sponsor", description: "Paid promotion segments" },
  { value: "intro", label: "Intro", description: "Animated logo or intro sequence" },
  { value: "outro", label: "Outro", description: "Endcard or outro sequence" },
  { value: "selfpromo", label: "Self-promotion", description: "Non-paid mentions (merch, socials, etc.)" },
  { value: "interaction", label: "Interaction reminder", description: "Like/subscribe/comment calls to action" },
];

export default function SettingsPage() {
  const { theme, toggle } = useTheme();
  const queryClient = useQueryClient();
  const { clearAll } = useImport();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const handleClearConfirm = async () => {
    setClearing(true);
    await clearAll();
    setClearing(false);
    setClearConfirmOpen(false);
  };

  const { data: settings } = useQuery({
    queryKey: ["download-settings"],
    queryFn: getDownloadSettings,
  });

  const [form, setForm] = useState<Partial<DownloadSettings>>({});
  const [saved, setSaved] = useState(false);
  const [customFormat, setCustomFormat] = useState(false);

  const mutation = useMutation({
    mutationFn: (patch: Partial<DownloadSettings>) => updateDownloadSettings(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["download-settings"] });
      setForm({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (!settings) return null;

  const val = <K extends keyof DownloadSettings>(key: K) =>
    (form[key] ?? settings[key]) as DownloadSettings[K];

  const set = <K extends keyof DownloadSettings>(key: K, value: DownloadSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const isDirty = Object.keys(form).length > 0;

  const currentYtFormat = val("yt_format") as string;
  const isPreset = YT_FORMAT_PRESETS.some((p) => p.value === currentYtFormat);
  const showCustom = customFormat || !isPreset;

  const sbCategories = new Set(
    (val("sponsorblock_remove") as string).split(",").map((s) => s.trim()).filter(Boolean)
  );
  const toggleSb = (cat: string) => {
    const next = new Set(sbCategories);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    set("sponsorblock_remove", [...next].join(","));
  };

  const releaseTypeSet = new Set(
    (val("release_types") as string).split(",").map((s) => s.trim()).filter(Boolean)
  );
  const toggleReleaseType = (t: string) => {
    const next = new Set(releaseTypeSet);
    if (next.has(t)) next.delete(t); else next.add(t);
    set("release_types", [...next].join(","));
  };

  const inputClass =
    "mt-1 w-full bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary placeholder:text-muted-foreground";

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold text-foreground">Settings</h1>

      {/* ── Appearance ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Appearance</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Theme</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {theme === "dark" ? "Dark mode" : "Light mode"}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={toggle}>
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {theme === "dark" ? "Switch to light" : "Switch to dark"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Library / Metadata ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Library &amp; Metadata</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Album language filter</span>
              <select
                value={val("album_languages") as string}
                onChange={(e) => set("album_languages", e.target.value)}
                className={inputClass}
              >
                <option value="">All languages</option>
                <option value="eng">English</option>
                <option value="eng,fra">English + French</option>
                <option value="eng,deu">English + German</option>
                <option value="eng,spa">English + Spanish</option>
                <option value="eng,jpn">English + Japanese</option>
                <option value="eng,kor">English + Korean</option>
                <option value="fra">French</option>
                <option value="deu">German</option>
                <option value="spa">Spanish</option>
                <option value="jpn">Japanese</option>
                <option value="kor">Korean</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Min import confidence (0–100)</span>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                value={val("scan_min_confidence") as number}
                onChange={(e) => set("scan_min_confidence", parseInt(e.target.value))}
                className={inputClass}
              />
              <span className="text-xs text-muted-foreground/70 mt-1 block">
                Minimum MusicBrainz match score when bulk-importing folders
              </span>
            </label>
          </div>

          <div>
            <span className="text-xs text-muted-foreground">Release types to index per artist</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {[
                { value: "album", label: "Albums" },
                { value: "ep", label: "EPs" },
                { value: "single", label: "Singles" },
                { value: "broadcast", label: "Broadcasts" },
              ].map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={releaseTypeSet.has(value)}
                    onChange={() => toggleReleaseType(value)}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-foreground">{label}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Takes effect when adding new artists or using "Fix match". Does not retroactively change existing artists.
            </p>
          </div>

        </CardContent>
      </Card>

      {/* ── Downloads ───────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Downloads</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Audio format</span>
              <select
                value={val("audio_format") as string}
                onChange={(e) => set("audio_format", e.target.value)}
                className={inputClass}
              >
                <option value="mp3">MP3 (.mp3)</option>
                <option value="flac">FLAC (.flac)</option>
                <option value="opus">Opus (.opus)</option>
                <option value="vorbis">Ogg Vorbis (.ogg)</option>
                <option value="m4a">AAC (.m4a)</option>
              </select>
            </label>

            <label className="block col-span-2">
              <span className="text-xs text-muted-foreground">yt-dlp format selector</span>
              {!showCustom ? (
                <select
                  value={currentYtFormat}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setCustomFormat(true);
                    } else {
                      set("yt_format", e.target.value);
                    }
                  }}
                  className={inputClass}
                >
                  {YT_FORMAT_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                  <option value="__custom__">Custom…</option>
                </select>
              ) : (
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={currentYtFormat}
                    onChange={(e) => set("yt_format", e.target.value)}
                    className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary font-mono"
                    placeholder="e.g. bestaudio[ext=webm]"
                  />
                  <Button variant="outline" size="sm" onClick={() => setCustomFormat(false)} className="shrink-0">
                    Presets
                  </Button>
                </div>
              )}
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Min delay between tracks (sec)</span>
              <input
                type="number" min={0} step={0.5}
                value={val("delay_min") as number}
                onChange={(e) => set("delay_min", parseFloat(e.target.value))}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Max delay between tracks (sec)</span>
              <input
                type="number" min={0} step={0.5}
                value={val("delay_max") as number}
                onChange={(e) => set("delay_max", parseFloat(e.target.value))}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Max retries per track</span>
              <input
                type="number" min={0} max={20} step={1}
                value={val("max_retries") as number}
                onChange={(e) => set("max_retries", parseInt(e.target.value))}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Concurrent fragment downloads</span>
              <input
                type="number" min={1} max={16} step={1}
                value={val("concurrent_fragment_downloads") as number}
                onChange={(e) => set("concurrent_fragment_downloads", parseInt(e.target.value))}
                className={inputClass}
              />
              <span className="text-xs text-muted-foreground/70 mt-1 block">
                Parallel fragments for DASH/HLS streams. Higher = faster but more aggressive.
              </span>
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Rate limit (KB/s, 0 = unlimited)</span>
              <input
                type="number" min={0} step={100}
                value={val("rate_limit_bps") != null ? Math.round((val("rate_limit_bps") as number) / 1024) : 0}
                onChange={(e) => {
                  const kb = parseInt(e.target.value);
                  set("rate_limit_bps", kb > 0 ? kb * 1024 : null);
                }}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Cookies file path (Netscape format)</span>
              <input
                type="text"
                placeholder="/data/cookies.txt"
                value={(val("cookies_file") as string) ?? ""}
                onChange={(e) => set("cookies_file", e.target.value || null)}
                className={inputClass}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted-foreground">Proxy URL</span>
              <input
                type="text"
                placeholder="socks5://127.0.0.1:1080"
                value={(val("proxy") as string) ?? ""}
                onChange={(e) => set("proxy", e.target.value || null)}
                className={inputClass}
              />
            </label>

            <label className="block col-span-2 flex items-center gap-3 cursor-pointer mt-1">
              <input
                type="checkbox"
                checked={val("geo_bypass") as boolean}
                onChange={(e) => set("geo_bypass", e.target.checked)}
                className="w-4 h-4 accent-primary shrink-0"
              />
              <div>
                <p className="text-sm font-medium text-foreground">Geo-bypass</p>
                <p className="text-xs text-muted-foreground">
                  Use yt-dlp's built-in geo-restriction bypass (fakes X-Forwarded-For headers). Try this before using a proxy.
                </p>
              </div>
            </label>
          </div>

        </CardContent>
      </Card>

      {/* ── SponsorBlock ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">SponsorBlock</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Automatically remove segments from downloaded tracks using the SponsorBlock database.
            For music downloads, <strong className="text-foreground">Non-music section</strong> is the most useful — it strips talking intros, outros, and commentary from official uploads.
          </p>
          <div className="space-y-2">
            {SPONSORBLOCK_CATEGORIES.map(({ value, label, description }) => (
              <label key={value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sbCategories.has(value)}
                  onChange={() => toggleSb(value)}
                  className="w-4 h-4 accent-primary mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-foreground leading-tight">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Search</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">YouTube results to try</span>
              <input
                type="number" min={1} max={10} step={1}
                value={val("yt_search_results") as number}
                onChange={(e) => set("yt_search_results", parseInt(e.target.value))}
                className={inputClass}
              />
              <span className="text-xs text-muted-foreground/70 mt-1 block">
                How many search results yt-dlp fetches. 1 = fastest; more results may help obscure tracks.
              </span>
            </label>

            <label className="block col-span-2">
              <span className="text-xs text-muted-foreground">Search query template</span>
              <input
                type="text"
                value={val("search_query_template") as string}
                onChange={(e) => set("search_query_template", e.target.value)}
                className={`${inputClass} font-mono`}
                placeholder="{artist} {title} {album}"
              />
              <span className="text-xs text-muted-foreground/70 mt-1 block">
                Variables: <code className="font-mono">{"{artist}"}</code>, <code className="font-mono">{"{title}"}</code>, <code className="font-mono">{"{album}"}</code>.
                {" "}Try appending <code className="font-mono">official audio</code> or <code className="font-mono">- Topic</code> for better matches on mainstream artists.
              </span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* ── Danger zone ─────────────────────────────────────────────────────── */}
      <Card className="border-destructive/40">
        <CardHeader><CardTitle className="text-sm text-destructive">Danger Zone</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Clear library</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Remove all artists, albums, and tracks from TuneHound. Your music files are not affected.
              </p>
            </div>
            <Button variant="destructive" size="sm" onClick={() => setClearConfirmOpen(true)}>
              <Trash2 className="w-3.5 h-3.5" />
              Clear library
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={clearConfirmOpen} onOpenChange={(o) => { if (!o) setClearConfirmOpen(false); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Clear all artists from the library?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>
              This will remove all artists, albums, and track records from TuneHound's database.
            </p>
            <div className="rounded-md border border-border bg-muted/50 px-3 py-2.5">
              <p className="text-foreground font-medium">Your music files will not be touched.</p>
              <p className="mt-0.5">
                No files will be deleted from disk. You can re-import your library at any time by scanning again.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleClearConfirm} disabled={clearing}>
              {clearing ? (
                <span className="flex items-center gap-1.5">Clearing…</span>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Clear library
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Floating save button ─────────────────────────────────────────────── */}
      {isDirty && (
        <div className="fixed bottom-6 right-6 flex items-center gap-3 bg-card border border-border rounded-lg shadow-lg px-4 py-2.5">
          {saved && <span className="text-xs text-success">Saved</span>}
          <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}
