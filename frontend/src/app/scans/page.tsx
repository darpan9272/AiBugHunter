"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Loader2, Bot } from "lucide-react";
import Link from "next/link";
import {
  PageHeader,
  Card,
  EmptyState,
  Skeleton,
  StatusPill,
  formatDate,
} from "@/components/ui";
import { apiService } from "@/lib/api";

interface ScanJob {
  id: string;
  programme_name: string;
  status: string;
  agents_assigned: string[];
  started_at: string;
  finished_at: string | null;
}

interface ActivityEvent {
  id: string;
  action: string;
  detail: string;
  created_at: string;
  nickname: string;
  model: string;
  provider: string;
}

/** Time-only label for the within-scan live feed. */
function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ScansPage() {
  const [scans, setScans] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    loadScans();
    // Refresh the scan list every 10s so running scans surface promptly.
    const interval = setInterval(loadScans, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadScans() {
    try {
      setLoading(true);
      const res = await apiService.scanJobs.getAll();
      if (res.data) setScans(res.data.scanJobs);
    } catch (err) {
      console.error("Failed to load scans", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedScanId) return;
    let active = true;

    async function loadActivity() {
      try {
        const res = await apiService.scanJobs.getById(selectedScanId as string);
        // Ignore late responses from a previously selected scan.
        if (active && res.data) setActivityFeed(res.data.activity || []);
      } catch (err) {
        console.error("Failed to load scan activity", err);
      }
    }

    // Clear stale feed from the prior selection, then load + poll every 3s.
    setActivityFeed([]);
    loadActivity();
    const interval = setInterval(loadActivity, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [selectedScanId]);

  const selectedScan = scans.find((s) => s.id === selectedScanId) ?? null;
  const isRunning = selectedScan?.status === "running";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scans"
        description="Watch the agent swarm work each scan in real time."
        icon={Activity}
      />

      <div className="grid gap-6 lg:h-[calc(100vh-9rem)] lg:grid-cols-[22rem_minmax(0,1fr)]">
        {/* Left column: scan jobs */}
        <Card className="flex flex-col overflow-hidden p-0 lg:min-h-0">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Scan jobs</h2>
            {!loading && scans.length > 0 && (
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {scans.length}
              </span>
            )}
          </div>

          <div className="max-h-[45vh] flex-1 space-y-2 overflow-y-auto p-3 lg:max-h-none lg:min-h-0">
            {loading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-[4.5rem] w-full rounded-lg" />
                ))}
              </div>
            ) : scans.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No scans yet"
                description="Launch a scan from one of your programmes to begin."
                action={
                  <Link href="/programs" className="btn btn-secondary">
                    Go to Programs
                  </Link>
                }
              />
            ) : (
              scans.map((scan) => {
                const selected = selectedScanId === scan.id;
                return (
                  <button
                    key={scan.id}
                    type="button"
                    onClick={() => setSelectedScanId(scan.id)}
                    aria-pressed={selected}
                    className={`flex w-full flex-col gap-2 rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      selected
                        ? "border-accent/50 bg-accent/8"
                        : "border-border bg-surface hover:border-accent/30 hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {scan.programme_name}
                      </h3>
                      <StatusPill status={scan.status} className="shrink-0" />
                    </div>
                    <dl className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <dt className="text-subtle">Started</dt>
                        <dd className="tabular-nums">{formatDate(scan.started_at)}</dd>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Bot className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
                        <dd>
                          {scan.agents_assigned.length}{" "}
                          {scan.agents_assigned.length === 1 ? "agent" : "agents"} assigned
                        </dd>
                      </div>
                    </dl>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right column: live activity feed */}
        <Card className="flex min-h-[24rem] flex-col overflow-hidden p-0 lg:min-h-0">
          {selectedScan ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-foreground">
                    Live activity
                  </h2>
                  <p className="truncate text-xs text-subtle">
                    {selectedScan.programme_name}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="relative flex h-2 w-2" aria-hidden="true">
                    {isRunning && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        isRunning ? "bg-accent" : "bg-subtle"
                      }`}
                    />
                  </span>
                  <span className="font-mono text-xs text-subtle">
                    {isRunning ? "SYNCING" : "IDLE"}
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 lg:min-h-0">
                {activityFeed.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                    <Loader2 className="mb-3 h-7 w-7 animate-spin text-subtle" aria-hidden="true" />
                    <p className="text-sm">Waiting for agents to report in…</p>
                  </div>
                ) : (
                  <ul className="space-y-4">
                    <AnimatePresence initial={false}>
                      {activityFeed.map((event, i) => (
                        <motion.li
                          key={event.id}
                          initial={{ opacity: 0, x: 16 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: Math.min(i, 8) * 0.04 }}
                          className="flex gap-3"
                        >
                          <div className="flex flex-col items-center pt-1.5">
                            <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                            {i !== activityFeed.length - 1 && (
                              <span className="my-1 w-px flex-1 bg-border" aria-hidden="true" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="min-w-0 truncate text-sm font-medium text-foreground">
                                {event.nickname || event.model || "System Orchestrator"}
                              </span>
                              <time className="shrink-0 font-mono text-xs text-subtle">
                                {formatTime(event.created_at)}
                              </time>
                            </div>

                            <span className="mt-1.5 inline-block rounded bg-surface px-2 py-0.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              {event.action}
                            </span>

                            {event.detail && (
                              <p className="mt-2 whitespace-pre-wrap break-words font-mono text-sm text-muted-foreground">
                                {event.detail}
                              </p>
                            )}
                          </div>
                        </motion.li>
                      ))}
                    </AnimatePresence>
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-subtle">
                <Activity className="h-7 w-7" aria-hidden="true" />
              </span>
              <h2 className="text-lg font-semibold text-foreground">No scan selected</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Choose a scan from the list to stream the live activity feed from the agent
                swarm.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
