"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Loader2,
  Power,
  Zap,
} from "lucide-react";

interface Agent {
  id: string;
  provider: string;
  model: string;
  role: string;
  status: string;
  nickname: string;
  base_url: string;
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; msg: string; success: boolean } | null>(null);

  // Form State
  const [formProvider, setFormProvider] = useState("openai");
  const [formModel, setFormModel] = useState("gpt-4o");
  const [formApiKey, setFormApiKey] = useState("");
  const [formRole, setFormRole] = useState("general");
  const [formNickname, setFormNickname] = useState("");
  const [formBaseUrl, setFormBaseUrl] = useState("");

  const providers = [
    { id: "openai", name: "OpenAI", defaultModel: "gpt-4o" },
    { id: "anthropic", name: "Anthropic", defaultModel: "claude-3-5-sonnet-20241022" },
    { id: "google", name: "Google", defaultModel: "gemini-3.0-pro" },
    { id: "mistral", name: "Mistral", defaultModel: "mistral-large-latest" },
    { id: "groq", name: "Groq", defaultModel: "llama-3.3-70b-versatile" },
    { id: "deepseek", name: "DeepSeek", defaultModel: "deepseek-chat" },
    { id: "custom", name: "Custom (OpenAI Compatible)", defaultModel: "" },
  ];

  const roles = [
    { id: "general", name: "General Purpose (Fallback)" },
    { id: "recon", name: "Reconnaissance (Discovery)" },
    { id: "vuln_analyzer", name: "Vulnerability Analyzer" },
    { id: "exploit", name: "Exploit Crafter" },
    { id: "triage", name: "Triage & Scoring" },
    { id: "report", name: "Report Writer" },
  ];

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (data.agents) setAgents(data.agents);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: formProvider,
          model: formModel,
          api_key: formApiKey,
          role: formRole,
          nickname: formNickname,
          base_url: formProvider === "custom" ? formBaseUrl : undefined,
        }),
      });
      setShowModal(false);
      setFormApiKey("");
      setFormNickname("");
      loadAgents();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(id: string, currentStatus: string) {
    try {
      await fetch(`/api/agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: currentStatus === "active" ? "inactive" : "active",
        }),
      });
      loadAgents();
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteAgent(id: string) {
    if (!confirm("Remove this AI agent?")) return;
    try {
      await fetch(`/api/agents/${id}`, { method: "DELETE" });
      loadAgents();
    } catch (err) {
      console.error(err);
    }
  }

  async function testAgent(id: string) {
    setTestingId(id);
    setTestResult(null);
    try {
      const res = await fetch(`/api/agents/${id}/test`, { method: "POST" });
      const data = await res.json();
      setTestResult({
        id,
        success: data.success,
        msg: data.success ? `Connected! Latency: ${data.latencyMs}ms` : `Error: ${data.error}`,
      });
    } catch (err) {
      setTestResult({ id, success: false, msg: "Network error" });
    } finally {
      setTestingId(null);
    }
  }

  const roleBadge = (role: string) => {
    const colors: Record<string, string> = {
      recon: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      vuln_analyzer: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      exploit: "bg-rose-500/20 text-rose-400 border-rose-500/30",
      triage: "bg-amber-500/20 text-amber-400 border-amber-500/30",
      report: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      general: "bg-slate-500/20 text-slate-300 border-slate-500/30",
    };
    return colors[role] || colors.general;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            <Cpu className="w-8 h-8 text-cyan-400" />
            Agent Hub
          </h2>
          <p className="text-slate-400 mt-1">
            Connect AI providers and orchestrate your autonomous swarm
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
        >
          <Plus className="w-5 h-5" />
          Connect Agent
        </button>
      </header>

      {/* Agents Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel p-6 animate-pulse space-y-4">
              <div className="h-5 w-32 bg-slate-700/50 rounded" />
              <div className="h-3 w-48 bg-slate-700/50 rounded" />
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <div className="glass-panel p-16 text-center">
          <Cpu className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No AI Agents Connected</h3>
          <p className="text-slate-400 mb-6">Connect an OpenAI, Anthropic, or custom model to start hunting.</p>
          <button
            onClick={() => setShowModal(true)}
            className="px-5 py-2.5 bg-slate-800 text-white font-medium rounded-xl hover:bg-slate-700 transition-colors"
          >
            Add Your First Agent
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent, i) => (
            <motion.div
              key={agent.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`glass-panel p-6 relative transition-all ${agent.status === 'inactive' ? 'opacity-60' : ''}`}
            >
              <div className="flex justify-between items-start mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-white truncate">
                      {agent.nickname || agent.model}
                    </h3>
                    <button onClick={() => toggleStatus(agent.id, agent.status)} className="p-1" title="Toggle Active Status">
                      <Power className={`w-4 h-4 ${agent.status === 'active' ? 'text-emerald-400' : 'text-slate-500'}`} />
                    </button>
                  </div>
                  <p className="text-sm text-slate-400 capitalize">{agent.provider}</p>
                </div>
                <button
                  onClick={() => deleteAgent(agent.id)}
                  className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${roleBadge(agent.role)}`}>
                    Role: {roles.find(r => r.id === agent.role)?.name || agent.role}
                  </span>
                </div>
                
                <div className="pt-4 border-t border-[var(--color-panel-border)]">
                  <button
                    onClick={() => testAgent(agent.id)}
                    disabled={testingId === agent.id}
                    className="w-full flex justify-center items-center gap-2 py-2 bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.1)] text-slate-300 text-sm rounded-lg transition-colors"
                  >
                    {testingId === agent.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                    ) : (
                      <Zap className="w-4 h-4 text-cyan-400" />
                    )}
                    Test Connection
                  </button>
                  
                  {testResult?.id === agent.id && (
                    <div className={`mt-3 text-xs p-2 rounded ${testResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                       {testResult.success ? <CheckCircle2 className="w-3 h-3 inline mr-1" /> : <XCircle className="w-3 h-3 inline mr-1" />}
                       {testResult.msg}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Connect Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-lg p-0 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-[var(--color-panel-border)]">
                <h3 className="text-xl font-semibold text-white">Connect AI Provider</h3>
              </div>

              <form onSubmit={handleCreate} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Provider</label>
                    <select
                      value={formProvider}
                      onChange={(e) => {
                        setFormProvider(e.target.value);
                        setFormModel(providers.find(p => p.id === e.target.value)?.defaultModel || "");
                      }}
                      className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white focus:border-cyan-500 outline-none"
                    >
                      {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Role</label>
                    <select
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value)}
                      className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white focus:border-cyan-500 outline-none"
                    >
                      {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Model ID</label>
                  <input
                    type="text"
                    required
                    value={formModel}
                    onChange={(e) => setFormModel(e.target.value)}
                    placeholder="e.g. gpt-4o"
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white outline-none focus:border-cyan-500"
                  />
                </div>

                {formProvider === "custom" && (
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-1.5">Base URL</label>
                    <input
                      type="url"
                      required
                      value={formBaseUrl}
                      onChange={(e) => setFormBaseUrl(e.target.value)}
                      placeholder="https://your-custom-endpoint/v1"
                      className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white outline-none focus:border-cyan-500"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">API Key</label>
                  <input
                    type="password"
                    required
                    value={formApiKey}
                    onChange={(e) => setFormApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white outline-none focus:border-cyan-500 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">Nickname (Optional)</label>
                  <input
                    type="text"
                    value={formNickname}
                    onChange={(e) => setFormNickname(e.target.value)}
                    placeholder="e.g. DeepSeek Exploit Master"
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 border border-[var(--color-panel-border)] text-slate-300 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={submitting} className="flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-lg hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all">
                    {submitting ? <Loader2 className="w-5 h-5 mx-auto animate-spin" /> : "Connect Agent"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
