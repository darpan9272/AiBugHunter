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
} from "lucide-react";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);
  const [reasoning, setReasoning] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

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
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (data.config) {
        const cfg =
          typeof data.config === "string"
            ? JSON.parse(data.config)
            : data.config;
        if (cfg.triage_weights) {
          setWStatic(cfg.triage_weights.static || 0.3);
          setWEmbedding(cfg.triage_weights.embedding || 0.4);
          setWLlm(cfg.triage_weights.llm || 0.3);
        }
        if (cfg.exploit_priority) {
          setExploitPriority(cfg.exploit_priority);
        }
      }
      if (data.version) setVersion(data.version);
      if (data.reasoning) setReasoning(data.reasoning);
      if (data.updated_at)
        setUpdatedAt(new Date(data.updated_at).toLocaleString());
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
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
        }),
      });
      if (res.ok) {
        setSaved(true);
        loadSettings();
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save", err);
    } finally {
      setSaving(false);
    }
  }

  function moveExploit(index: number, direction: "up" | "down") {
    const newList = [...exploitPriority];
    const swap = direction === "up" ? index - 1 : index + 1;
    if (swap < 0 || swap >= newList.length) return;
    [newList[index], newList[swap]] = [newList[swap], newList[index]];
    setExploitPriority(newList);
  }

  // Normalize weights to sum to 1
  const total = wStatic + wEmbedding + wLlm;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <h2 className="text-3xl font-bold tracking-tight text-white">Settings</h2>
        </header>
        <div className="glass-panel p-6 animate-pulse space-y-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-4 w-32 bg-slate-700/50 rounded" />
              <div className="h-8 w-full bg-slate-700/50 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <header className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Settings
          </h2>
          <p className="text-slate-400 mt-1">
            Strategy config v{version} · Last updated {updatedAt}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all disabled:opacity-50 active:scale-95"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saved ? "Saved!" : "Save Changes"}
        </button>
      </header>

      {/* Triage Weights */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel p-6 space-y-6"
      >
        <div className="flex items-center gap-3 mb-2">
          <SettingsIcon className="w-5 h-5 text-cyan-400" />
          <h3 className="text-lg font-semibold text-white">
            Triage Scoring Weights
          </h3>
        </div>
        <p className="text-sm text-slate-400">
          Control how each scoring component contributes to the final triage
          score. Weights should sum to 1.0.
        </p>

        {Math.abs(total - 1.0) > 0.01 && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400 text-sm">
            ⚠ Weights sum to {total.toFixed(2)} — they should sum to 1.0
          </div>
        )}

        {/* Static Analysis */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-sm font-medium text-slate-300">
              Static Analysis
            </label>
            <span className="text-sm text-cyan-400 font-mono font-medium">
              {wStatic.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={wStatic}
            onChange={(e) => setWStatic(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-cyan-400"
          />
        </div>

        {/* Embedding Similarity */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-sm font-medium text-slate-300">
              Embedding Similarity
            </label>
            <span className="text-sm text-purple-400 font-mono font-medium">
              {wEmbedding.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={wEmbedding}
            onChange={(e) => setWEmbedding(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-purple-400"
          />
        </div>

        {/* LLM Analysis */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="text-sm font-medium text-slate-300">
              LLM Analysis
            </label>
            <span className="text-sm text-emerald-400 font-mono font-medium">
              {wLlm.toFixed(2)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={wLlm}
            onChange={(e) => setWLlm(parseFloat(e.target.value))}
            className="w-full h-2 bg-slate-800 rounded-full appearance-none cursor-pointer accent-emerald-400"
          />
        </div>
      </motion.div>

      {/* Exploit Priority */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-panel p-6 space-y-6"
      >
        <div className="flex items-center gap-3 mb-2">
          <RotateCcw className="w-5 h-5 text-purple-400" />
          <h3 className="text-lg font-semibold text-white">
            Exploit Agent Priority
          </h3>
        </div>
        <p className="text-sm text-slate-400">
          Drag to reorder which exploit types are attempted first. Higher
          priority agents run before lower ones.
        </p>

        <div className="space-y-2">
          {exploitPriority.map((type, i) => {
            const agentColors: Record<string, string> = {
              sqli: "border-rose-500/30 hover:border-rose-500/50",
              xss: "border-amber-500/30 hover:border-amber-500/50",
              idor: "border-purple-500/30 hover:border-purple-500/50",
              ssrf: "border-cyan-500/30 hover:border-cyan-500/50",
              auth: "border-blue-500/30 hover:border-blue-500/50",
              lfi: "border-emerald-500/30 hover:border-emerald-500/50",
              api: "border-pink-500/30 hover:border-pink-500/50",
            };

            return (
              <div
                key={type}
                className={`flex items-center gap-4 p-3 bg-[rgba(15,23,42,0.5)] border rounded-lg transition-colors ${agentColors[type] || "border-slate-700"}`}
              >
                <GripVertical className="w-4 h-4 text-slate-500" />
                <span className="text-sm font-medium text-white uppercase flex-1">
                  {i + 1}. {type}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => moveExploit(i, "up")}
                    disabled={i === 0}
                    className="px-2 py-1 text-xs text-slate-400 hover:text-white bg-[rgba(30,41,59,0.5)] rounded disabled:opacity-30 transition-colors"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveExploit(i, "down")}
                    disabled={i === exploitPriority.length - 1}
                    className="px-2 py-1 text-xs text-slate-400 hover:text-white bg-[rgba(30,41,59,0.5)] rounded disabled:opacity-30 transition-colors"
                  >
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Meta-Agent Reasoning */}
      {reasoning && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-6"
        >
          <h3 className="text-lg font-semibold text-white mb-3">
            Last Meta-Agent Reasoning
          </h3>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">
            {reasoning}
          </p>
        </motion.div>
      )}
    </div>
  );
}
