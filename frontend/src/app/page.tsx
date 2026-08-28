"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { apiService } from "@/lib/api";
import {
  Target,
  ListChecks,
  AlertOctagon,
  ShieldAlert,
  ArrowRight,
  AlertTriangle,
  Bot,
  Activity,
  Clock,
  RefreshCw,
  Zap,
  Shield,
  FileText,
  Bot as BotIcon,
  Activity as ActivityIcon,
  PieChart,
  BarChart2,
} from "lucide-react";
import Link from "next/link";
import {
  PageHeader,
  StatCard,
  Card,
  EmptyState,
  Skeleton,
  SeverityPill,
  severityFromScore,
  formatDate,
} from "@/components/ui";

type Metrics = {
  activeTargets: number;
  totalFindings: number;
  highSeverity: number;
  totalExploits: number;
  totalReports: number;
  agentsRunning: number;
  scanQueue: number;
  avgResponseTime: number;
  criticalFindings: number;
  mediumFindings: number;
  lowFindings: number;
  infoFindings: number;
};

type Finding = {
  id: string;
  target: string;
  type: string;
  triage_score: number | null;
  triage_reason: string | null;
  created_at: string;
  programme_name: string | null;
};

const EMPTY_METRICS: Metrics = {
  activeTargets: 0,
  totalFindings: 0,
  highSeverity: 0,
  totalExploits: 0,
  totalReports: 0,
  agentsRunning: 0,
  scanQueue: 0,
  avgResponseTime: 0,
  criticalFindings: 0,
  mediumFindings: 0,
  lowFindings: 0,
  infoFindings: 0,
};

