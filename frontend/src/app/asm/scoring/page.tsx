"use client";

import { useEffect, useState } from "react";
import { Target, Shield, Zap, BarChart3, Download, Filter, ChevronLeft, ChevronRight, RefreshCw, Search, AlertTriangle, TrendingUp, X, Globe } from "lucide-react";
import { Card, PageHeader, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from "@/components/ui";

interface ScoredAsset {
  host: string;
  ip: string | null;
  ports: number[];
  tech: string[];
  title: string | null;
  status: number | null;
  tls: Record<string, any>;
  exposure_score: number;
  attractiveness_score: number;
  exploitability_score: number;
  risk_score: number;
  tier: string;
  factors: Record<string, any>;
  calculated_at: string;
}

export default function ASMScoringPage() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [assets, setAssets] = useState<ScoredAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    minRisk: 0,
    tier: "all",
    search: "",
  });
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [showDetails, setShowDetails] = useState<ScoredAsset | null>(null);

  const TIER_COLORS: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400 border-red-500/30",
    high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    info: "bg-surface-2 text-muted-foreground",
  };

  const TIER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    critical: AlertTriangle,
    high: Zap,
    medium: Target,
    low: Shield,
    info: Shield,
  };

  useEffect(() => {
    fetch("/api/programmes")
      .then((r) => r.json())
      .then((d) => setProgrammes(d.programmes || []));
  }, []);

  const fetchAssets = async () => {
    if (!programmeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        programmeId,
        minRisk: String(filters.minRisk),
        tier: filters.tier,
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      
      const res = await fetch(`/api/asm/scores?${params}`);
      const data = await res.json();
      if (res.ok) {
        setAssets(data.assets || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssets();
  }, [programmeId, page, filters.minRisk, filters.tier]);

  const filteredAssets = assets.filter((a) => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      return (
        a.host.toLowerCase().includes(search) ||
        a.ip?.toLowerCase().includes(search) ||
        a.tech.some((t) => t.toLowerCase().includes(search)) ||
        a.title?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const exportAssets = () => {
    const csv = [
      ["Host", "IP", "Ports", "Technologies", "Title", "Status", "Exposure", "Attractiveness", "Exploitability", "Risk Score", "Tier", "Calculated At"],
      ...filteredAssets.map((a) => [
        a.host,
        a.ip || "",
        a.ports.join(", "),
        a.tech.join(", "),
        a.title || "",
        a.status || "",
        a.exposure_score.toFixed(1),
        a.attractiveness_score.toFixed(1),
        a.exploitability_score.toFixed(1),
        a.risk_score.toFixed(1),
        a.tier,
        a.calculated_at,
      ]),
    ].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `risk-scores-${programmeId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getTierBadge = (tier: string) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${TIER_COLORS[tier] || TIER_COLORS.info}`}>
      {tier.toUpperCase()}
    </span>
  );

  const getRiskColor = (score: number) => {
    if (score >= 80) return "text-red-400";
    if (score >= 60) return "text-orange-400";
    if (score >= 40) return "text-yellow-400";
    if (score >= 20) return "text-blue-400";
    return "text-muted-foreground";
  };

  const renderScoreBar = (score: number, color: string) => (
    <div className="w-24 h-2 bg-surface-2 rounded overflow-hidden">
      <div
        className="h-full"
        style={{ width: `${Math.min(score, 100)}%`, backgroundColor: color }}
      />
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Attack Surface Scoring"
        description="Risk-based prioritization — exposure, attractiveness, and exploitability scores for every asset."
        icon={Target}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={programmeId}
              onChange={(e) => setProgrammeId(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none"
              disabled={loading}
            >
              <option value="">Select programme</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button variant="outline" onClick={fetchAssets} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button onClick={exportAssets} disabled={filteredAssets.length === 0}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {["critical", "high", "medium", "low", "info"].map((tier) => {
          const count = filteredAssets.filter((a) => a.tier === tier).length;
          const TierIcon = TIER_ICONS[tier];
          return (
            <Card key={tier} className={`p-4 ${TIER_COLORS[tier]} border`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide">{tier}</p>
                  <p className="text-3xl font-bold">{count}</p>
                </div>
                <TierIcon className="h-8 w-8" />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label>Min Risk Score:</Label>
            <Select value={String(filters.minRisk)} onValueChange={(v) => { setFilters({...filters, minRisk: parseInt(v)}); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">0+ (All)</SelectItem>
                <SelectItem value="20">20+</SelectItem>
                <SelectItem value="40">40+</SelectItem>
                <SelectItem value="60">60+</SelectItem>
                <SelectItem value="80">80+</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label>Tier:</Label>
            <Select value={filters.tier} onValueChange={(v) => { setFilters({...filters, tier: v}); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <Label>Search:</Label>
            <Input
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value})}
              placeholder="Search host, IP, technology, title..."
              className="flex-1 max-w-md"
            />
          </div>
        </div>
      </Card>

      {/* Assets Table */}
      <Card>
        <div className="table-wrap">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="p-3 font-medium">Asset</th>
                <th className="p-3 font-medium">IP</th>
                <th className="p-3 font-medium">Tech</th>
                <th className="p-3 font-medium">Exposure</th>
                <th className="p-3 font-medium">Attractiveness</th>
                <th className="p-3 font-medium">Exploitability</th>
                <th className="p-3 font-medium">Risk Score</th>
                <th className="p-3 font-medium">Tier</th>
                <th className="p-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredAssets.length === 0 && !loading ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No scored assets found. Run risk scoring calculation.
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => (
                  <tr key={asset.host} className="hover:bg-surface-1/50 cursor-pointer" onClick={() => setShowDetails(asset)}>
                    <td className="p-3">
                      <p className="font-mono text-sm truncate max-w-[200px]">{asset.host}</p>
                      {asset.title && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{asset.title}</p>}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{asset.ip || "—"}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {asset.tech.slice(0, 3).map((t) => (
                          <span key={t} className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted-foreground">{t}</span>
                        ))}
                        {asset.tech.length > 3 && (
                          <span className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted-foreground">+{asset.tech.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {renderScoreBar(asset.exposure_score, "#ef4444")}
                        <span className={getRiskColor(asset.exposure_score)}>{asset.exposure_score.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {renderScoreBar(asset.attractiveness_score, "#f59e0b")}
                        <span className={getRiskColor(asset.attractiveness_score)}>{asset.attractiveness_score.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {renderScoreBar(asset.exploitability_score, "#8b5cf6")}
                        <span className={getRiskColor(asset.exploitability_score)}>{asset.exploitability_score.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {renderScoreBar(asset.risk_score, getRiskColor(asset.risk_score).replace("text-", "bg-").replace("-400", "-500/20"))}
                        <span className={`font-bold ${getRiskColor(asset.risk_score)}`}>{asset.risk_score.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="p-3">{getTierBadge(asset.tier)}</td>
                    <td className="p-3 text-sm text-muted-foreground">{new Date(asset.calculated_at).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {loading && assets.length === 0 && (
          <div className="p-8 text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Loading risk scores...</p>
          </div>
        )}

        {/* Pagination */}
        {assets.length === pageSize && (
          <div className="p-4 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, assets.length)}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Scoring Methodology */}
      <Card className="p-4">
        <h4 className="font-medium mb-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5" /> Scoring Methodology
        </h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <div className="p-3 rounded border border-red-500/20 bg-red-500/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <strong>Exposure Score (0-100)</strong>
            </div>
            <p className="text-muted-foreground">Internet-facing services, open ports, public endpoints, SSL/TLS exposure, certificate transparency.</p>
          </div>
          <div className="p-3 rounded border border-yellow-500/20 bg-yellow-500/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <strong>Attractiveness Score (0-100)</strong>
            </div>
            <p className="text-muted-foreground">Technology stack complexity, authentication endpoints, parameter-rich URLs, admin panels, API endpoints.</p>
          </div>
          <div className="p-3 rounded border border-purple-500/20 bg-purple-500/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-full bg-purple-500" />
              <strong>Exploitability Score (0-100)</strong>
            </div>
            <p className="text-muted-foreground">Known CVEs, public exploits, exploit frameworks, weaponized vulnerabilities, exploit maturity.</p>
          </div>
        </div>
        <div className="mt-4 p-3 rounded border border-blue-500/20 bg-blue-500/5">
          <strong>Composite Risk Score</strong> = (Exposure × 0.4) + (Attractiveness × 0.3) + (Exploitability × 0.3)
          <p className="text-xs text-muted-foreground mt-1">Scores recalculated daily via enrichment pipeline. Tier thresholds: Critical &ge;80, High &ge;60, Medium &ge;40, Low &ge;20, Info up to 20.</p>
        </div>
      </Card>

      {/* Asset Detail Modal */}
      {showDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="modal-panel max-w-4xl">
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <p className="font-mono text-lg">{showDetails.host}</p>
                <p className="text-sm text-muted-foreground">{showDetails.ip || "No IP"}</p>
              </div>
              <div className="flex items-center gap-2">
                {getTierBadge(showDetails.tier)}
                <Button variant="ghost" size="icon" onClick={() => setShowDetails(null)}>
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
            <div className="p-4 space-y-4">
              {/* Score Breakdown */}
              <div className="grid gap-4 md:grid-cols-3">
                {[
                  { label: "Exposure", score: showDetails.exposure_score, color: "#ef4444", IconComp: Globe },
                  { label: "Attractiveness", score: showDetails.attractiveness_score, color: "#f59e0b", IconComp: Zap },
                  { label: "Exploitability", score: showDetails.exploitability_score, color: "#8b5cf6", IconComp: Target },
                ].map(({ label, score, color, IconComp }) => (
                  <div key={label} className="p-4 rounded border border-border/50 text-center">
                    <IconComp className="mx-auto h-8 w-8 mb-2" style={{ color }} />
                    <p className="text-xs text-muted-foreground uppercase">{label}</p>
                    <p className="text-4xl font-bold" style={{ color }}>{score.toFixed(1)}</p>
                    <div className="mt-2 h-2 bg-surface-2 rounded overflow-hidden">
                      <div className="h-full" style={{ width: `${Math.min(score, 100)}%`, backgroundColor: color }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Factors */}
              {showDetails.factors && Object.keys(showDetails.factors).length > 0 && (
                <div>
                  <h5 className="font-medium mb-2">Scoring Factors</h5>
                  <div className="grid gap-2 md:grid-cols-2">
                    {Object.entries(showDetails.factors).map(([key, value]) => (
                      <div key={key} className="p-2 rounded bg-surface-2 text-sm">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="ml-2 font-mono">{JSON.stringify(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw Data */}
              <div>
                <h5 className="font-medium mb-2">Raw Data</h5>
                <div className="grid gap-4 md:grid-cols-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Ports</p>
                    <p className="font-mono">{showDetails.ports.join(", ") || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className="font-mono">{showDetails.status || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Technologies</p>
                    <p className="font-mono">{showDetails.tech.join(", ") || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">TLS</p>
                    <pre className="text-xs bg-surface-2 p-2 rounded max-h-32 overflow-auto">{JSON.stringify(showDetails.tls, null, 2)}</pre>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}