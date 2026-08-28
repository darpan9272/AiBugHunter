"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { MotionConfig } from "framer-motion";
import {
  LayoutDashboard,
  Folder,
  AlertTriangle,
  ShieldAlert,
  FileText,
  Settings,
  Bug,
  Cpu,
  Activity,
  Menu,
  X,
  Plug,
  SlidersHorizontal,
  TerminalSquare,
  BookOpen,
  Search,
  Shield,
  Network,
  Clock,
  Zap,
  Cloud,
  Target,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/explore", label: "Explore", icon: Search },
  { href: "/asm", label: "Attack Surface", icon: Shield },
  { href: "/asm/graph", label: "Pivot Graph", icon: Network },
  { href: "/asm/timeline", label: "Timeline", icon: Clock },
  { href: "/asm/scoring", label: "Risk Scoring", icon: Target },
  { href: "/asm/cloud", label: "Cloud Assets", icon: Cloud },
  { href: "/asm/watch", label: "Watch Rules", icon: Zap },
  { href: "/asm/enrichment", label: "Enrichment", icon: Activity },
  { href: "/sessions", label: "Engagements", icon: TerminalSquare },
  { href: "/connect", label: "Connect AI", icon: Plug },
  { href: "/harness", label: "Harness", icon: SlidersHorizontal },
  { href: "/skills", label: "Skills", icon: BookOpen },
  { href: "/agents", label: "Agent Hub", icon: Cpu },
  { href: "/programs", label: "Programs", icon: Folder },
  { href: "/scans", label: "Scans", icon: Activity },
  { href: "/findings", label: "Findings", icon: AlertTriangle },
  { href: "/exploits", label: "Exploits", icon: ShieldAlert },
  { href: "/reports", label: "Reports", icon: FileText },
];

const SETTINGS_ITEM: NavItem = { href: "/settings", label: "Settings", icon: Settings };

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-accent/12 text-accent"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-1 py-1 text-foreground"
    >
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-fg">
        <Bug className="h-5 w-5" />
      </span>
      <span className="text-base font-bold tracking-tight">
        AI BUG HUNT
        <span className="text-xs font-normal block">by Derpan Raiyani</span>
      </span>
    </Link>
  );
}

function SidebarInner({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center border-b border-border px-4">
        <Brand onNavigate={onNavigate} />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActive(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="border-t border-border p-3">
        <NavLink
          item={SETTINGS_ITEM}
          active={isActive(pathname, SETTINGS_ITEM.href)}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape + lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-border bg-surface/60 md:flex md:flex-col">
          <SidebarInner pathname={pathname} />
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur pt-safe md:hidden">
            <button
              type="button"
              className="icon-btn"
              aria-label="Open navigation menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
            <Brand />
          </header>

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <div className="mx-auto w-full max-w-6xl">{children}</div>
          </main>
        </div>

        {/* Mobile slide-over drawer */}
        {open && (
          <div className="fixed inset-0 z-50 md:hidden">
            <button
              type="button"
              aria-label="Close navigation menu"
              className="absolute inset-0 h-full w-full bg-black/60"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-surface shadow-xl pb-safe"
            >
              <div className="absolute right-3 top-3">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Close navigation menu"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarInner pathname={pathname} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        )}
      </div>
    </MotionConfig>
  );
}