function scorePct(score: number | null | undefined): number {
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  return Math.max(0, Math.min(100, Math.round(s * 100)));
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>(EMPTY_METRICS);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Hydration-safe clock: null during SSR + first client render, real time after mount
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setError(null);
        const [metricsRes, findingsRes] = await Promise.all([
          apiService.metrics.get(),
          apiService.findings.getAll(),
        ]);
        if (!active) return;
        if (metricsRes.data) {
          setMetrics({ ...EMPTY_METRICS, ...metricsRes.data });
        }
        if (Array.isArray(findingsRes.data?.findings)) {
          setFindings(findingsRes.data.findings);
        }
      } catch (err) {
        console.error("Failed to load dashboard data", err);
        setError("Failed to load dashboard data. Please check your connection.");
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    loadData();
    const interval = setInterval(loadData, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const [metricsRes, findingsRes] = await Promise.all([
        apiService.metrics.get(),
        apiService.findings.getAll(),
      ]);
      if (metricsRes.data) {
        setMetrics({ ...EMPTY_METRICS, ...metricsRes.data });
      }
      if (Array.isArray(findingsRes.data?.findings)) {
        setFindings(findingsRes.data.findings);
      }
    } catch (err) {
      console.error("Failed to refresh dashboard data", err);
      setError("Failed to refresh data. Please try again.");
    } finally {
      setRefreshing(false);
    }
  };

  // Calculate severity distribution
  const severityDistribution = findings.reduce(
    (acc, finding) => {
      if (finding.triage_score === null) return acc;
      const score = finding.triage_score;
      if (score >= 0.9) acc.critical++;
      else if (score >= 0.7) acc.high++;
      else if (score >= 0.4) acc.medium++;
      else if (score >= 0.15) acc.low++;
      else acc.info++;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
  );

  const recent = findings.slice(0, 8); // Show more findings for better overview

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, stiffness: 260, damping: 20 }}
      className="space-y-8"
    >
      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertTriangle className="mr-2 h-4 w-4" aria-hidden="true" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-4 text-[0.875rem] hover:text-danger/80"
          >
            ×
          </button>
        </div>
      )}

      <PageHeader
        title="Dashboard"
        description="Autonomous bug hunting — live reconnaissance and triage overview."
        actions={
          <>
            <Link href="/scans" className="btn btn-outline btn-sm">
              Start New Scan
              <ArrowRight className="ml-2 h-3 w-3" />
            </Link>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={`btn btn-ghost btn-sm ${refreshing ? "animate-spin" : ""}`}
            >
              {refreshing ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1 text-xs">{refreshing ? "Updating..." : "Refresh"}</span>
            </button>
          </>
        }
      />

      {/* Enhanced metrics grid with better hierarchy and visualizations */}
      <section
        aria-label="Key metrics"
        className="grid gap-5 [&>*:nth-child(1)]:col-span-2 [&>*:nth-child(2)]:col-span-2 [&>*:nth-child(3)]:col-span-1 [&>*:nth-child(4)]:col-span-1 [&>*:nth-child(5)]:col-span-1 [&>*:nth-child(6)]:col-span-1 lg:grid-cols-6"
      >
        {/* Active Targets */}
        <StatCard
          label="Active Targets"
          value={metrics.activeTargets}
          icon={Target}
          tone="accent"
          loading={loading}
          trend={metrics.activeTargets > 0 ? "up" : "neutral"}
          trendLabel={`${metrics.activeTargets} in scope`}
          description="Monitored assets in your programs"
        />

        {/* Total Findings */}
        <StatCard
          label="Total Findings"
          value={metrics.totalFindings}
          icon={ListChecks}
          tone="accent"
          loading={loading}
          trend={metrics.totalFindings > 0 ? "up" : "neutral"}
          trendLabel="All discoveries"
          description="Vulnerability findings identified"
        />

        {/* Critical Risk */}
        <StatCard
          label="Critical Risk"
          value={metrics.highSeverity + metrics.criticalFindings}
          icon={AlertOctagon}
          tone="danger"
          loading={loading}
          trend={
            (metrics.highSeverity + metrics.criticalFindings) > 0 ? "up" : "neutral"
          }
          trendLabel="Needs immediate attention"
          description="CVSS 7.0+ findings requiring action"
        />

        {/* Exploit Validation */}
        <StatCard
          label="Exploit Validation"
          value={metrics.totalExploits}
          icon={ShieldAlert}
          tone="warning"
          loading={loading}
          trend={metrics.totalExploits > 0 ? "up" : "neutral"}
          trendLabel="Verification tests"
          description="Active exploitation attempts"
        />

        {/* Reports Generated */}
        <StatCard
          label="Reports Generated"
          value={metrics.totalReports}
          icon={FileText}
          tone="success"
          loading={loading}
          trend={metrics.totalReports > 0 ? "up" : "neutral"}
          trendLabel="Submission-ready"
          description="Professional bug reports"
        />

        {/* Agent Swarm */}
        <StatCard
          label="Agent Swarm"
          value={metrics.agentsRunning}
          icon={Activity}
          tone="accent"
          loading={loading}
          trend={metrics.agentsRunning > 0 ? "up" : "neutral"}
          trendLabel="Active hunters"
          description="Running AI agents"
        />
      </section>

      {/* Severity Distribution Chart */}
      <section aria-label="Severity distribution">
        <Card className="border">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              Severity Distribution
            </h2>
            <Link
              href="/findings"
              className="text-sm font-medium text-accent hover:text-accent-hover flex items-center gap-1.5"
            >
              View all findings
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {loading ? (
            <div className="grid px-5 py-6 gap-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-3 w-3 rounded-full bg-surface-2" />
                  <div className="h-3 w-3 rounded-full bg-surface-2" />
                  <div className="h-3 w-3 rounded-full bg-surface-2" />
                  <div className="h-3 w-3 rounded-full bg-surface-2" />
                  <div className="h-3 w-3 rounded-full bg-surface-2" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid px-5 py-6 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-critical/20 bg-critical" />
                <span className="text-sm text-muted-foreground flex-1">
                  Critical ({severityDistribution.critical})
                </span>
                <div className="h-2 w-20 bg-critical/20 rounded-full">
                  <div
                    className="h-full w-[${severityDistribution.critical > 0 ? Math.min(100, (severityDistribution.critical / Math.max(1, metrics.totalFindings)) * 100) : 0}%] bg-critical rounded-full"
                  ></div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-high/20 bg-high" />
                <span className="text-sm text-muted-foreground flex-1">
                  High ({severityDistribution.high})
                </span>
                <div className="h-2 w-20 bg-high/20 rounded-full">
                  <div
                    className="h-full w-[${severityDistribution.high > 0 ? Math.min(100, (severityDistribution.high / Math.max(1, metrics.totalFindings)) * 100) : 0}%] bg-high rounded-full"
                  ></div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-medium/20 bg-medium" />
                <span className="text-sm text-muted-foreground flex-1">
                  Medium ({severityDistribution.medium})
                </span>
                <div className="h-2 w-20 bg-medium/20 rounded-full">
                  <div
                    className="h-full w-[${severityDistribution.medium > 0 ? Math.min(100, (severityDistribution.medium / Math.max(1, metrics.totalFindings)) * 100) : 0}%] bg-medium rounded-full"
                  ></div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-low/20 bg-low" />
                <span className="text-sm text-muted-foreground flex-1">
                  Low ({severityDistribution.low})
                </span>
                <div className="h-2 w-20 bg-low/20 rounded-full">
                  <div
                    className="h-full w-[${severityDistribution.low > 0 ? Math.min(100, (severityDistribution.low / Math.max(1, metrics.totalFindings)) * 100) : 0}%] bg-low rounded-full"
                  ></div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-info/20 bg-info" />
                <span className="text-sm text-muted-foreground flex-1">
                  Info ({severityDistribution.info})
                </span>
                <div className="h-2 w-20 bg-info/20 rounded-full">
                  <div
                    className="h-full w-[${severityDistribution.info > 0 ? Math.min(100, (severityDistribution.info / Math.max(1, metrics.totalFindings)) * 100) : 0}%] bg-info rounded-full"
                  ></div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* Recent findings */}
      <section aria-label="Recent findings">
        <Card className="border">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Findings
            </h2>
            <Link
              href="/findings"
              className="text-sm font-medium text-accent hover:text-accent-hover flex items-center gap-1.5"
            >
              View all ({findings.length})
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3 p-5">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="hidden h-4 w-24 sm:block" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </div>
          ) : recent.length === 0 ? (
            <div className="p-6 text-center">
              <div className="flex items-center justify-center mb-4">
                <Bot className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No findings yet — launch a scan to begin autonomous hunting
              </p>
              <Link href="/scans" className="btn btn-outline btn-sm mt-3">
                Start First Scan
                <ArrowRight className="ml-2 h-3 w-3" />
              </Link>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-subtle">
                      <th className="px-5 py-3 font-medium">Threat Level</th>
                      <th className="px-5 py-3 font-medium">Finding Type</th>
                      <th className="px-5 py-3 font-medium">Target</th>
                      <th className="px-5 py-3 font-medium">Program</th>
                      <th className="px-5 py-3 font-medium">Confidence</th>
                      <th className="px-5 py-3 font-medium">Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recent.map((f) => (
                      <tr key={f.id} className="hover:bg-surface-2/50 transition-colors cursor-pointer">
                        <td className="px-5 py-3">
                          <SeverityPill
                            severity={severityFromScore(f.triage_score)}
                            className="flex items-center gap-2"
                          >
                            {f.triage_score !== null ? (
                              <>
                                <span className="font-medium tabular-nums">{scorePct(f.triage_score)}%</span>
                                <div
                                  className="h-1.5 w-10 overflow-hidden rounded-full bg-surface-2"
                                  role="presentation"
                                >
                                  <div
                                    className="h-full rounded-full bg-accent"
                                    style={{ width: `${scorePct(f.triage_score)}%` }}
                                  />
                                </div>
                              </>
                            ) : (
                              <span className="text-subtle">Awaiting analysis</span>
                            )}
                          </SeverityPill>
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium text-foreground">{f.type}</div>
                          {f.triage_reason && (
                            <p className="text-xs text-subtle mt-1">{f.triage_reason}</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-mono text-xs text-accent truncate max-w-xs">
                            {f.target}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {f.programme_name || "—"}
                        </td>
                        <td className="px-5 py-3">
                          {f.triage_score !== null ? (
                            <div className="flex items-center gap-2">
                              <span className="tabular-nums font-medium text-foreground">
                                {scorePct(f.triage_score)}%
                              </span>
                              <div className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-2">
                                <div
                                  className="h-full rounded-full bg-accent"
                                  style={{ width: `${scorePct(f.triage_score)}%` }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {formatDate(f.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked cards */}
              <ul className="divide-y divide-border md:hidden">
                {recent.map((f) => (
                  <li key={f.id} className="flex flex-col gap-2 px-5 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <SeverityPill
                        severity={severityFromScore(f.triage_score)}
                        className="flex items-center gap-2"
                      >
                        {f.triage_score !== null ? (
                          <>
                            <span className="tabular-nums text-xs text-muted-foreground">
                              {scorePct(f.triage_score)}%
                            </span>
                            <div className="h-1 w-6 overflow-hidden rounded-full bg-surface-2">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{ width: `${scorePct(f.triage_score)}%` }}
                              />
                            </div>
                          </>
                        ) : (
                          <span className="text-subtle text-xs">Awaiting</span>
                        )}
                      </SeverityPill>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{f.type}</p>
                        {f.triage_reason && (
                          <p className="text-xs text-subtle mt-1">{f.triage_reason}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="font-mono truncate max-w-xs">{f.target}</span>
                        {f.triage_score !== null && (
                          <span className="ml-1">({scorePct(f.triage_score)}%)</span>
                        )}
                      </div>
                      <span className="flex items-center gap-2">
                        <span>{f.programme_name || "—"}</span>
                        <span className="ml-2 text-xs">{formatDate(f.created_at)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </section>

      {/* System status section */}
      <section className="space-y-6">
        <Card className="border">
          <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              System Status
            </h2>
            <div className="flex items-center gap-3 text-sm">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/10">
                <Bot className="h-4 w-4 text-accent" />
                <span className="text-xs">{metrics.agentsRunning} Agents Active</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-border/10">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs" suppressHydrationWarning>Last Update: {now ? now.toLocaleTimeString() : "—"}</span>
              </div>
            </div>
          </div>
          <div className="grid px-5 py-4 gap-4 [&>*:nth-child(1)]:col-span-2 [&>*:nth-child(2)]:col-span-2 lg:grid-cols-2">
            <div className="flex items-start gap-3 p-3 bg-surface/50 rounded-lg border border-border">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/20 text-accent">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Threat Detection</h3>
                <p className="text-xs text-muted-foreground">
                  {metrics.totalFindings > 0 ?
                    `${metrics.highSeverity + metrics.criticalFindings} critical findings require attention` :
                    "No threats detected in current scope"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-surface/50 rounded-lg border border-border">
              <div className="flex h-9 w-9 items-center justify-center bg-accent/20 text-accent">
                <FileText className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Reporting</h3>
                <p className="text-xs text-muted-foreground">
                  {metrics.totalReports} reports generated, {metrics.totalExploits} validation attempts
                </p>
              </div>
            </div>
          </div>
        </Card>
      </section>
    </motion.div>
  );
}