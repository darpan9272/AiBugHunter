"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  Send,
  Loader2,
  ShieldAlert,
  Check,
  X,
  Wrench,
  Target,
  User,
  Bot,
  Info,
  Gauge,
} from "lucide-react";
import { Card } from "@/components/ui";

interface EventRow {
  id: number;
  seq: number;
  role: string;
  content: string;
  meta: Record<string, unknown>;
  created_at: string;
}

interface Goal {
  id: string;
  text: string;
  status: string;
}

interface Approval {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

interface SessionData {
  session: {
    id: string;
    title: string;
    programme_name: string | null;
    provider_name: string | null;
    model_id: string | null;
    mode: string;
    context_tokens: number;
  };
  events: EventRow[];
  goals: Goal[];
  pendingApprovals: Approval[];
}

export default function SessionWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<SessionData | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sessions/${id}`);
    if (res.ok) setData(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // poll while agent is working or approvals pending
  useEffect(() => {
    const t = setInterval(() => {
      if (busy) load();
    }, 1500);
    return () => clearInterval(t);
  }, [busy, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.events.length]);

  const send = async () => {
    if (!input.trim() || busy) return;
    const msg = input.trim();
    setInput("");
    setBusy(true);
    // optimistic append
    setData((d) =>
      d
        ? {
            ...d,
            events: [
              ...d.events,
              { id: -1, seq: d.events.length + 1, role: "user", content: msg, meta: {}, created_at: new Date().toISOString() },
            ],
          }
        : d
    );
    const res = await fetch(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg }),
    });
    const out = await res.json();
    if (!res.ok) alert(out.error || "Failed to send");
    await load();
    if (out.status !== "awaiting_approval") setBusy(false);
    else setBusy(false);
  };

  const decide = async (approvalId: string, decision: "approve" | "deny") => {
    setApproving(approvalId + decision);
    await fetch(`/api/sessions/${id}/approvals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, decision }),
    });
    setApproving(null);
    await load();
  };

  if (!data) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const { session, events, goals, pendingApprovals } = data;

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* ── Main chat column ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h1 className="text-lg font-bold text-foreground">{session.title}</h1>
          <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">{session.mode} mode</span>
          {session.programme_name && (
            <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">scope: {session.programme_name}</span>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> ~{Math.round(session.context_tokens / 1000)}k tokens
          </span>
          <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {session.provider_name}/{session.model_id}
          </span>
        </div>

        {/* Approval banner */}
        {pendingApprovals.map((a) => (
          <div key={a.id} className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
              <ShieldAlert className="h-4 w-4" /> Operator approval required
            </div>
            <pre className="mb-3 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs text-foreground">
              {a.tool}({JSON.stringify(a.args, null, 1).slice(0, 600)})
            </pre>
            <div className="flex gap-2">
              <button
                onClick={() => decide(a.id, "approve")}
                disabled={approving !== null}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {approving === a.id + "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Approve & run
              </button>
              <button
                onClick={() => decide(a.id, "deny")}
                disabled={approving !== null}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/50 px-4 py-1.5 text-sm font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                {approving === a.id + "deny" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Deny
              </button>
            </div>
          </div>
        ))}

        {/* Event stream */}
        <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-surface-1 p-4">
          {events.map((e) => (
            <EventBubble key={e.id} e={e} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> agent working…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="mt-3 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Direct the engagement… (Enter to send, Shift+Enter for newline)"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="flex items-center gap-2 rounded-lg bg-accent px-5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* ── Goals sidebar ── */}
      <div className="hidden w-64 shrink-0 lg:block">
        <Card className="p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Target className="h-4 w-4" /> Objectives
          </h2>
          {goals.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No objectives yet — the agent tracks them with goal tools as the engagement progresses.
            </p>
          ) : (
            <ul className="space-y-2">
              {goals.map((g) => (
                <li key={g.id} className="flex items-start gap-2 text-xs">
                  <span
                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                      g.status === "done"
                        ? "bg-emerald-400"
                        : g.status === "in_progress"
                        ? "bg-sky-400"
                        : g.status === "dropped"
                        ? "bg-red-400"
                        : "bg-muted-foreground"
                    }`}
                  />
                  <span className={g.status === "done" ? "text-muted-foreground line-through" : "text-foreground"}>{g.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function EventBubble({ e }: { e: EventRow }) {
  if (e.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-xl rounded-br-sm bg-accent/15 px-4 py-2 text-sm text-foreground">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-accent"><User className="h-3 w-3" /> operator</div>
          <div className="whitespace-pre-wrap">{e.content}</div>
        </div>
      </div>
    );
  }
  if (e.role === "assistant") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-xl rounded-bl-sm border border-border bg-surface-2 px-4 py-2 text-sm text-foreground">
          <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-muted-foreground">
            <Bot className="h-3 w-3" /> pentest mode
            {typeof e.meta?.prompt_tokens === "number" && (
              <span className="ml-2 normal-case">· {String(Math.round(Number(e.meta.prompt_tokens) / 1000))}k ctx</span>
            )}
          </div>
          <div className="whitespace-pre-wrap">{e.content}</div>
        </div>
      </div>
    );
  }
  if (e.role === "tool_call" || e.role === "tool_result") {
    const isCall = e.role === "tool_call";
    const tool = (e.meta?.tool as string) || "";
    return (
      <div className="ml-4 rounded-lg border border-border/60 bg-black/20 px-3 py-2 font-mono text-xs">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase text-muted-foreground">
          <Wrench className="h-3 w-3" />
          {isCall ? "tool call" : `tool result${tool ? ` · ${tool}` : ""}`}
          {e.meta?.denied === true && <span className="text-red-400">· DENIED</span>}
          {e.meta?.approved === true && <span className="text-emerald-400">· approved</span>}
          {e.meta?.ok === false && <span className="text-red-400">· error</span>}
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">{e.content.slice(0, 3000)}</pre>
      </div>
    );
  }
  // system / approval_request
  return (
    <div className="flex items-start gap-2 px-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="whitespace-pre-wrap">{e.content}</span>
    </div>
  );
}
