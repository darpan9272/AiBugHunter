"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Settings as SettingsIcon,
  Save,
  Loader2,
  RotateCcw,
  GripVertical,
  CheckCircle2,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Sparkles,
} from "lucide-react";
import { PageHeader, Card, Skeleton, formatDate } from "@/components/ui";
import { apiService } from "@/lib/api";

const WEIGHT_FIELDS = [
  {
    key: "static",
    label: "Static Analysis",
    hint: "Pattern and heuristic matching on raw response bodies.",
  },
  {
    key: "embedding",
    label: "Embedding Similarity",
    hint: "Vector similarity against known-vulnerable signatures.",
  },
  {
    key: "llm",
    label: "LLM Analysis",
    hint: "Language-model reasoning over the finding context.",
  },
] as const;

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);
  const [reasoning, setReasoning] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Triage weights
  const [wStatic, setWStatic] = useState(0.3);
  const [wEmbedding, setWEmbedding] = useState(0.4);
  const [wLlm, setWLlm] = useState(0.3);

  // Exploit priority
  const [exploitPriority, setExploitPriority] = useState<string[]>([
    "sqli",
    "xss",
    "idor",
    "ssrf",
    "auth",
    "lfi",
    "api",
  ]);

  async function loadSettings() {
    try {
      const res = await apiService.settings.get();
      if (res.data) {
        const data = res.data;
        if (data.config) {
          const cfg =
            typeof data.config === "string"
              ? JSON.parse(data.config)
              : data.config;
          if (cfg.triage_weights) {
            setWStatic(cfg.triage_weights.static ?? 0.3);
            setWEmbedding(cfg.triage_weights.embedding ?? 0.4);
            setWLlm(cfg.triage_weights.llm ?? 0.3);
          }
          if (Array.isArray(cfg.exploit_priority)) {
            setExploitPriority(cfg.exploit_priority);
          }
        }
        if (data.version) setVersion(data.version);
        if (data.reasoning) setReasoning(data.reasoning);
        setUpdatedAt(data.updated_at ?? null);
      }
    } catch (err) {
      console.error("Failed to load settings", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await apiService.settings.update({
        config: {
          triage_weights: {
            static: wStatic,
            embedding: wEmbedding,
            llm: wLlm,
          },
          exploit_priority: exploitPriority,
          target_type_hints: {},
          payload_boost_patterns: [],
        },
        reasoning: "Manual update from dashboard",
      });
      if (!res.error) {
        setSaved(true);
        loadSettings();
        setTimeout(() => setSaved(false), 3000);
      } else {
        console.error("Failed to save:", res.error);
      }
    } catch (err) {
      console.error("Failed to save", err);
    } finally {
      setSaving(false);
    }
  }

  const WEIGHT_SETTERS: Record<string, (v: number) => void> = {
    static: setWStatic,
    embedding: setWEmbedding,
    llm: setWLlm,
  };
  const WEIGHT_VALUES: Record<string, number> = {
    static: wStatic,
    embedding: wEmbedding,
    llm: wLlm,
  };

  function moveExploit(index: number, direction: "up" | "down") {
    const newList = [...exploitPriority];
    const swap = direction === "up" ? index - 1 : index + 1;
    if (swap < 0 || swap >= newList.length) return;
    [newList[index], newList[swap]] = [newList[swap], newList[index]];
    setExploitPriority(newList);
  }

  const total = wStatic + wEmbedding + wLlm;
  const weightsBalanced = Math.abs(total - 1.0) <= 0.01;

  const saveButton = (
    <button
      type="button"
      onClick={handleSave}
      disabled={saving}
      className={`btn ${saved ? "btn-secondary" : "btn-primary"}`}
    >
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : saved ? (
        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
      ) : (
        <Save className="h-4 w-4" aria-hidden="true" />
      )}
      {saved ? "Saved" : "Save changes"}
    </button>
  );

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-8">
        <PageHeader title="Settings" icon={SettingsIcon} />
        <Card className="space-y-6 p-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-2.5 w-full" />
            </div>
          ))}
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Settings"
        description={`Strategy config v${version} · Updated ${formatDate(updatedAt)}`}
        icon={SettingsIcon}
        actions={saveButton}
      />

      {/* Triage Weights */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="space-y-6 p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <SettingsIcon className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Triage scoring weights
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Control how much each component contributes to the final triage
                score. Weights should sum to 1.0.
              </p>
            </div>
          </div>

          {!weightsBalanced && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Weights sum to {total.toFixed(2)} — they should sum to 1.0.
              </span>
            </div>
          )}

          <div className="space-y-6">
            {WEIGHT_FIELDS.map((field) => {
              const value = WEIGHT_VALUES[field.key];
              const inputId = `weight-${field.key}`;
              return (
                <div key={field.key} className="space-y-2">
                  <div className="flex items-center justify-between gap-4">
                    <label
                      htmlFor={inputId}
                      className="text-sm font-medium text-foreground"
                    >
                      {field.label}
                    </label>
                    <span className="font-mono text-sm font-semibold tabular-nums text-accent">
                      {value.toFixed(2)}
                    </span>
                  </div>
                  <input
                    id={inputId}
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={value}
                    onChange={(e) =>
                      WEIGHT_SETTERS[field.key](parseFloat(e.target.value))
                    }
                    aria-valuetext={`${field.label} weight ${value.toFixed(2)}`}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-2 accent-accent"
                  />
                  <p className="text-xs text-subtle">{field.hint}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </motion.section>

      {/* Exploit Priority */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <Card className="space-y-6 p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
              <RotateCcw className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Exploit agent priority
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Reorder which exploit types are attempted first. Higher-priority
                agents run before lower ones.
              </p>
            </div>
          </div>

          <ol className="space-y-2">
            {exploitPriority.map((type, i) => (
              <li
                key={type}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/60 p-3"
              >
                <GripVertical
                  className="h-4 w-4 shrink-0 text-subtle"
                  aria-hidden="true"
                />
                <span className="flex-1 text-sm font-medium text-foreground">
                  <span className="mr-2 tabular-nums text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className="uppercase tracking-wide">{type}</span>
                </span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => moveExploit(i, "up")}
                    disabled={i === 0}
                    aria-label={`Move ${type} up`}
                    className="icon-btn h-10 w-10 disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveExploit(i, "down")}
                    disabled={i === exploitPriority.length - 1}
                    aria-label={`Move ${type} down`}
                    className="icon-btn h-10 w-10 disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </motion.section>

      {/* Meta-Agent Reasoning */}
      {reasoning && (
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-foreground">
                Last meta-agent reasoning
              </h2>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {reasoning}
            </p>
          </Card>
        </motion.section>
      )}
    </div>
  );
}
