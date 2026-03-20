import { NavLink, useNavigate } from "react-router-dom";
import { HardDrive, Music2, Download, Disc3, Loader2, Settings, ChevronsLeft, ChevronsRight } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useImport } from "@/context/ImportContext";
import { getStats, listArtists } from "@/api/client";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const STALE_MS = 60_000;

interface Props {
  children: ReactNode;
}

export default function Layout({ children }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useImport();

  const prefetchLists = () => {
    queryClient.prefetchQuery({ queryKey: ["artists"], queryFn: listArtists, staleTime: STALE_MS });
  };
  const { phase, scanDone, scanTotal, importDone, importTotal } = state;
  const isActive = phase === "scanning";

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar.collapsed") === "true"
  );

  const toggle = () => {
    setCollapsed((c) => {
      localStorage.setItem("sidebar.collapsed", String(!c));
      return !c;
    });
  };

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <nav
        className={cn(
          "flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden transition-[width] duration-200 ease-in-out",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {/* Header: collapse toggle + logo */}
        <div className={cn("flex items-center py-5 px-3", collapsed ? "justify-center" : "gap-2")}>
          <button
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors p-1.5 shrink-0"
          >
            {collapsed
              ? <ChevronsRight className="w-5 h-5" />
              : <ChevronsLeft  className="w-5 h-5" />
            }
          </button>
          {!collapsed && (
            <>
              <Music2 className="w-7 h-7 text-primary shrink-0" />
              <span className="text-2xl font-bold tracking-tight text-foreground whitespace-nowrap overflow-hidden">
                TuneHound
              </span>
            </>
          )}
        </div>

        {/* Nav items — scrolls if viewport is too short */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 px-2">
          <NavItem
            to="/artists"
            icon={<Music2 className="w-5 h-5" />}
            count={stats?.artists}
            collapsed={collapsed}
            onMouseEnter={prefetchLists}
          >
            Artists
          </NavItem>
          <NavItem
            to="/albums"
            icon={<Disc3 className="w-5 h-5" />}
            count={stats?.albums}
            collapsed={collapsed}
            onMouseEnter={prefetchLists}
          >
            Albums
          </NavItem>
          <NavItem to="/library" icon={<HardDrive className="w-5 h-5" />} collapsed={collapsed}>
            Library
          </NavItem>
          <NavItem
            to="/downloads"
            icon={<Download className="w-5 h-5" />}
            count={
              stats?.active_downloads
                ? `${stats.download_tracks_completed}/${stats.download_tracks_total}`
                : undefined
            }
            collapsed={collapsed}
          >
            Downloads
          </NavItem>
        </div>

        {/* Bottom: scan progress + Settings */}
        <div className="px-2 pb-2 flex flex-col gap-0.5">
          {isActive && (
            <div
              onClick={() => navigate("/library")}
              className={cn(
                "mx-0 mb-1 px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors cursor-pointer",
                collapsed && "flex justify-center px-0"
              )}
            >
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger className="cursor-help">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {scanDone < scanTotal && `Scanning ${scanDone} / ${scanTotal} folders`}
                    {importTotal > 0 && ` · Importing ${importDone} / ${importTotal}`}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <>
                  {scanDone < scanTotal && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help shrink-0">
                          <Loader2 className="w-3 h-3 animate-spin text-primary" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-56">
                          Searching each music folder by name on MusicBrainz to find the matching artist.
                          MusicBrainz enforces a 1 request/second rate limit, so this takes roughly 1 second per folder.
                        </TooltipContent>
                      </Tooltip>
                      <span>Scanning {scanDone} / {scanTotal} folders</span>
                    </div>
                  )}
                  {importTotal > 0 && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Tooltip>
                        <TooltipTrigger className="w-3 h-3 flex items-center justify-center shrink-0 cursor-help">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                        </TooltipTrigger>
                        <TooltipContent side="right" className="max-w-56">
                          Fetching each artist's full profile from MusicBrainz: biography, discography, album artwork,
                          and track listings. Each artist requires several API calls and takes 30–90 seconds to complete.
                        </TooltipContent>
                      </Tooltip>
                      <span>Importing {importDone} / {importTotal} artists</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          <NavItem to="/settings" icon={<Settings className="w-5 h-5" />} collapsed={collapsed}>
            Settings
          </NavItem>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

function NavItem({
  to,
  icon,
  children,
  end,
  count,
  collapsed,
  onMouseEnter,
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  end?: boolean;
  count?: number | string;
  collapsed?: boolean;
  onMouseEnter?: () => void;
}) {
  const link = (
    <NavLink
      to={to}
      end={end}
      onMouseEnter={onMouseEnter}
      className={({ isActive }) =>
        cn(
          "flex items-center rounded-md font-medium transition-colors",
          collapsed ? "justify-center px-3 py-2.5" : "gap-3 px-3 py-2.5",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )
      }
    >
      {({ isActive }) => (
        <>
          {icon}
          {!collapsed && (
            <>
              <span className="flex-1 text-base">{children}</span>
              {count !== undefined && (
                <span
                  className={cn(
                    "text-sm tabular-nums",
                    isActive ? "text-primary-foreground/70" : "text-muted-foreground"
                  )}
                >
                  {typeof count === "number" ? count.toLocaleString() : count}
                </span>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger className="block">
          {link}
        </TooltipTrigger>
        <TooltipContent side="right">{children}</TooltipContent>
      </Tooltip>
    );
  }

  return link;
}
