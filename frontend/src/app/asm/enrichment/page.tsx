"use client";

import { useEffect, useState } from "react";
import { Plus, RefreshCw, Loader2, Play, Pause, CheckCircle, XCircle, AlertCircle, Clock, Database, Zap, Cloud, Globe, Search, Download, ChevronLeft, ChevronRight, Settings, ExternalLink } from "lucide-react";
import { Card, PageHeader, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label, Textarea } from "@/components/ui";

interface EnrichmentJob {
  id: string;
  programme_id: string;
  source: string;
  target: string;
  target_type: string;
  params: Record<string, any>;
  status: string;
  result: Record<string, any> | null;
  changes_count: number;
  new_assets: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

const SOURCES = [
  { value: "censys", label: "Censys", icon: Database, description: "Internet-wide asset intelligence", requiresKey: true },
  { value: "fofa", label: "Fofa", icon: Search, description: "Chinese cyberspace search engine", requiresKey: true },
  { value: "binaryedge", label: "BinaryEdge", icon: Globe, description: "Internet scanning platform", requiresKey: true },
  { value: "shodan", label: "Shodan", icon: Zap, description: "Internet-connected device search", requiresKey: true },
  { value: "zoomeye", label: "ZoomEye", icon: Search, description: "Chinese cyberspace mapping", requiresKey: true },
  { value: "github", label: "GitHub", icon: Globe, description: "Code search for secrets/exposure", requiresKey: true },
  { value: "ct", label: "Certificate Transparency", icon: Cloud, description: "CT log monitoring", requiresKey: false },
  { value: "cloud", label: "Cloud Providers", icon: Cloud, description: "AWS/Azure/GCP asset discovery", requiresKey: true },
];

const TARGET_TYPES = [
  { value: "domain", label: "Domain" },
  { value: "ip", label: "IP Address" },
  { value: "org", label: "Organization" },
  { value: "asn", label: "ASN" },
];

export default function ASMEnrichmentPage() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [jobs, setJobs] = useState<EnrichmentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedJob, setSelectedJob] = useState<EnrichmentJob | null>(null);
  const [page, setPage] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const pageSize = 20;

  const [newJob, setNewJob] = useState({
    target: "",
    target_type: "domain",
    sources: [] as string[],
    params: {} as Record<string, any>,
  });

  useEffect(() => {
    fetch("/api/programmes")
      .then((r) => r.json())
      .then((d) => setProgrammes(d.programmes || []));
  }, []);

  const fetchJobs = async () => {
    if (!programmeId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        programmeId,
        limit: String(pageSize),
        offset: String(page * pageSize),
      });
      if (statusFilter) params.set("status", statusFilter);
      
      const res = await fetch(`/api/asm/enrichment?${params}`);
      const data = await res.json();
      if (res.ok) {
        setJobs(data.jobs || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [programmeId, page, statusFilter]);

  const handleCreateJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJob.target.trim() || newJob.sources.length === 0) return;
    
    try {
      const res = await fetch("/api/asm/enrichment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programmeId,
          target: newJob.target,
          targetType: newJob.target_type,
          sources: newJob.sources,
          params: newJob.params,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create job");
      
      setShowCreate(false);
      setNewJob({ target: "", target_type: "domain", sources: [], params: {} });
      fetchJobs();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRefreshJob = async (jobId: string) => {
    try {
      const res = await fetch(`/api/asm/enrichment/${jobId}`);
      const data = await res.json();
      if (res.ok) {
        setJobs((prev) => prev.map((j) => j.id === jobId ? data.job : j));
        if (selectedJob?.id === jobId) setSelectedJob(data.job);
      }
    } catch (e) { console.error(e); }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "done": return "bg-green-500/20 text-green-400 border-green-500/30";
      case "running": return "bg-blue-500/20 text-blue-400 border-blue-500/30 animate-pulse";
      case "pending": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "failed": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "partial": return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      default: return "bg-surface-2 text-muted-foreground";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "done": return <CheckCircle className="h-4 w-4" />;
      case "running": return <Loader2 className="h-4 w-4 animate-spin" />;
      case "pending": return <Clock className="h-4 w-4" />;
      case "failed": return <XCircle className="h-4 w-4" />;
      case "partial": return <AlertCircle className="h-4 w-4" />;
      default: return <Clock className="h-4 w-4" />;
    }
  };

  const getSourceInfo = (source: string) => {
    return SOURCES.find((s) => s.value === source) || { label: source, icon: Database, description: "", requiresKey: false };
  };

  const formatDuration = (started: string | null, finished: string | null) => {
    if (!started) return "—";
    const start = new Date(started).getTime();
    const end = finished ? new Date(finished).getTime() : Date.now();
    const diff = end - start;
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
    return `${(diff / 60000).toFixed(1)}m`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Enrichment Pipeline"
        description="Enrich your attack surface with external intelligence sources — Censys, Fofa, Shodan, BinaryEdge, and more."
        icon={Zap}
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
            <Button onClick={fetchJobs} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1" /> New Enrichment
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Sources Overview */}
      <Card>
        <div className="p-4 border-b">
          <h3 className="font-semibold">Available Enrichment Sources</h3>
        </div>
        <div className="p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SOURCES.map((source) => {
              const configured = ["censys", "fofa", "binaryedge", "shodan", "zoomeye", "github"].includes(source.value) 
                ? (() => {
                  // Check if API keys are configured (would need backend check)
                  return false; // Placeholder
                })() 
                : !source.requiresKey;
              
              return (
                <div key={source.value} className="p-3 rounded border border-border/50 hover:border-accent/50 transition-colors">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                      <source.icon className="h-4 w-4 text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{source.label}</p>
                      <p className="text-xs text-muted-foreground truncate">{source.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={configured ? "text-green-400" : "text-amber-400"}>
                      {configured ? "Configured" : source.requiresKey ? "Needs API Key" : "Ready"}
                    </span>
                    {configured && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      {/* Jobs List */}
      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold">Enrichment Jobs</h3>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="All statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="done">Completed</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="p-4">
          {jobs.length === 0 && !loading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Zap className="mx-auto h-12 w-12 mb-4 text-muted-foreground/50" />
              <p>No enrichment jobs yet. Create one to start enriching your attack surface.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const sourceInfo = getSourceInfo(job.source);
                return (
                  <div key={job.id} className="p-4 rounded border border-border/50 hover:border-accent/50 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                          <sourceInfo.icon className="h-5 w-5 text-accent" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-medium truncate">{job.target}</p>
                            <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(job.status)}`}>
                              {getStatusIcon(job.status)} {job.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-1">
                            <span className="font-mono text-xs">{job.source}</span>
                            <span>•</span>
                            <span>{job.target_type}</span>
                            <span>•</span>
                            <span>{formatDuration(job.started_at, job.finished_at)}</span>
                            {job.new_assets > 0 && (
                              <span className="text-green-400">+{job.new_assets} new assets</span>
                            )}
                            {job.changes_count > 0 && (
                              <span className="text-blue-400">~{job.changes_count} changes</span>
                            )}
                          </div>
                          {job.error && (
                            <p className="text-xs text-red-400 mt-1 truncate">{job.error}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground hidden sm:block">
                          {new Date(job.created_at).toLocaleString()}
                        </span>
                        <Button variant="outline" size="sm" onClick={() => handleRefreshJob(job.id)} disabled={job.status === "running"}>
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedJob(job)}>
                          <Settings className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    
                    {/* Expandable details */}
                    {selectedJob?.id === job.id && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        <div className="grid gap-4 md:grid-cols-3">
                          <div>
                            <p className="text-xs text-muted-foreground">Job ID</p>
                            <p className="font-mono text-sm">{job.id}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Programme</p>
                            <p className="font-mono text-sm">{job.programme_id}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Created</p>
                            <p className="text-sm">{new Date(job.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                        
                        {job.params && Object.keys(job.params).length > 0 && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Parameters</p>
                            <pre className="text-xs bg-surface-2 p-3 rounded max-h-40 overflow-auto">{JSON.stringify(job.params, null, 2)}</pre>
                          </div>
                        )}
                        
                        {job.result && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">Result Summary</p>
                            <pre className="text-xs bg-surface-2 p-3 rounded max-h-60 overflow-auto">{JSON.stringify(job.result, null, 2)}</pre>
                          </div>
                        )}
                        
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setSelectedJob(null)}>Close</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {loading && jobs.length === 0 && (
            <div className="text-center py-8">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Loading jobs...</p>
            </div>
          )}

          {/* Pagination */}
          {jobs.length === pageSize && (
            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Showing {page * pageSize + 1} - {(page + 1) * pageSize}
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
        </div>
      </Card>

      {/* Create Job Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">New Enrichment Job</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowCreate(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <form onSubmit={handleCreateJob} className="p-4 space-y-4">
              <div>
                <Label>Target</Label>
                <Input value={newJob.target} onChange={(e) => setNewJob({...newJob, target: e.target.value})} placeholder="example.com or 1.2.3.4 or ACME Corp" required />
              </div>
              <div>
                <Label>Target Type</Label>
                <Select value={newJob.target_type} onValueChange={(v) => setNewJob({...newJob, target_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TARGET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sources</Label>
                <div className="flex flex-wrap gap-2">
                  {SOURCES.map((source) => (
                    <label key={source.value} className="flex items-center gap-2 px-3 py-2 rounded border border-border/50 cursor-pointer hover:bg-surface-2 transition-colors">
                      <input
                        type="checkbox"
                        checked={newJob.sources.includes(source.value)}
                        onChange={(e) => setNewJob({...newJob, sources: e.target.checked ? [...newJob.sources, source.value] : newJob.sources.filter((s) => s !== source.value)})}
                        className="rounded"
                      />
                      <div className="flex items-center gap-2">
                        <source.icon className="h-4 w-4" />
                        <span className="text-sm">{source.label}</span>
                        {source.requiresKey && <span className="text-xs text-amber-400">(needs key)</span>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label>Parameters (JSON, optional)</Label>
                <Textarea
                  value={JSON.stringify(newJob.params, null, 2)}
                  onChange={(e) => {
                    try {
                      setNewJob({...newJob, params: JSON.parse(e.target.value)});
                    } catch {}
                  }}
                  placeholder='{"max_results": 100, "depth": 2}'
                  rows={4}
                  className="font-mono text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={!newJob.target.trim() || newJob.sources.length === 0}>Create Job</Button>
              </div>
              </form>
          </Card>
        </div>
      )}
    </div>
  );
}