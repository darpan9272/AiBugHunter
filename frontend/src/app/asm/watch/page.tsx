"use client";

import { useEffect, useState } from "react";
import { Plus, Bell, BellOff, Edit, Trash2, Play, Pause, Loader2, Globe, Database, FileKey2, BookUser, Search, Zap, Mail, MessageSquare, AlertTriangle, Send, TestTube } from "lucide-react";
import { Card, PageHeader, Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Label } from "@/components/ui";

interface WatchRule {
  id: string;
  name: string;
  query: string;
  asset_type: string;
  programme_id: string | null;
  webhook: string | null;
  enabled: boolean;
  seen_keys: string[];
  last_match_at: string | null;
  created_at: string;
  programme_name?: string;
}

interface AlertChannel {
  id: string;
  name: string;
  type: string;
  config: Record<string, any>;
  enabled: boolean;
  description: string | null;
}

const ASSET_TYPES = [
  { value: "hosts", label: "Hosts", icon: Globe },
  { value: "dns", label: "DNS", icon: Database },
  { value: "certs", label: "Certificates", icon: FileKey2 },
  { value: "whois", label: "WHOIS", icon: BookUser },
];

const CHANNEL_TYPES = [
  { value: "email", label: "Email", icon: Mail },
  { value: "slack", label: "Slack", icon: MessageSquare },
  { value: "discord", label: "Discord", icon: Zap },
  { value: "pagerduty", label: "PagerDuty", icon: AlertTriangle },
  { type: "opsgenie", label: "OpsGenie", icon: AlertTriangle },
  { type: "teams", label: "Microsoft Teams", icon: Send },
  { type: "webhook", label: "Custom Webhook", icon: TestTube },
];

