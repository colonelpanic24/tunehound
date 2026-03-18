import { NavLink } from "react-router-dom";
import { LayoutDashboard, Music2, Download, Disc3, Loader2, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useImport } from "@/context/ImportContext";
import { getStats } from "@/api/client";
import { cn } from "@/lib/utils";

interface Props {
  children: ReactNode;
}

export default function Layout({ children }: Props) {
  const { state } = useImport();
  const { phase, scanDone, scanTotal, importDone, importTotal } = state;
  const isActive = phase === "scanning" || phase === "importing" || phase === "linking";

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    queryFn: getStats,
  });

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden">
        <div className="px-5 py-6">
          <span className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Music2 className="w-5 h-5 text-primary" />
            TuneHound
          </span>
        </div>
        <div className="flex flex-col gap-1 px-3 flex-1">
          <NavItem to="/" icon={<LayoutDashboard className="w-4 h-4" />} end>
            Dashboard
          </NavItem>
          <NavItem
            to="/artists"
            icon={<Music2 className="w-4 h-4" />}
            count={stats?.artists}
          >
            Artists
          </NavItem>
          <NavItem
            to="/albums"
            icon={<Disc3 className="w-4 h-4" />}
            count={stats?.albums}
          >
            Albums
          </NavItem>
          <NavItem
            to="/downloads"
            icon={<Download className="w-4 h-4" />}
            count={
              stats?.active_downloads
                ? `${stats.download_tracks_completed}/${stats.download_tracks_total}`
                : undefined
            }
          >
            Downloads
          </NavItem>
        </div>

        <div className="px-3 pb-1">
          <NavItem to="/settings" icon={<Settings className="w-4 h-4" />}>
            Settings
          </NavItem>
        </div>


        {isActive && (
          <NavLink
            to="/"
            className="mx-3 mb-4 px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" />
              <span className="truncate">
                {phase === "scanning" && `Scanning ${scanDone}/${scanTotal}`}
                {phase === "importing" && `Importing ${importDone}/${importTotal}`}
                {phase === "linking" && "Linking files…"}
              </span>
            </div>
          </NavLink>
        )}
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
}: {
  to: string;
  icon: ReactNode;
  children: ReactNode;
  end?: boolean;
  count?: number | string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )
      }
    >
      {({ isActive }) => (
        <>
          {icon}
          <span className="flex-1">{children}</span>
          {count !== undefined && (
            <span
              className={cn(
                "text-xs tabular-nums",
                isActive ? "text-primary-foreground/70" : "text-muted-foreground"
              )}
            >
              {typeof count === "number" ? count.toLocaleString() : count}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
