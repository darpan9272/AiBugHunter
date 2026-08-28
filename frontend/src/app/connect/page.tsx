"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Zap,
  Home,
  Cloud,
  KeyRound,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui";

interface Preset {
  id: string;
  name: string;
  kind: string;
  base_url: string;
  is_local: boolean;
  needs_key: boolean;
  hint: string;
}

interface Model {
  id: string;
  model_id: string;
  enabled: boolean;
  role: string;
  nickname: string | null;
}

interface Provider {
  id: string;
  name: string;
  kind: string;
  base_url: string | null;
  is_local: boolean;
  enabled: boolean;
  has_key: boolean;
  models: Model[];
}

const ROLES = ["general", "recon", "triage", "exploit", "report", "meta"];

export default function ConnectPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; ok: boolean } | null>(null);

  // add-provider form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "openai-compatible", base_url: "", api_key: "", is_local: false });

  const flash = (msg: string, ok = true) => {
    setNotice({ msg, ok });
    setTimeout(() => setNotice(null), 5000);
  };

  const load = useCallback(async () => {
    const [p, pr] = await Promise.all([
      fetch("/api/providers/presets").then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
    ]);
    setPresets(p.presets || []);
    setProviders(pr.providers || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (p: Preset) => {
    setForm({ name: p.name, kind: p.kind, base_url: p.base_url, api_key: "", is_local: p.is_local });
    setShowForm(true);
  };

  const addProvider = async () => {
    if (!form.name) return flash("Give the connection a name", false);
    setBusy("add");
    const res = await fetch("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return flash(data.error || "Failed to add provider", false);
    flash(`Connected "${form.name}" — discovering models…`);
    setShowForm(false);
    await discover(data.provider.id);
    await load();
  };

  const discover = async (id: string) => {
    setBusy(`discover-${id}`);
    const res = await fetch(`/api/providers/${id}/discover`, { method: "POST" });
    const data = await res.json();
    setBusy(null);
    if (!res.ok) return flash(data.error || "Discovery failed", false);
    flash(`Found ${data.discovered} models (${data.added} new)${data.warning ? ` — ${data.warning}` : ""}`);
    await load();
  };

  const testModel = async (id: string, model: string) => {
    setBusy(`test-${id}-${model}`);
    const res = await fetch(`/api/providers/${id}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const data = await res.json();
    setBusy(null);
    if (data.success) flash(`✓ ${model} responded in ${data.latencyMs}ms: "${(data.response || "").trim()}"`);
    else flash(`✗ ${model}: ${data.error}`, false);
  };

  const toggleModel = async (providerId: string, m: Model, patch: Record<string, unknown>) => {
    await fetch(`/api/providers/${providerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model_pk: m.id, ...patch }),
    });
    await load();
  };

  const removeProvider = async (id: string, name: string) => {
    if (!confirm(`Disconnect "${name}" and remove its models?`)) return;
    await fetch(`/api/providers/${id}`, { method: "DELETE" });
    flash(`Disconnected ${name}`);
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connect AI"
        description="Plug in any AI — cloud APIs or fully local models. Discover models, assign roles, and the harness uses them automatically."
        icon={Plug}
      />

      {notice && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            notice.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"
          }`}
        >
          {notice.msg}
        </div>
      )}

      {/* Presets */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Quick connectors</h2>
          <button
            onClick={() => {
              setForm({ name: "", kind: "openai-compatible", base_url: "", api_key: "", is_local: false });
              setShowForm(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Custom
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className="group rounded-xl border border-border bg-surface-1 p-3 text-left transition hover:border-accent/50 hover:bg-surface-2"
            >
              <div className="mb-1 flex items-center gap-2">
                {p.is_local ? (
                  <Home className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Cloud className="h-4 w-4 text-sky-400" />
                )}
                <span className="text-sm font-medium text-foreground">{p.name}</span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{p.hint}</p>
              {!p.needs_key && <span className="mt-1 inline-block text-[10px] font-semibold uppercase text-emerald-400">no key needed</span>}
            </button>
          ))}
        </div>
      </Card>

      {/* Add form */}
      {showForm && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">New connection</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              placeholder="Name (e.g. My DeepSeek)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            >
              <option value="openai-compatible">OpenAI-compatible (DeepSeek, OpenRouter, vLLM…)</option>
              <option value="ollama">Ollama (local)</option>
              <option value="anthropic">Anthropic (native)</option>
              <option value="google">Google Gemini (native)</option>
            </select>
            <input
              placeholder="Base URL (e.g. https://api.deepseek.com/v1)"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
            <input
              placeholder={form.is_local || form.kind === "ollama" ? "API key (not needed for local)" : "API key"}
              type="password"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={form.is_local || form.kind === "ollama"}
                onChange={(e) => setForm({ ...form, is_local: e.target.checked })}
              />
              Local / self-hosted (works without a key)
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={addProvider}
              disabled={busy === "add"}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Connect & discover models
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-surface-2">
              Cancel
            </button>
          </div>
        </Card>
      )}

      {/* Connected providers */}
      <div className="space-y-4">
        {loading ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : providers.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No AI connected yet. Pick a quick connector above — for fully local & private hunting, use Ollama or LM Studio.
          </Card>
        ) : (
          providers.map((p) => (
            <Card key={p.id} className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  {p.is_local ? <Home className="h-5 w-5 text-emerald-400" /> : <Cloud className="h-5 w-5 text-sky-400" />}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">{p.name}</span>
                      <span className="rounded bg-surface-2 px-2 py-0.5 text-[10px] uppercase text-muted-foreground">{p.kind}</span>
                      {p.has_key ? <KeyRound className="h-3.5 w-3.5 text-muted-foreground" /> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{p.base_url || "default endpoint"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => discover(p.id)}
                    disabled={busy === `discover-${p.id}`}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-surface-2 disabled:opacity-50"
                  >
                    {busy === `discover-${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Discover models
                  </button>
                  <button
                    onClick={() => removeProvider(p.id, p.name)}
                    className="rounded-lg border border-border p-1.5 text-red-400 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {p.models.length === 0 ? (
                <p className="text-xs text-muted-foreground">No models discovered yet — click “Discover models”.</p>
              ) : (
                <div className="space-y-2">
                  {p.models.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2">
                      <button
                        onClick={() => toggleModel(p.id, m, { enabled: !m.enabled })}
                        title={m.enabled ? "Enabled for scans" : "Disabled"}
                      >
                        {m.enabled ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <XCircle className="h-5 w-5 text-muted-foreground" />}
                      </button>
                      <span className="min-w-40 font-mono text-xs text-foreground">{m.model_id}</span>
                      <select
                        value={m.role}
                        onChange={(e) => toggleModel(p.id, m, { role: e.target.value })}
                        className="rounded border border-border bg-surface-2 px-2 py-1 text-xs text-foreground outline-none"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => testModel(p.id, m.model_id)}
                        disabled={busy === `test-${p.id}-${m.model_id}`}
                        className="ml-auto flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-surface-2 disabled:opacity-50"
                      >
                        {busy === `test-${p.id}-${m.model_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                        test
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
