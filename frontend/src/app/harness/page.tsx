"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SlidersHorizontal,
  Save,
  Brain,
  Wrench,
  FileCode,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from "lucide-react";
import { Card, PageHeader, formatDate } from "@/components/ui";

interface Phase {
  key: string;
  name: string;
  template_key: string;
  role: string;
  enabled: boolean;
  default_tools: string[];
  output: string;
  min_score?: number;
}

interface HarnessConfig {
  version: number;
  phases: Phase[];
  settings: Record<string, unknown>;
}

interface Template {
  key: string;
  name: string;
  content: string;
  updated_at: string;
}

interface ToolServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  online: boolean;
  error: string | null;
  tools: { name: string; description: string }[];
}

interface LearningRun {
  id: string;
  status: string;
  outcomes_seen: number;
  new_version: number | null;
  started_at: string;
  provider_name: string | null;
  log_preview: string;
}

export default function HarnessPage() {
  const [config, setConfig] = useState<HarnessConfig | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [servers, setServers] = useState<ToolServer[]>([]);
  const [runs, setRuns] = useState<LearningRun[]>([]);
  const [strategy, setStrategy] = useState<{ version: number; meta_reasoning: string } | null>(null);
  const [providers, setProviders] = useState<{ id: string; name: string; models: { model_id: string }[] }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null);
  const [editingTpl, setEditingTpl] = useState<string | null>(null);
  const [tplDraft, setTplDraft] = useState("");
  const [learnProvider, setLearnProvider] = useState("");

  const flash = (msg: string, ok = true) => {
    setNotice({ msg, ok });
    setTimeout(() => setNotice(null), 6000);
  };

  const load = useCallback(async () => {
    const [h, t, s, l, p] = await Promise.all([
      fetch("/api/harness").then((r) => r.json()),
      fetch("/api/prompts").then((r) => r.json()),
      fetch("/api/tools").then((r) => r.json()),
      fetch("/api/learning").then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
    ]);
    setConfig(h.config);
    setTemplates(t.templates || []);
    setServers(s.servers || []);
    setRuns(l.runs || []);
    setStrategy(l.strategy);
    setProviders(p.providers || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setBusy("save");
    const res = await fetch("/api/harness", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phases: config.phases, settings: config.settings }),
    });
    setBusy(null);
    if (!res.ok) return flash("Failed to save pipeline", false);
    const data = await res.json();
    flash(`Pipeline saved as v${data.config.version} (now active)`);
    await load();
  };

  const patchPhase = (i: number, patch: Partial<Phase>) => {
    if (!config) return;
    const phases = config.phases.map((p, idx) => (idx === i ? { ...p, ...patch } : p));
    setConfig({ ...config, phases });
  };

  const saveTemplate = async (key: string) => {
    setBusy(`tpl-${key}`);
    const res = await fetch("/api/prompts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, content: tplDraft }),
    });
    setBusy(null);
    if (!res.ok) return flash("Failed to save template", false);
    flash(`Template "${key}" saved`);
    setEditingTpl(null);
    await load();
  };

  const toggleServer = async (s: ToolServer) => {
    await fetch("/api/tools", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: s.id, enabled: !s.enabled }),
    });
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Harness"
        description="Customize the pipeline: phases, prompts, tools and the self-learning brain. Everything here is editable."
        icon={SlidersHorizontal}
      />

      {notice && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${notice.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
          {notice.msg}
        </div>
      )}

      {/* ── Pipeline phases ── */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Play className="h-4 w-4" /> Pipeline phases {config && <span className="text-xs text-muted-foreground">v{config.version}</span>}
          </h2>
          <button
            onClick={saveConfig}
            disabled={busy === "save"}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save pipeline
          </button>
        </div>
        {config && (
          <div className="space-y-3">
            {config.phases.map((ph, i) => (
              <div key={ph.key} className="rounded-lg border border-border bg-surface-1 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => patchPhase(i, { enabled: !ph.enabled })}>
                    {ph.enabled ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}
                  </button>
                  <span className="font-medium text-foreground">{ph.name}</span>
                  <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">role: {ph.role}</span>
                  <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">→ {ph.output}</span>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-muted-foreground">Tools (comma-separated)</label>
                    <input
                      value={(ph.default_tools || []).join(", ")}
                      onChange={(e) =>
                        patchPhase(i, { default_tools: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
                      }
                      className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent"
                    />
                  </div>
                  {ph.output === "exploit_attempts" && (
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">Min triage score to attempt</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        value={ph.min_score ?? 0.4}
                        onChange={(e) => patchPhase(i, { min_score: parseFloat(e.target.value) || 0 })}
                        className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Prompt templates ── */}
      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileCode className="h-4 w-4" /> Prompt templates
          <span className="text-xs font-normal text-muted-foreground">— variables: {"{{scope}} {{programme}} {{findings}} {{tool_hint}}"}</span>
        </h2>
        <div className="space-y-3">
          {templates.map((t) => (
            <div key={t.key} className="rounded-lg border border-border bg-surface-1 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">
                  {t.name} <span className="ml-2 font-mono text-xs text-muted-foreground">{t.key}</span>
                </span>
                {editingTpl === t.key ? (
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveTemplate(t.key)}
                      disabled={busy === `tpl-${t.key}`}
                      className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {busy === `tpl-${t.key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                    </button>
                    <button onClick={() => setEditingTpl(null)} className="rounded border border-border px-3 py-1 text-xs text-muted-foreground">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingTpl(t.key);
                      setTplDraft(t.content);
                    }}
                    className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-surface-2"
                  >
                    Edit
                  </button>
                )}
              </div>
              {editingTpl === t.key ? (
                <textarea
                  value={tplDraft}
                  onChange={(e) => setTplDraft(e.target.value)}
                  rows={10}
                  className="w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-foreground outline-none focus:border-accent"
                />
              ) : (
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{t.content}</pre>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Tool servers ── */}
      <Card className="p-5">
        <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wrench className="h-4 w-4" /> Tool servers
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {servers.map((s) => (
            <div key={s.id} className="rounded-lg border border-border bg-surface-1 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">{s.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`flex items-center gap-1 text-xs ${s.online ? "text-emerald-400" : "text-red-400"}`}>
                    {s.online ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {s.online ? "online" : "offline"}
                  </span>
                  <button onClick={() => toggleServer(s)} title={s.enabled ? "Disable" : "Enable"}>
                    <RefreshCw className={`h-3.5 w-3.5 ${s.enabled ? "text-emerald-400" : "text-muted-foreground"}`} />
                  </button>
                </div>
              </div>
              <div className="mb-2 text-xs text-muted-foreground">{s.url}</div>
              <div className="flex flex-wrap gap-1">
                {s.tools.map((t) => (
                  <span key={t.name} title={t.description} className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-foreground">
                    {t.name}
                  </span>
                ))}
                {s.tools.length === 0 && <span className="text-xs text-muted-foreground">{s.error || "no tools"}</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Self-learning ── */}
      <Card className="p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-foreground">
          <Brain className="h-4 w-4" /> Self-learning engine
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          The Meta-Agent analyses outcomes and rewrites the strategy (triage weights, exploit priority, FP suppression).
          Runs on any connected model — including local ones.
          {strategy && <span className="ml-1">Current strategy: v{strategy.version}.</span>}
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={learnProvider}
            onChange={(e) => {
              setLearnProvider(e.target.value);
            }}
            className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground outline-none"
          >
            <option value="">Learning model: default (.env)</option>
            {providers.map((p) =>
              p.models.map((m) => (
                <option key={`${p.id}-${m.model_id}`} value={`${p.id}|${m.model_id}`}>
                  {p.name} / {m.model_id}
                </option>
              ))
            )}
          </select>
          <button
            onClick={() => {
              const [pid, mid] = learnProvider.split("|");
              runLearningWith(pid || "", mid || "");
            }}
            disabled={busy === "learn"}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy === "learn" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
            Run learning cycle
          </button>
        </div>
        <div className="space-y-2">
          {runs.length === 0 && <p className="text-xs text-muted-foreground">No learning cycles run yet.</p>}
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-border bg-surface-1 px-4 py-2 text-xs">
              <div className="flex items-center gap-3">
                {r.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : r.status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-red-400" />
                )}
                <span className="text-foreground">{formatDate(r.started_at)}</span>
                <span className="text-muted-foreground">{r.provider_name || "env default"}</span>
                {r.new_version && <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] text-emerald-300">strategy v{r.new_version}</span>}
              </div>
              {r.status === "failed" && r.log_preview && (
                <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap text-[10px] text-red-300">{r.log_preview.slice(-300)}</pre>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );

  function runLearningWith(pid: string, mid: string) {
    setBusy("learn");
    fetch("/api/learning", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: pid || undefined, model: mid || undefined, days: 7 }),
    })
      .then(async (res) => {
        const data = await res.json();
        setBusy(null);
        if (!res.ok) return flash(data.error || "Failed to start learning cycle", false);
        flash("Learning cycle started — the Meta-Agent is analysing outcomes…");
        setTimeout(load, 4000);
      })
      .catch(() => setBusy(null));
  }
}
