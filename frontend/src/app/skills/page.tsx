"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Plus, Save, Trash2, Loader2 } from "lucide-react";
import { Card, PageHeader } from "@/components/ui";

interface Skill {
  key: string;
  name: string;
  description: string;
  content: string;
  updated_at: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState({ key: "", name: "", description: "", content: "" });
  const [isNew, setIsNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/skills").then((r) => r.json());
    setSkills(res.skills || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(""), 4000);
  };

  const open = (s: Skill) => {
    setSelected(s.key);
    setIsNew(false);
    setDraft({ key: s.key, name: s.name, description: s.description, content: s.content });
  };

  const newSkill = () => {
    setSelected(null);
    setIsNew(true);
    setDraft({ key: "", name: "", description: "", content: "# Playbook title\n\n1. Step one…" });
  };

  const save = async () => {
    setBusy(true);
    const res = await fetch("/api/skills", {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return flash(data.error || "Save failed");
    flash(`Skill "${draft.key}" saved — agents can load it with load_skill('${draft.key}')`);
    setIsNew(false);
    setSelected(draft.key);
    await load();
  };

  const remove = async (key: string) => {
    if (!confirm(`Delete skill "${key}"?`)) return;
    await fetch("/api/skills", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key }),
    });
    setSelected(null);
    await load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Skills"
        description="Loadable pentest playbooks. The agent pulls them into context on demand via load_skill()."
        icon={BookOpen}
        actions={
          <button onClick={newSkill} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            <Plus className="h-4 w-4" /> New skill
          </button>
        }
      />

      {notice && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{notice}</div>}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {skills.map((s) => (
            <button
              key={s.key}
              onClick={() => open(s)}
              className={`w-full rounded-lg border p-3 text-left transition ${
                selected === s.key ? "border-accent/60 bg-accent/10" : "border-border bg-surface-1 hover:bg-surface-2"
              }`}
            >
              <div className="text-sm font-medium text-foreground">{s.name}</div>
              <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{s.key}</div>
              <div className="mt-1 text-xs text-muted-foreground">{s.description}</div>
            </button>
          ))}
        </div>

        {(selected || isNew) && (
          <Card className="p-5">
            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <input
                placeholder="key (e.g. jwt-playbook)"
                value={draft.key}
                disabled={!isNew}
                onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-accent disabled:opacity-60"
              />
              <input
                placeholder="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
              <input
                placeholder="Short description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:border-accent"
              />
            </div>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={18}
              className="w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-foreground outline-none focus:border-accent"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={save}
                disabled={busy}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
              {!isNew && selected && (
                <button onClick={() => remove(selected)} className="flex items-center gap-2 rounded-lg border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10">
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
