"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  Globe,
  X,
  Loader2,
  ExternalLink,
  Search,
  Activity,
} from "lucide-react";
import { useRouter } from "next/navigation";

interface Programme {
  id: string;
  name: string;
  platform: string;
  scope: any;
  out_of_scope: any;
  finding_count: number;
  recon_run_count: number;
  total_tokens?: string | number;
  provider_tokens?: Record<string, number>;
  created_at: string;
}

export default function ProgramsPage() {
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  // Form state
  const [formName, setFormName] = useState("");
  const [formPlatform, setFormPlatform] = useState("private");
  const [formScope, setFormScope] = useState("");
  const [formOutOfScope, setFormOutOfScope] = useState("");

  const router = useRouter();

  async function loadProgrammes() {
    try {
      const res = await fetch("/api/programmes");
      const data = await res.json();
      if (data.programmes) setProgrammes(data.programmes);
    } catch (err) {
      console.error("Failed to load programmes", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProgrammes();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const scopeLines = formScope
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const outOfScopeLines = formOutOfScope
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    try {
      const res = await fetch("/api/programmes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          platform: formPlatform,
          in_scope: scopeLines,
          out_of_scope: outOfScopeLines,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create programme");
        return;
      }
      setShowModal(false);
      setFormName("");
      setFormPlatform("private");
      setFormScope("");
      setFormOutOfScope("");
      loadProgrammes();
    } catch (err) {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete programme "${name}"? This cannot be undone.`)) return;
    try {
      await fetch(`/api/programmes/${id}`, { method: "DELETE" });
      loadProgrammes();
    } catch (err) {
      console.error("Failed to delete", err);
    }
  }

  async function handleLaunchScan(programmeId: string) {
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programme_id: programmeId }),
      });
      const data = await res.json();
      if (res.ok) {
        // Redirect to the Scans page to watch it run
        router.push("/scans");
      } else {
        alert(data.error || "Failed to launch scan");
      }
    } catch (err) {
      alert("Network error while launching scan");
    }
  }

  const filtered = programmes.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const platformBadge = (platform: string) => {
    const colors: Record<string, string> = {
      hackerone: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
      bugcrowd: "bg-orange-500/20 text-orange-400 border-orange-500/30",
      private: "bg-slate-500/20 text-slate-300 border-slate-500/30",
      intigriti: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    };
    return colors[platform?.toLowerCase()] || colors.private;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">
            Programs
          </h2>
          <p className="text-slate-400 mt-1">
            Manage your bug bounty targets and scope
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all duration-300 active:scale-95"
        >
          <Plus className="w-5 h-5" />
          Add Program
        </button>
      </header>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Search programmes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-[rgba(30,41,59,0.5)] border border-[var(--color-panel-border)] rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-white placeholder-slate-500"
        />
      </div>

      {/* Programmes Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-panel p-6 animate-pulse space-y-4">
              <div className="h-5 w-32 bg-slate-700/50 rounded" />
              <div className="h-3 w-48 bg-slate-700/50 rounded" />
              <div className="h-3 w-24 bg-slate-700/50 rounded" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel p-16 text-center"
        >
          <Globe className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">
            {search ? "No matching programmes" : "No programmes yet"}
          </h3>
          <p className="text-slate-400 mb-6">
            {search
              ? "Try a different search term"
              : "Add your first bug bounty programme to start hunting"}
          </p>
          {!search && (
            <button
              onClick={() => setShowModal(true)}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-xl hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all"
            >
              <Plus className="w-4 h-4 inline mr-2" />
              Add Your First Programme
            </button>
          )}
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((p, i) => {
            const scopeData =
              typeof p.scope === "string" ? JSON.parse(p.scope) : p.scope;
            const inScopeDomains = scopeData?.in_scope || [];

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-panel p-6 group hover:border-cyan-500/30 transition-all duration-300"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-white truncate">
                      {p.name}
                    </h3>
                    <span
                      className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${platformBadge(p.platform)}`}
                    >
                      {p.platform || "Private"}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDelete(p.id, p.name)}
                    className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Scope Domains */}
                <div className="space-y-1.5 mb-4">
                  {inScopeDomains.slice(0, 3).map((d: string, j: number) => (
                    <div
                      key={j}
                      className="flex items-center gap-2 text-sm text-slate-300"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="truncate font-mono text-xs">{d}</span>
                    </div>
                  ))}
                  {inScopeDomains.length > 3 && (
                    <p className="text-xs text-slate-500">
                      +{inScopeDomains.length - 3} more
                    </p>
                  )}
                </div>

                {/* Stats & Actions */}
                <div className="flex justify-between items-center pt-4 border-t border-[var(--color-panel-border)] text-sm">
                  <div className="flex gap-4">
                    <div>
                      <span className="text-slate-400">Findings</span>
                      <span className="ml-2 text-white font-medium">
                        {p.finding_count}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Scans</span>
                      <span className="ml-2 text-white font-medium">
                        {p.recon_run_count}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400">Tokens</span>
                      <span 
                        className="ml-2 text-purple-400 font-medium cursor-help" 
                        title={Object.entries(p.provider_tokens || {}).map(([k,v]) => `${k}: ${v}`).join(', ')}
                      >
                        {Number(p.total_tokens || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleLaunchScan(p.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 rounded-lg transition-colors font-medium text-xs border border-cyan-500/20"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    Launch Scan
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add Programme Modal */}
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
              <div className="p-6 border-b border-[var(--color-panel-border)] flex justify-between items-center">
                <h3 className="text-xl font-semibold text-white">
                  Add New Program
                </h3>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="p-6 space-y-5">
                {error && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Programme Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Tesla Bug Bounty"
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Platform
                  </label>
                  <select
                    value={formPlatform}
                    onChange={(e) => setFormPlatform(e.target.value)}
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                  >
                    <option value="private">Private</option>
                    <option value="hackerone">HackerOne</option>
                    <option value="bugcrowd">Bugcrowd</option>
                    <option value="intigriti">Intigriti</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    In-Scope Domains * (one per line)
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                    placeholder={"*.example.com\napi.example.com\nexample.com"}
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1.5">
                    Out-of-Scope Patterns (one per line, optional)
                  </label>
                  <textarea
                    rows={2}
                    value={formOutOfScope}
                    onChange={(e) => setFormOutOfScope(e.target.value)}
                    placeholder={"support\\.example\\.com\nstaging\\..*"}
                    className="w-full bg-[rgba(15,23,42,0.8)] border border-[var(--color-panel-border)] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono text-sm"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-2.5 border border-[var(--color-panel-border)] text-slate-300 rounded-lg hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-lg hover:shadow-[0_0_20px_rgba(34,211,238,0.4)] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    Create Programme
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
