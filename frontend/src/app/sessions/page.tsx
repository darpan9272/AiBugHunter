"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TerminalSquare, Plus, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Card, PageHeader, formatDate } from "@/components/ui";

interface Session {
  id: string;
  title: string;
  programme_name: string | null;
  provider_name: string | null;
  model_id: string | null;
  mode: string;
  context_tokens: number;
  event_count: number;
  pending_approvals: number;
  updated_at: string;
}

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  models: { model_id: string; enabled: boolean }[];
}

interface Programme {
  id: string;
  name: string;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ providerId: "", modelId: "", programmeId: "", title: "" });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [s, p, pr] = await Promise.all([
      fetch("/api/sessions").then((r) => r.json()),
      fetch("/api/providers").then((r) => r.json()),
      fetch("/api/programmes").then((r) => r.json()),
    ]);
    setSessions(s.sessions || []);
    setProviders(p.providers || []);
    setProgrammes(pr.programmes || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const selectedProvider = providers.find((p) => p.id === form.providerId);

  const createSession = async () => {
    if (!form.providerId || !form.modelId) {
      setError("Pick a provider and model (connect one in Connect AI first).");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Failed to create session");
      return;
    }
    window.location.href = `/sessions/${data.session.id}`;
  };

  const archive = async (id: string) => {
    if (!confirm("Archive this engagement?")) return;
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engagements"
        description="Interactive pentest sessions — a durable workspace with full toolset, approvals and replay."
        icon={TerminalSquare}
        actions={
          <button
            onClick={() => setShowNew(!showNew)}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New engagement
          </button>
        }
      />

      {showNew && (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-semibold text-foreground">Start a new engagement</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              placeholder="Title (e.g. Box BB — API deep dive)"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent md:col-span-2"
            />
            <select
              value={form.programmeId}
              onChange={(e) => setForm({ ...form, programmeId: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">No programme (scope-free lab)</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={form.providerId}
              onChange={(e) => setForm({ ...form, providerId: e.target.value, modelId: "" })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">Select provider…</option>
              {providers.filter((p) => p.enabled).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none md:col-span-2"
            >
              <option value="">Select model…</option>
              {(selectedProvider?.models || []).map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_id} {m.enabled ? "✓" : "(disabled in Connect AI)"}
                </option>
              ))}
            </select>
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <button
            onClick={createSession}
            disabled={busy}
            className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Enter Pentest Mode
          </button>
        </Card>
      )}

      {loading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : sessions.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No engagements yet. Start one above — pick a programme for scope-bound testing, or run scope-free for labs/CTFs.
        </Card>
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <Card key={s.id} className="flex items-center justify-between p-4">
              <Link href={`/sessions/${s.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-foreground">{s.title}</span>
                  {s.pending_approvals > 0 && (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      {s.pending_approvals} awaiting approval
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{s.programme_name || "no programme"}</span>
                  <span>{s.provider_name} / {s.model_id}</span>
                  <span>{s.event_count} events</span>
                  <span>~{Math.round(s.context_tokens / 1000)}k ctx tokens</span>
                  <span>{formatDate(s.updated_at)}</span>
                </div>
              </Link>
              <button onClick={() => archive(s.id)} className="ml-3 rounded-lg border border-border p-2 text-red-400 hover:bg-red-500/10">
                <Trash2 className="h-4 w-4" />
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
