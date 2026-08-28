"use client";

import { useEffect, useState } from "react";
import { Cloud, Globe, Database, Shield, AlertTriangle, Download, Filter, ChevronLeft, ChevronRight, RefreshCw, Search, ExternalLink, Lock, Unlock, Zap } from "lucide-react";
import { Card, PageHeader, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from "@/components/ui";

interface CloudAsset {
  id: string;
  provider: string;
  resource_type: string;
  resource_id: string;
  resource_arn: string | null;
  region: string | null;
  name: string | null;
  metadata: Record<string, any>;
  tags: Record<string, any>;
  public_exposure: boolean;
  first_seen: string;
  last_seen: string;
}

interface CloudSummary {
  provider: string;
  total: number;
  public_exposed: number;
  by_type: Record<string, number>;
}

export default function ASMCloudPage() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [assets, setAssets] = useState<CloudAsset[]>([]);
  const [summary, setSummary] = useState<CloudSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({
    provider: "all",
    resourceType: "",
    publicOnly: false,
    search: "",
  });
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const PROVIDER_COLORS: Record<string, string> = {
    aws: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    azure: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    gcp: "bg-green-500/20 text-green-400 border-green-500/30",
    digitalocean: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    linode: "bg-green-500/20 text-green-400 border-green-500/30",
    vultr: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };

  const PROVIDER_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    aws: Cloud,
    azure: Cloud,
    gcp: Cloud,
    digitalocean: Cloud,
    linode: Cloud,
    vultr: Cloud,
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
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (filters.provider !== "all") params.set("provider", filters.provider);
      if (filters.resourceType) params.set("resourceType", filters.resourceType);
      if (filters.publicOnly) params.set("publicOnly", "true");
      
      const res = await fetch(`/api/asm/cloud?${params}`);
      const data = await res.json();
      if (res.ok) {
        setAssets(data.assets || []);
        // Also fetch summary
        const summaryRes = await fetch(`/api/asm/cloud?programmeId=${programmeId}&limit=1000`);
        const summaryData = await summaryRes.json();
        if (summaryRes.ok) {
          setSummary(summarizeCloud(summaryData.assets || []));
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const summarizeCloud = (assets: CloudAsset[]): CloudSummary[] => {
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

  useEffect(() => {
    fetchAssets();
  }, [programmeId, page, filters.provider, filters.resourceType, filters.publicOnly]);

  const filteredAssets = assets.filter((a) => {
    if (filters.search) {
      const search = filters.search.toLowerCase();
      return (
        a.resource_id.toLowerCase().includes(search) ||
        a.name?.toLowerCase().includes(search) ||
        a.region?.toLowerCase().includes(search) ||
        a.resource_type.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const exportAssets = () => {
    const csv = [
      ["Provider", "Resource Type", "Resource ID", "Resource ARN", "Region", "Name", "Public Exposure", "Tags", "First Seen", "Last Seen"],
      ...filteredAssets.map((a) => [
        a.provider,
        a.resource_type,
        a.resource_id,
        a.resource_arn || "",
        a.region || "",
        a.name || "",
        a.public_exposure ? "Yes" : "No",
        JSON.stringify(a.tags),
        a.first_seen,
        a.last_seen,
      ]),
    ].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cloud-assets-${programmeId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getProviderBadge = (provider: string) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${PROVIDER_COLORS[provider] || "bg-surface-2 text-muted-foreground"}`}>
      {provider.toUpperCase()}
    </span>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cloud Asset Inventory"
        description="Discover and monitor cloud resources across AWS, Azure, GCP, and other providers."
        icon={Cloud}
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

      {/* Summary Cards */}
      {summary.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
          {summary.map((s) => (
            <Card key={s.provider} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="font-medium capitalize">{s.provider}</h4>
                {getProviderBadge(s.provider)}
              </div>
              <div className="text-3xl font-bold">{s.total}</div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                <span>{s.public_exposed} public</span>
                <span>{Object.keys(s.by_type).length} types</span>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(s.by_type).slice(0, 5).map(([type, count]) => (
                  <span key={type} className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted-foreground">
                    {type}: {count}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label>Provider:</Label>
            <Select value={filters.provider} onValueChange={(v) => { setFilters({...filters, provider: v}); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Providers</SelectItem>
                <SelectItem value="aws">AWS</SelectItem>
                <SelectItem value="azure">Azure</SelectItem>
                <SelectItem value="gcp">GCP</SelectItem>
                <SelectItem value="digitalocean">DigitalOcean</SelectItem>
                <SelectItem value="linode">Linode</SelectItem>
                <SelectItem value="vultr">Vultr</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label>Resource Type:</Label>
            <Input
              value={filters.resourceType}
              onChange={(e) => { setFilters({...filters, resourceType: e.target.value}); setPage(0); }}
              placeholder="s3, ec2, storage..."
              className="w-[180px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="cursor-pointer">
              <input
                type="checkbox"
                checked={filters.publicOnly}
                onChange={(e) => { setFilters({...filters, publicOnly: e.target.checked}); setPage(0); }}
                className="mr-2 rounded"
              />
              Public Only
            </Label>
          </div>
          <div className="flex items-center gap-2 flex-1">
            <Label>Search:</Label>
            <Input
              value={filters.search}
              onChange={(e) => setFilters({...filters, search: e.target.value})}
              placeholder="Search resource ID, name, region, type..."
              className="flex-1 max-w-md"
            />
          </div>
        </div>
      </Card>

      {/* Assets Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="p-3 font-medium">Resource</th>
                <th className="p-3 font-medium">Provider</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Region</th>
                <th className="p-3 font-medium">Public</th>
                <th className="p-3 font-medium">Tags</th>
                <th className="p-3 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredAssets.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    {assets.length === 0 ? "No cloud assets discovered. Run cloud enrichment to populate." : "No assets match current filters."}
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => (
                  <tr key={asset.resource_id} className="hover:bg-surface-1/50">
                    <td className="p-3">
                      <div>
                        <p className="font-mono text-sm truncate max-w-[200px]">{asset.resource_id}</p>
                        {asset.name && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{asset.name}</p>}
                      </div>
                    </td>
                    <td className="p-3">{getProviderBadge(asset.provider)}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-xs bg-surface-2">{asset.resource_type}</span>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">{asset.region || "—"}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${asset.public_exposure ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"}`}>
                        {asset.public_exposure ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {asset.public_exposure ? "Public" : "Private"}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(asset.tags).slice(0, 3).map(([k, v]) => (
                          <span key={k} className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted-foreground">
                            {k}: {v}
                          </span>
                        ))}
                        {Object.keys(asset.tags).length > 3 && (
                          <span className="px-2 py-0.5 rounded text-xs bg-surface-2 text-muted-foreground">
                            +{Object.keys(asset.tags).length - 3} more
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {new Date(asset.last_seen).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {loading && assets.length === 0 && (
          <div className="p-8 text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Loading cloud assets...</p>
          </div>
        )}

        {/* Pagination */}
        {assets.length === pageSize && (
          <div className="p-4 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, assets.length)} of {assets.length}+
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

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-4 border-border/50 hover:border-accent/50 transition-colors">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Zap className="h-5 w-5" /> Trigger Cloud Discovery
          </h4>
          <p className="text-sm text-muted-foreground mb-3">Run enrichment to discover cloud assets in connected accounts.</p>
          <Button variant="outline" size="sm">
            <ExternalLink className="h-4 w-4 mr-1" /> Go to Enrichment
          </Button>
        </Card>
        <Card className="p-4 border-border/50 hover:border-accent/50 transition-colors">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Shield className="h-5 w-5" /> Public Exposure Review
          </h4>
          <p className="text-sm text-muted-foreground mb-3">Review and remediate publicly exposed cloud resources.</p>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-1" /> Filter Public Only
          </Button>
        </Card>
        <Card className="p-4 border-border/50 hover:border-accent/50 transition-colors">
          <h4 className="font-medium mb-2 flex items-center gap-2">
            <Database className="h-5 w-5" /> Compliance Reports
          </h4>
          <p className="text-sm text-muted-foreground mb-3">Generate PCI-DSS, SOC2, or custom cloud asset reports.</p>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 mr-1" /> Generate Report
          </Button>
        </Card>
      </div>
    </div>
  );
}