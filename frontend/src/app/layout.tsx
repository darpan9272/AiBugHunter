"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Inter } from "next/font/google";
import "./globals.css";
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
} from "lucide-react";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agents", label: "Agent Hub", icon: Cpu },
  { href: "/programs", label: "Programs", icon: Folder },
  { href: "/scans", label: "Scans", icon: Activity },
  { href: "/findings", label: "Findings", icon: AlertTriangle },
  { href: "/exploits", label: "Exploits", icon: ShieldAlert },
  { href: "/reports", label: "Reports", icon: FileText },
];

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();

  return (
    <html lang="en" className="dark">
      <head>
        <title>AI Bug Hunt Dashboard</title>
        <meta name="description" content="Autonomous Bug Hunting System Interface" />
      </head>
      <body className={`${inter.variable} antialiased min-h-screen flex`}>
        {/* Sidebar */}
        <aside className="w-64 glass-panel m-4 flex flex-col overflow-hidden hidden md:flex shrink-0 z-10">
          <Link
            href="/"
            className="p-6 border-b border-[var(--color-panel-border)] flex items-center gap-3"
          >
            <div className="bg-gradient-to-tr from-cyan-400 to-purple-500 p-2 rounded-lg">
              <Bug className="text-white w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gradient">
              AI BUG HUNT
            </h1>
          </Link>

          <nav className="flex-1 p-4 space-y-1">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                    isActive
                      ? "bg-[rgba(34,211,238,0.1)] text-cyan-400 border border-[rgba(34,211,238,0.2)] shadow-[0_0_15px_rgba(34,211,238,0.1)]"
                      : "text-slate-400 hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
                  }`}
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-[var(--color-panel-border)]">
            <Link
              href="/settings"
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                pathname === "/settings"
                  ? "bg-[rgba(34,211,238,0.1)] text-cyan-400 border border-[rgba(34,211,238,0.2)]"
                  : "text-slate-400 hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
              }`}
            >
              <Settings className="w-5 h-5" />
              <span className="font-medium">Settings</span>
            </Link>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 overflow-y-auto">{children}</main>
      </body>
    </html>
  );
}
