"use client";

import { useEffect, useState } from "react";
import { Search, Clock, Filter, Download, ChevronLeft, ChevronRight, RefreshCw, Calendar } from "lucide-react";
import { Card, PageHeader, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";

interface TimelineChange {
  id: string;
  asset_id: string;
  field_name: string;
  old_value: any;
  new_value: any;
  change_type: string;
  source: string;
  meta: Record<string, any>;
  created_at: string;
}

interface TimelineAsset {
  host: string;
  asset_id: string;
  changes: TimelineChange[];
}

export default function ASMTimelinePage() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [host, setHost] = useState("");
  const [assets, setAssets] = useState<TimelineAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<TimelineAsset | null>(null);
  const [filters, setFilters] = useState({
    fields: "" as string,
    changeTypes: [] as string[],
    sources: [] as string[],
    days: 30,
  });
  const [availableFields, setAvailableFields] = useState<string[]>([]);
  const [availableSources, setAvailableSources] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  useEffect(() => {
    fetch("/api/programmes")
      .then((r) => r.json())
      .then((d) => setProgrammes(d.programmes || []));
  }, []);

  const fetchTimeline = async () => {
    if (!programmeId || !host.trim()) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        host: host.trim(),
        programmeId,
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (filters.fields) params.set("fields", filters.fields);
      
      const res = await fetch(`/api/asm/timeline?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch timeline");
      
      // If we're on page 0, replace; otherwise append
      if (page === 0) {
        setAssets([{ host: data.host, asset_id: data.asset_id, changes: data.changes }]);
      } else {
        setAssets((prev) => {
          const existing = prev.find((a) => a.asset_id === data.asset_id);
          if (existing) {
            return prev.map((a) => a.asset_id === data.asset_id ? { ...a, changes: [...a.changes, ...data.changes] } : a);
          }
          return [...prev, { host: data.host, asset_id: data.asset_id, changes: data.changes }];
        });
      }

      // Extract unique fields and sources for filters
      const allChanges = data.changes;
      setAvailableFields([...new Set(allChanges.map((c: any) => c.field_name))].sort());
      setAvailableSources([...new Set(allChanges.map((c: any) => c.source))].sort());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllAssetsTimeline = async () => {
    if (!programmeId) return;
    setLoading(true);
    setError("");
    try {
      // Get recent changes across all assets
      const res = await fetch(`/api/asm/timeline/all?programmeId=${programmeId}&days=${filters.days}&limit=500`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch timeline");
      setAssets(data.assets || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (host.trim()) {
      setPage(0);
      fetchTimeline();
    } else if (programmeId) {
      fetchAllAssetsTimeline();
    }
  }, [programmeId, host, page, filters.fields]);

  const filteredChanges = (asset: TimelineAsset) => {
    return asset.changes.filter((c) => {
      if (filters.changeTypes.length && !filters.changeTypes.includes(c.change_type)) return false;
      if (filters.sources.length && !filters.sources.includes(c.source)) return false;
      return true;
    });
  };

  const formatValue = (val: any) => {
    if (val === null || val === undefined) return <span className="text-muted-foreground italic">null</span>;
    if (typeof val === "object") return <pre className="text-xs font-mono bg-surface-2 p-2 rounded max-h-32 overflow-auto">{JSON.stringify(val, null, 2)}</pre>;
    return String(val);
  };

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case "created": return "bg-green-500/20 text-green-400";
      case "updated": return "bg-blue-500/20 text-blue-400";
      case "deleted": return "bg-red-500/20 text-red-400";
      default: return "bg-surface-2 text-muted-foreground";
    }
  };

  const getSourceColor = (source: string) => {
    const colors: Record<string, string> = {
      ingest: "bg-purple-500/20 text-purple-400",
      scan: "bg-orange-500/20 text-orange-400",
      manual: "bg-gray-500/20 text-gray-400",
      enrichment: "bg-teal-500/20 text-teal-400",
      censys: "bg-indigo-500/20 text-indigo-400",
      fofa: "bg-pink-500/20 text-pink-400",
      shodan: "bg-amber-500/20 text-amber-400",
      ct: "bg-cyan-500/20 text-cyan-400",
    };
    return colors[source] || "bg-surface-2 text-muted-foreground";
  };

  const exportTimeline = () => {
    const allChanges = assets.flatMap((a) => 
      filteredChanges(a).map((c) => ({
        asset: a.host,
        asset_id: a.asset_id,
        ...c,
      }))
    );
    const csv = [
      ["Asset", "Asset ID", "Field", "Change Type", "Source", "Old Value", "New Value", "Timestamp"],
      ...allChanges.map((c) => [
        c.asset,
        c.asset_id,
        c.field_name,
        c.change_type,
        c.source,
        JSON.stringify(c.old_value),
        JSON.stringify(c.new_value),
        c.created_at,
      ]),
    ].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-${host || programmeId}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 h-[calc(100vh-200px)] min-h-[700px]">
      <PageHeader
        title="Asset Timeline"
        description="Track historical changes to your attack surface assets — field-level diffs with source attribution."
        icon={Clock}
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
            {programmeId && host && (
              <Button variant="outline" onClick={exportTimeline} disabled={loading}>
                <Download className="h-4 w-4 mr-1" /> Export CSV
              </Button>
            )}
            <Button variant="outline" onClick={host ? fetchTimeline : fetchAllAssetsTimeline} disabled={loading || (!host && !programmeId)}>
              <RefreshCw className="h-4 w-4" /> {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>
        }
      />

      {/* Search & Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Host Search */}
          <div className="flex items-center gap-2 flex-1 min-w-[300px]">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Asset:</label>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (host ? fetchTimeline() : fetchAllAssetsTimeline())}
              placeholder={host ? "Press Enter to search specific asset" : "Enter hostname/IP, or leave blank for all assets"}
              className="flex-1 font-mono"
              disabled={loading}
            />
            {host && (
              <Button variant="ghost" size="icon" onClick={() => setHost("")} title="Clear host filter">
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Time Range */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Time Range:</label>
            <Select value={String(filters.days)} onValueChange={(v) => setFilters((p) => ({ ...p, days: parseInt(v) }))}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
                <SelectItem value="365">Last year</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Field Filter */}
          {availableFields.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Fields:</label>
              <Select value={filters.fields} onValueChange={(v) => setFilters((p) => ({ ...p, fields: v }))}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All fields" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All fields</SelectItem>
                  {availableFields.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Change Type Filter */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Types:</label>
            <div className="flex gap-1">
              {["created", "updated", "deleted"].map((type) => (
                <Button
                  key={type}
                  variant={filters.changeTypes.includes(type) ? "default" : "outline"}
                  size="sm"
                  onClick={() => setFilters((p) => ({
                    ...p,
                    changeTypes: p.changeTypes.includes(type) 
                      ? p.changeTypes.filter((t) => t !== type) 
                      : [...p.changeTypes, type]
                  }))}
                  className={`h-7 px-2 ${getChangeTypeColor(type)}`}
                >
                  {type.charAt(0).toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {/* Source Filter */}
          {availableSources.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">Sources:</label>
              <Select value={filters.sources.join(",")} onValueChange={(v) => setFilters((p) => ({ ...p, sources: v.split(",").filter(Boolean) }))} multiple>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  {availableSources.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Timeline View */}
      <div className="space-y-4">
        {assets.length === 0 && !loading && (
          <Card className="p-8 text-center">
            <Clock className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No timeline data found</h3>
            <p className="text-sm text-muted-foreground">
              {host ? "No changes recorded for this asset." : "No recent changes across assets in this programme."}
            </p>
          </Card>
        )}

        {assets.map((asset) => (
          <Card key={asset.asset_id} className="overflow-hidden">
            {/* Asset Header */}
            <div className="p-4 border-b bg-surface-1/50 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="font-mono font-medium">{asset.host}</p>
                  <p className="text-xs text-muted-foreground">{asset.asset_id}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{filteredChanges(asset).length} changes</span>
                {asset.changes.length > 0 && (
                  <span>• First seen: {new Date(asset.changes[asset.changes.length - 1].created_at).toLocaleString()}</span>
                )}
              </div>
            </div>

            {/* Changes */}
            <div className="divide-y">
              {filteredChanges(asset).length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No changes match current filters.
                </div>
              ) : (
                filteredChanges(asset).map((change, idx) => (
                  <div key={`${change.id}-${idx}`} className="p-4 hover:bg-surface-1/50 transition-colors">
                    <div className="flex flex-wrap items-start gap-4">
                      {/* Timestamp & Type */}
                      <div className="flex flex-col items-start gap-1 min-w-[140px]">
                        <span className="font-mono text-xs text-muted-foreground">
                          {new Date(change.created_at).toLocaleString()}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getChangeTypeColor(change.change_type)}`}>
                          {change.change_type}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs ${getSourceColor(change.source)}`}>
                          {change.source}
                        </span>
                      </div>

                      {/* Field Name */}
                      <div className="flex-1 min-w-[150px]">
                        <span className="font-mono text-sm font-medium text-accent">{change.field_name}</span>
                        {change.meta && Object.keys(change.meta).length > 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {Object.entries(change.meta).map(([k, v]) => `${k}: ${v}`).join(", ")}
                          </p>
                        )}
                      </div>

                      {/* Old Value */}
                      <div className="flex-1 min-w-[200px]">
                        <p className="text-xs text-muted-foreground mb-1">Old Value</p>
                        <div className="bg-red-500/10 border border-red-500/20 rounded p-2 max-h-40 overflow-auto">
                          {change.old_value !== null && change.old_value !== undefined ? (
                            formatValue(change.old_value)
                          ) : (
                            <span className="text-muted-foreground italic">(not set)</span>
                          )}
                        </div>
                      </div>

                      {/* New Value */}
                      <div className="flex-1 min-w-[200px]">
                        <p className="text-xs text-muted-foreground mb-1">New Value</p>
                        <div className="bg-green-500/10 border border-green-500/20 rounded p-2 max-h-40 overflow-auto">
                          {change.new_value !== null && change.new_value !== undefined ? (
                            formatValue(change.new_value)
                          ) : (
                            <span className="text-muted-foreground italic">(deleted)</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Pagination for this asset */}
            {asset.changes.length >= pageSize && (
              <div className="p-4 border-t flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, asset.changes.length)} of {asset.changes.length}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}>
                    <ChevronLeft className="h-4 w-4" /> Prev
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={loading}>
                    Next <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ))}

        {loading && assets.length === 0 && (
          <Card className="p-8 text-center">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Loading timeline...</p>
          </Card>
        )}
      </div>
    </div>
  );
}