export default function ASMWatchPage() {
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [rules, setRules] = useState<WatchRule[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreateRule, setShowCreateRule] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [editingRule, setEditingRule] = useState<WatchRule | null>(null);
  const [newRule, setNewRule] = useState({ name: "", query: "", asset_type: "hosts", programme_id: "", channels: [] as string[] });
  const [newChannel, setNewChannel] = useState({ name: "", type: "slack", config: {} as Record<string, any>, description: "" });
  const [testingChannel, setTestingChannel] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/programmes")
      .then((r) => r.json())
      .then((d) => setProgrammes(d.programmes || []));
  }, []);

  const fetchData = async () => {
    if (!programmeId) return;
    setLoading(true);
    try {
      const [rulesRes, channelsRes] = await Promise.all([
        fetch("/api/watch"),
        fetch("/api/asm/alert-channels"),
      ]);
      const rulesData = await rulesRes.json();
      const channelsData = await channelsRes.json();
      if (rulesRes.ok) setRules(rulesData.rules || []);
      if (channelsRes.ok) setChannels(channelsData.channels || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [programmeId]);

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newRule.name,
          query: newRule.query,
          asset_type: newRule.asset_type,
          programmeId: newRule.programme_id || programmeId || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create rule");
      
      // Link channels
      const rule = await res.json();
      if (newRule.channels.length > 0) {
        for (const chId of newRule.channels) {
          await fetch("/api/watch", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ruleId: rule.rule.id, channelId: chId }),
          });
        }
      }
      
      setShowCreateRule(false);
      setNewRule({ name: "", query: "", asset_type: "hosts", programme_id: "", channels: [] });
      fetchData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleToggleRule = async (rule: WatchRule) => {
    try {
      const res = await fetch("/api/watch", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }),
      });
      if (res.ok) fetchData();
    } catch (e) { console.error(e); }
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Delete this watch rule?")) return;
    try {
      await fetch("/api/watch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleRunCheck = async () => {
    try {
      const res = await fetch("/api/watch/check", { method: "POST" });
      const data = await res.json();
      alert(`Checked ${data.checked} rules. ${data.results.filter((r: any) => r.new_matches > 0).length} rules had new matches.`);
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/asm/alert-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newChannel),
      });
      if (!res.ok) throw new Error("Failed to create channel");
      setShowCreateChannel(false);
      setNewChannel({ name: "", type: "slack", config: {}, description: "" });
      fetchData();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleTestChannel = async (channelId: string) => {
    setTestingChannel(channelId);
    try {
      const res = await fetch("/api/asm/alert-channels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      const data = await res.json();
      alert(data.sent ? "Test sent successfully!" : `Test failed: ${data.note || data.error}`);
    } catch (e: any) {
      alert(`Test failed: ${e.message}`);
    } finally {
      setTestingChannel(null);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    if (!confirm("Delete this alert channel?")) return;
    try {
      await fetch(`/api/asm/alert-channels?id=${id}`, { method: "DELETE" });
      fetchData();
    } catch (e) { console.error(e); }
  };

  const getAssetTypeIcon = (type: string) => {
    const t = ASSET_TYPES.find((a) => a.value === type);
    return t ? <t.icon className="h-4 w-4" /> : <Search className="h-4 w-4" />;
  };

  const getChannelIcon = (type: string) => {
    const t = CHANNEL_TYPES.find((c) => c.value === type || c.type === type);
    return t ? <t.icon className="h-4 w-4" /> : <Bell className="h-4 w-4" />;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Watch Rules & Alerting"
        description="Continuous monitoring with real-time alerts — know the moment new assets match your criteria."
        icon={Bell}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={programmeId}
              onChange={(e) => setProgrammeId(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none"
              disabled={loading}
            >
              <option value="">All programmes</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <Button onClick={handleRunCheck} disabled={loading}>
              <Play className="h-4 w-4 mr-1" /> Run Check Now
            </Button>
            <Button variant="outline" onClick={() => setShowCreateChannel(true)}>
              <MessageSquare className="h-4 w-4 mr-1" /> Alert Channels
            </Button>
            <Button onClick={() => setShowCreateRule(true)}>
              <Plus className="h-4 w-4 mr-1" /> Create Rule
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Alert Channels Section */}
      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold">
            <MessageSquare className="h-5 w-5" /> Alert Channels
          </h3>
          <Button variant="outline" size="sm" onClick={() => setShowCreateChannel(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Channel
          </Button>
        </div>
        <div className="p-4">
          {channels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BellOff className="mx-auto h-12 w-12 mb-4 text-muted-foreground/50" />
              <p>No alert channels configured. Create one to receive notifications.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {channels.map((ch) => (
                <div key={ch.id} className="p-4 rounded border border-border/50 hover:border-accent/50 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                        {getChannelIcon(ch.type)}
                      </div>
                      <div>
                        <p className="font-medium">{ch.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{ch.type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleTestChannel(ch.id)}
                        disabled={testingChannel === ch.id}
                        title="Test"
                      >
                        {testingChannel === ch.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteChannel(ch.id)} title="Delete">
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    {ch.description && <p>{ch.description}</p>}
                    <p className="font-mono text-xs">
                      {ch.type === "webhook" && ch.config.url ? `POST ${ch.config.url}` :
                       ch.type === "email" && ch.config.recipients ? ch.config.recipients.join(", ") :
                       ch.config.webhook_url ? ch.config.webhook_url.slice(0, 50) + "..." : "Configured"}
                    </p>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${ch.enabled ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      {ch.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Watch Rules Section */}
      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold">
            <Bell className="h-5 w-5" /> Watch Rules
          </h3>
          <Button onClick={() => setShowCreateRule(true)}>
            <Plus className="h-4 w-4 mr-1" /> Create Rule
          </Button>
        </div>
        <div className="p-4">
          {rules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="mx-auto h-12 w-12 mb-4 text-muted-foreground/50" />
              <p>No watch rules yet. Create one to start monitoring.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {rules.map((rule) => (
                <div key={rule.id} className="p-4 rounded border border-border/50 hover:border-accent/50 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h4 className="font-medium">{rule.name}</h4>
                        <span className={`px-2 py-0.5 rounded text-xs ${rule.enabled ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                          {rule.enabled ? "Active" : "Paused"}
                        </span>
                        {rule.programme_name && (
                          <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400">{rule.programme_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                        <span>{getAssetTypeIcon(rule.asset_type)} {rule.asset_type}</span>
                        <span>•</span>
                        <span className="font-mono text-xs bg-surface-2 px-2 py-0.5 rounded truncate max-w-[300px]">{rule.query}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {rule.last_match_at && (
                          <span>Last match: {new Date(rule.last_match_at).toLocaleString()}</span>
                        )}
                        <span>Seen keys: {rule.seen_keys?.length || 0}</span>
                        <span>Created: {new Date(rule.created_at).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={rule.enabled ? "outline" : "default"}
                        size="sm"
                        onClick={() => handleToggleRule(rule)}
                      >
                        {rule.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setEditingRule(rule)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteRule(rule.id)}>
                        <Trash2 className="h-4 w-4 text-red-400" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Create Rule Modal */}
      {showCreateRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Create Watch Rule</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowCreateRule(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <form onSubmit={handleCreateRule} className="p-4 space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={newRule.name} onChange={(e) => setNewRule({...newRule, name: e.target.value})} placeholder="New admin panels" required />
              </div>
              <div>
                <Label>Query (Profundis syntax)</Label>
                <Input value={newRule.query} onChange={(e) => setNewRule({...newRule, query: e.target.value})} placeholder="technology:nginx port:443 status:200" required />
                <p className="text-xs text-muted-foreground mt-1">Examples: host:*.example.com, tech:react, cert.issuer:"Let's Encrypt", dns.type:MX</p>
              </div>
              <div>
                <Label>Asset Type</Label>
                <Select value={newRule.asset_type} onValueChange={(v) => setNewRule({...newRule, asset_type: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ASSET_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Programme (optional)</Label>
                <Select value={newRule.programme_id} onValueChange={(v) => setNewRule({...newRule, programme_id: v})}>
                  <SelectTrigger><SelectValue placeholder="All programmes" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All programmes</SelectItem>
                    {programmes.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alert Channels</Label>
                <div className="flex flex-wrap gap-2">
                  {channels.filter(c => c.enabled).map((ch) => (
                    <label key={ch.id} className="flex items-center gap-2 px-3 py-1 rounded border border-border/50 cursor-pointer hover:bg-surface-2">
                      <input
                        type="checkbox"
                        checked={newRule.channels.includes(ch.id)}
                        onChange={(e) => setNewRule({...newRule, channels: e.target.checked ? [...newRule.channels, ch.id] : newRule.channels.filter((c) => c !== ch.id)})}
                        className="rounded"
                      />
                      <span className="text-sm">{ch.name} ({ch.type})</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => setShowCreateRule(false)}>Cancel</Button>
                <Button type="submit" disabled={!newRule.name || !newRule.query}>{newRule.name ? "Create Rule" : "Creating..."}</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Create Channel Modal */}
      {showCreateChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Create Alert Channel</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowCreateChannel(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <form onSubmit={handleCreateChannel} className="p-4 space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={newChannel.name} onChange={(e) => setNewChannel({...newChannel, name: e.target.value})} placeholder="Security Team Slack" required />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={newChannel.type} onValueChange={(v) => setNewChannel({...newChannel, type: v, config: {}})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHANNEL_TYPES.map((t) => <SelectItem key={t.value || t.type} value={t.value || t.type}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={newChannel.description} onChange={(e) => setNewChannel({...newChannel, description: e.target.value})} placeholder="Channel description" />
              </div>
              <div>
                <Label>Configuration</Label>
                <div className="space-y-2">
                  {newChannel.type === "slack" && (
                    <>
                      <Input placeholder="Webhook URL" value={newChannel.config.webhook_url || ""} onChange={(e) => setNewChannel({...newChannel, config: {...newChannel.config, webhook_url: e.target.value}})} required />
                      <Input placeholder="Template (optional)" value={newChannel.config.template || ""} onChange={(e) => setNewChannel({...newChannel, config: {...newChannel.config, template: e.target.value}})} />
                    </>
                  )}
                  {newChannel.type === "discord" && (
                    <Input placeholder="Webhook URL" value={newChannel.config.webhook_url || ""} onChange={(e) => setNewChannel({...newChannel, config: {...newChannel.config, webhook_url: e.target.value}})} required />
                  )}
                  {newChannel.type === "email" && (
                    <Input placeholder="Recipients (comma-separated)" value={newChannel.config.recipients?.join(", ") || ""} onChange={(e) => setNewChannel({...newChannel, config: {...newChannel.config, recipients: e.target.value.split(",").map(s => s.trim())}})} required />
                  )}
                  {newChannel.type === "pagerduty" && (
                    <>
                      <Input placeholder="Service Key" value={newChannel.config.service_key || ""} onChange={(e) => setNewChannel({...newChannel, config: {...newChannel.config, service_key: e.target.value}})} required />
                      <Select value={newChannel.config.severity || "critical"} onValueChange={(v) => setNewChannel({...newChannel, config: {...newChannel.config, severity: v}})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="critical">Critical</SelectItem>
                          <SelectItem value="error">Error</SelectItem>
                          <SelectItem value="warning">Warning</SelectItem>
                          <SelectItem value="info">Info</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {newChannel.type === "webhook" && (
                    <>
                      <Input placeholder="Webhook URL" value={newChannel.config.url || ""} onChange={(e) => setNewChannel({...newChannel, config: {...newChannel.config, url: e.target.value}})} required />
                      <Select value={newChannel.config.method || "POST"} onValueChange={(v) => setNewChannel({...newChannel, config: {...newChannel.config, method: v}})}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="POST">POST</SelectItem>
                          <SelectItem value="PUT">PUT</SelectItem>
                        </SelectContent>
                      </Select>
                    </>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" type="button" onClick={() => setShowCreateChannel(false)}>Cancel</Button>
                <Button type="submit" disabled={!newChannel.name}>Create Channel</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit Rule Modal */}
      {editingRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-auto">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="font-semibold">Edit Watch Rule</h3>
              <Button variant="ghost" size="icon" onClick={() => setEditingRule(null)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-sm text-muted-foreground">Edit functionality coming soon. For now, delete and recreate.</p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingRule(null)}>Close</Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}