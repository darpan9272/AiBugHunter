"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Shield,
  AlertTriangle,
  Cloud,
  Search,
  BarChart3,
  Clock,
  Globe,
  Network,
  Zap,
  TrendingUp,
  Target,
  RefreshCw,
  Settings,
  Plus,
} from "lucide-react";
import { Card, PageHeader, Button } from "@/components/ui";

interface RiskStats {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
  total: number;
}

interface ExposureTrend {
  date: string;
  new_assets: number;
  new_exposures: number;
}

interface TopTech {
  tech: string;
  count: number;
  avg_risk: number;
}

interface ExpiringCert {
  subject_cn: string;
  issuer_org: string;
  not_after: string;
  days_left: number;
}

interface ShadowITCandidate {
  host: string;
  ip: string;
  reason: string;
  risk_score: number;
}

interface CloudSummary {
  provider: string;
  total: number;
  public_exposed: number;
  by_type: Record<string, number>;
}

interface WatchHit {
  rule_name: string;
  new_matches: number;
  asset_type: string;
  last_match_at: string;
}

interface EnrichmentJob {
  id: string;
  source: string;
  target: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  changes_count: number;
  new_assets: number;
}

export default function ASMDashboard() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [riskStats, setRiskStats] = useState<RiskStats | null>(null);
  const [exposureTrend, setExposureTrend] = useState<ExposureTrend[]>([]);
  const [topTech, setTopTech] = useState<TopTech[]>([]);
  const [expiringCerts, setExpiringCerts] = useState<ExpiringCert[]>([]);
  const [shadowIT, setShadowIT] = useState<ShadowITCandidate[]>([]);
  const [cloudSummary, setCloudSummary] = useState<CloudSummary[]>([]);
  const [watchHits, setWatchHits] = useState<WatchHit[]>([]);
  const [enrichmentJobs, setEnrichmentJobs] = useState<EnrichmentJob[]>([]);

  const fetchData = async () => {
    if (!programmeId) return;
    setLoading(true);
    try {
      const [
        riskRes,
        trendRes,
        techRes,
        certRes,
        shadowRes,
        cloudRes,
        watchRes,
        enrichRes,
      ] = await Promise.all([
        fetch(`/api/asm/scores?programmeId=${programmeId}&limit=1000`),
        fetch(`/api/asm/exposure-trend?programmeId=${programmeId}&days=30`),
        fetch(`/api/asm/top-tech?programmeId=${programmeId}&limit=10`),
        fetch(`/api/asm/expiring-certs?programmeId=${programmeId}&days=30&limit=10`),
        fetch(`/api/asm/shadow-it?programmeId=${programmeId}&limit=10`),
        fetch(`/api/asm/cloud?programmeId=${programmeId}&limit=100`),
        fetch(`/api/watch/check`),
        fetch(`/api/asm/enrichment?programmeId=${programmeId}&limit=10`),
      ]);

      const riskData = await riskRes.json();
      if (riskRes.ok) setRiskStats(calculateRiskStats(riskData.assets || []));

      const trendData = await trendRes.json();
      if (trendRes.ok) setExposureTrend(trendData.trend || []);

      const techData = await techRes.json();
      if (techRes.ok) setTopTech(techData.tech || []);

      const certData = await certRes.json();
      if (certRes.ok) setExpiringCerts(certData.certs || []);

      const shadowData = await shadowRes.json();
      if (shadowRes.ok) setShadowIT(shadowData.candidates || []);

      const cloudData = await cloudRes.json();
      if (cloudRes.ok) setCloudSummary(summarizeCloud(cloudData.assets || []));

      const watchData = await watchRes.json();
      if (watchRes.ok) setWatchHits(watchData.results || []);

      const enrichData = await enrichRes.json();
      if (enrichRes.ok) setEnrichmentJobs(enrichData.jobs || []);
    } catch (e) {
      console.error("Failed to fetch ASM dashboard data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetch("/api/programmes")
      .then((r) => r.json())
      .then((d) => setProgrammes(d.programmes || []));
  }, []);

  useEffect(() => {
    if (programmeId) fetchData();
  }, [programmeId]);

  const calculateRiskStats = (assets: any[]): RiskStats => {
    const stats = { critical: 0, high: 0, medium: 0, low: 0, info: 0, total: assets.length };
    for (const a of assets) {
      const tier = a.tier || "info";
      if (tier in stats) (stats as any)[tier]++;
    }
    return stats;
  };

  const summarizeCloud = (assets: any[]): CloudSummary[] => {
    const byProvider: Record<string, CloudSummary> = {};
    for (const a of assets) {
      if (!byProvider[a.provider]) {
        byProvider[a.provider] = { provider: a.provider, total: 0, public_exposed: 0, by_type: {} };
      }
      byProvider[a.provider].total++;
      if (a.public_exposure) byProvider[a.provider].public_exposed++;
      byProvider[a.provider].by_type[a.resource_type] = (byProvider[a.provider].by_type[a.resource_type] || 0) + 1;
    }
    return Object.values(byProvider);
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "critical": return "text-red-400 bg-red-400/10 border-red-400/20";
      case "high": return "text-orange-400 bg-orange-400/10 border-orange-400/20";
      case "medium": return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
      case "low": return "text-blue-400 bg-blue-400/10 border-blue-400/20";
      default: return "text-muted-foreground bg-surface-2";
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "done": return "text-green-400";
      case "running": return "text-blue-400 animate-pulse";
      case "pending": return "text-yellow-400";
      case "failed": return "text-red-400";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attack Surface Management"
        description="Unified view of your external attack surface — assets, risks, cloud, and continuous monitoring."
        icon={Shield}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={programmeId}
              onChange={(e) => setProgrammeId(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
              disabled={loading}
            >
              <option value="">Select programme</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {loading && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        }
      />

      {!programmeId && (
        <Card className="p-8 text-center border-border/50">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold mb-2">Select a programme to view attack surface</h3>
          <p className="text-sm text-muted-foreground">Configure programmes in the Programmes page, then select one above.</p>
        </Card>
      )}

      {programmeId && loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="p-6 animate-pulse">
              <div className="h-4 bg-surface-2 rounded w-3/4 mb-2" />
              <div className="h-8 bg-surface-2 rounded w-1/2" />
            </Card>
          ))}
        </div>
      )}

      {programmeId && !loading && riskStats && (
        <>
          {/* Risk Score Distribution */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <Card className={`p-4 ${getTierColor("critical")} border`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">Critical</p>
                  <p className="text-3xl font-bold">{riskStats.critical}</p>
                </div>
                <AlertTriangle className="h-8 w-8" />
              </div>
            </Card>
            <Card className={`${getTierColor("high")} border p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">High</p>
                  <p className="text-3xl font-bold">{riskStats.high}</p>
                </div>
                <Zap className="h-8 w-8" />
              </div>
            </Card>
            <Card className={`${getTierColor("medium")} border p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">Medium</p>
                  <p className="text-3xl font-bold">{riskStats.medium}</p>
                </div>
                <Target className="h-8 w-8" />
              </div>
            </Card>
            <Card className={`${getTierColor("low")} border p-4`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">Low</p>
                  <p className="text-3xl font-bold">{riskStats.low}</p>
                </div>
                <Shield className="h-8 w-8" />
              </div>
            </Card>
            <Card className="p-4 border">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">Total Assets</p>
                  <p className="text-3xl font-bold">{riskStats.total}</p>
                </div>
                <Globe className="h-8 w-8 text-muted-foreground" />
              </div>
            </Card>
          </div>

          {/* Main Grid */}
          <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
            {/* Left Column */}
            <div className="space-y-4">
              {/* Exposure Trend */}
              <Card>
                <div className="p-4 border-b">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <TrendingUp className="h-4 w-4" /> Exposure Trend (30 days)
                  </h3>
                </div>
                <div className="p-4 h-64">
                  {exposureTrend.length > 0 ? (
                    <SimpleChart
                      data={exposureTrend}
                      xKey="date"
                      yKeys={["new_assets", "new_exposures"]}
                      labels={["New Assets", "New Exposures"]}
                      colors={["#3b82f6", "#ef4444"]}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                      No trend data available. Run enrichment to populate.
                    </div>
                  )}
                </div>
              </Card>

              {/* Top Technologies with Risk */}
              <Card>
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <BarChart3 className="h-4 w-4" /> Top Technologies by Risk
                  </h3>
                  <Link href="/explore" className="text-xs text-accent hover:underline">
                    View all →
                  </Link>
                </div>
                <div className="p-4">
                  {topTech.length > 0 ? (
                    <div className="space-y-2">
                      {topTech.map((t, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <span className="w-8 text-right text-xs text-muted-foreground">{i + 1}.</span>
                          <span className="flex-1 font-mono text-sm truncate">{t.tech}</span>
                          <span className="px-2 py-0.5 rounded text-xs bg-surface-2">{t.count} assets</span>
                          <div className="w-24 h-2 bg-surface-2 rounded overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500"
                              style={{ width: `${Math.min(t.avg_risk, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-10 text-right">{t.avg_risk.toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No technology data. Run scans to populate.</p>
                  )}
                </div>
              </Card>

              {/* Expiring Certificates */}
              <Card>
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="h-4 w-4" /> Expiring Certificates (≤30 days)
                  </h3>
                  <Link href="/explore?type=certs" className="text-xs text-accent hover:underline">
                    View all →
                  </Link>
                </div>
                <div className="p-4">
                  {expiringCerts.length > 0 ? (
                    <div className="space-y-2">
                      {expiringCerts.map((c) => (
                        <div key={c.subject_cn} className="flex items-center justify-between text-sm">
                          <span className="font-mono truncate max-w-[200px]">{c.subject_cn}</span>
                          <span className="text-muted-foreground">{c.issuer_org}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-mono ${
                            c.days_left <= 7 ? "bg-red-500/20 text-red-400" :
                            c.days_left <= 14 ? "bg-yellow-500/20 text-yellow-400" :
                            "bg-blue-500/20 text-blue-400"
                          }`}>
                            {c.days_left}d
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No expiring certificates.</p>
                  )}
                </div>
              </Card>
            </div>

            {/* Right Column */}
            <div className="space-y-4">
              {/* Shadow IT Candidates */}
              <Card>
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Search className="h-4 w-4" /> Shadow IT Candidates
                  </h3>
                  <Link href="/explore" className="text-xs text-accent hover:underline">
                    Investigate →
                  </Link>
                </div>
                <div className="p-4">
                  {shadowIT.length > 0 ? (
                    <div className="space-y-2">
                      {shadowIT.map((s, i) => (
                        <div key={i} className="p-3 rounded border border-border/50">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-sm">{s.host}</span>
                            <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400">{s.risk_score.toFixed(0)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{s.reason}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No shadow IT candidates detected.</p>
                  )}
                </div>
              </Card>

              {/* Cloud Summary */}
              <Card>
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Cloud className="h-4 w-4" /> Cloud Assets
                  </h3>
                  <Link href="/asm/cloud" className="text-xs text-accent hover:underline">
                    View all →
                  </Link>
                </div>
                <div className="p-4">
                  {cloudSummary.length > 0 ? (
                    <div className="space-y-3">
                      {cloudSummary.map((c) => (
                        <div key={c.provider} className="p-3 rounded border border-border/50">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium capitalize">{c.provider}</span>
                            <span className="text-xs text-muted-foreground">{c.total} resources</span>
                          </div>
                          <div className="flex gap-2 text-xs">
                            {Object.entries(c.by_type).slice(0, 4).map(([type, count]) => (
                              <span key={type} className="px-2 py-0.5 rounded bg-surface-2">{type}: {count}</span>
                            ))}
                          </div>
                          {c.public_exposed > 0 && (
                            <div className="mt-2 text-xs text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" /> {c.public_exposed} publicly exposed
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No cloud assets discovered. Connect cloud accounts.</p>
                  )}
                </div>
              </Card>

              {/* Recent Watch Hits */}
              <Card>
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Zap className="h-4 w-4" /> Recent Alerts
                  </h3>
                  <Link href="/asm/watch" className="text-xs text-accent hover:underline">
                    Manage →
                  </Link>
                </div>
                <div className="p-4">
                  {watchHits.length > 0 ? (
                    <div className="space-y-2">
                      {watchHits.slice(0, 5).map((w, i) => (
                        <div key={i} className="p-2 rounded border border-border/50 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{w.rule_name}</span>
                            <span className="text-xs text-muted-foreground">{new Date(w.last_match_at).toLocaleString()}</span>
                          </div>
                          <div className="flex gap-2 text-xs text-muted-foreground mt-1">
                            <span>{w.new_matches} new {w.asset_type}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recent alerts.</p>
                  )}
                </div>
              </Card>

              {/* Enrichment Pipeline */}
              <Card>
                <div className="p-4 border-b flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <RefreshCw className="h-4 w-4" /> Enrichment Pipeline
                  </h3>
                  <Link href="/asm/enrichment" className="text-xs text-accent hover:underline">
                    View all →
                  </Link>
                </div>
                <div className="p-4">
                  {enrichmentJobs.length > 0 ? (
                    <div className="space-y-2">
                      {enrichmentJobs.slice(0, 5).map((j) => (
                        <div key={j.id} className="flex items-center justify-between text-sm p-2 rounded border border-border/50">
                          <div className="flex items-center gap-2">
                            <span className={getStatusColor(j.status)}>●</span>
                            <span className="font-mono text-xs">{j.source}</span>
                            <span className="text-muted-foreground">{j.target}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>+{j.new_assets} new</span>
                            <span>~{j.changes_count} changes</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No recent enrichment jobs.</p>
                  )}
                </div>
              </Card>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/asm/graph" className="card p-4 hover:border-accent/50 transition-colors group block">
              <div className="flex items-center gap-3">
                <Network className="h-6 w-6 text-accent group-hover:scale-110 transition-transform" />
                <div>
                  <p className="font-medium">Pivot Graph</p>
                  <p className="text-xs text-muted-foreground">Explore asset relationships</p>
                </div>
              </div>
            </Link>
            <Link href="/asm/timeline" className="card p-4 hover:border-accent/50 transition-colors group block">
              <div className="flex items-center gap-3">
                <Clock className="h-6 w-6 text-accent group-hover:scale-110 transition-transform" />
                <div>
                  <p className="font-medium">Asset Timeline</p>
                  <p className="text-xs text-muted-foreground">Track historical changes</p>
                </div>
              </div>
            </Link>
            <Link href="/asm/watch" className="card p-4 hover:border-accent/50 transition-colors group block">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-accent group-hover:scale-110 transition-transform" />
                <div>
                  <p className="font-medium">Watch Rules</p>
                  <p className="text-xs text-muted-foreground">Configure continuous monitoring</p>
                </div>
              </div>
            </Link>
            <Link href="/asm/enrichment" className="card p-4 hover:border-accent/50 transition-colors group block">
              <div className="flex items-center gap-3">
                <RefreshCw className="h-6 w-6 text-accent group-hover:scale-110 transition-transform" />
                <div>
                  <p className="font-medium">Enrichment</p>
                  <p className="text-xs text-muted-foreground">Run external data enrichment</p>
                </div>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SimpleChart({ data, xKey, yKeys, labels, colors }: {
  data: any[];
  xKey: string;
  yKeys: string[];
  labels: string[];
  colors: string[];
}) {
  if (!data.length) return null;
  const width = 600;
  const height = 200;
  const padding = { top: 20, right: 30, bottom: 30, left: 50 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const allValues: number[] = data.flatMap((d) => yKeys.map((k) => Number(d[k]) || 0));
  const maxValue = Math.max(...allValues, 1);
  const minValue = Math.min(...allValues, 0);

  const xScale = (i: number) => padding.left + (i / Math.max(data.length - 1, 1)) * innerWidth;
  const yScale = (v: number) => padding.top + innerHeight - ((v - minValue) / (maxValue - minValue || 1)) * innerHeight;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
      {/* Grid lines */}
      <g stroke="currentColor" strokeOpacity="0.1" strokeWidth="1">
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <line key={i} x1={padding.left} y1={padding.top + t * innerHeight} x2={padding.left + innerWidth} y2={padding.top + t * innerHeight} />
        ))}
      </g>
      {/* Y axis labels */}
      <g fontSize={10} fill="currentColor" fillOpacity="0.5">
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => (
          <text key={i} x={padding.left - 8} y={padding.top + t * innerHeight + 4} textAnchor="end" dominantBaseline="middle">
            {Math.round(maxValue * (1 - t))}
          </text>
        ))}
      </g>
      {/* X axis labels */}
      <g fontSize={10} fill="currentColor" fillOpacity="0.5">
        {data.map((d, i) => (
          <text key={i} x={xScale(i)} y={height - 8} textAnchor="middle" dominantBaseline="hanging">
            {String(d[xKey]).slice(5, 10)}
          </text>
        ))}
      </g>
      {/* Lines */}
      {yKeys.map((key, ki) => (
        <path
          key={key}
          d={data.map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(Number(d[key]) || 0)}`).join(" ")}
          stroke={colors[ki % colors.length]}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
      {/* Legend */}
      <g fontSize={11} fill="currentColor">
        {labels.map((label, i) => (
          <g key={label} transform={"translate(" + (padding.left + i * 120) + ", " + (padding.top - 5) + ")"}>
            <line x1={0} y1={0} x2={12} y2={0} stroke={colors[i % colors.length]} strokeWidth={2} />
            <text x={16} y={4}>{label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}