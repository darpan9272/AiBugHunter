"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Filter, ChevronDown, X, ExternalLink } from "lucide-react";

interface Finding {
  id: string;
  target: string;
  type: string;
  triage_score: number;
  triage_reason: string;
  metadata: any;
  created_at: string;
  programme_name: string;
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  // Filters
  const [filterProgramme, setFilterProgramme] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterMinScore, setFilterMinScore] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterProgramme) params.set("programme_id", filterProgramme);
      if (filterType) params.set("type", filterType);
      if (filterMinScore) params.set("min_score", filterMinScore);

      const [findingsRes, progRes] = await Promise.all([
        fetch(`/api/findings?${params.toString()}`).then((r) => r.json()),
        fetch("/api/programmes").then((r) => r.json()),
      ]);
      if (findingsRes.findings) setFindings(findingsRes.findings);
      if (progRes.programmes) setProgrammes(progRes.programmes);
    } catch (err) {
      console.error("Failed to load findings", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [filterProgramme, filterType, filterMinScore]);

  const typeBadge = (type: string) => {
    const colors: Record<string, string> = {
      subdomain: "bg-blue-500/20 text-blue-400 border-blue-500/30",
      endpoint: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
      param: "bg-purple-500/20 text-purple-400 border-purple-500/30",
      service: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    };
    return colors[type] || "bg-slate-500/20 text-slate-300 border-slate-500/30";
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <header>
        <h2 className="text-3xl font-bold tracking-tight text-white">
          Findings
        </h2>
        <p className="text-slate-400 mt-1">
          Attack surface discovered by recon agents
        </p>
      </header>

      {/* Filters Row */}
      <div className="flex flex-wrap gap-4">
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <select
            value={filterProgramme}
            onChange={(e) => setFilterProgramme(e.target.value)}
            className="bg-[rgba(30,41,59,0.5)] border border-[var(--color-panel-border)] rounded-xl pl-9 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 appearance-none min-w-[180px]"
          >
            <option value="">All Programmes</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-[rgba(30,41,59,0.5)] border border-[var(--color-panel-border)] rounded-xl px-4 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 appearance-none min-w-[160px]"
          >
            <option value="">All Types</option>
            <option value="subdomain">Subdomain</option>
            <option value="endpoint">Endpoint</option>
            <option value="param">Parameter</option>
            <option value="service">Service</option>
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={filterMinScore}
            onChange={(e) => setFilterMinScore(e.target.value)}
            className="bg-[rgba(30,41,59,0.5)] border border-[var(--color-panel-border)] rounded-xl px-4 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500 appearance-none min-w-[160px]"
          >
            <option value="">Any Score</option>
            <option value="0.7">High (≥ 0.7)</option>
            <option value="0.4">Medium+ (≥ 0.4)</option>
            <option value="0.1">Low+ (≥ 0.1)</option>
          </select>
          <ChevronDown className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {(filterProgramme || filterType || filterMinScore) && (
          <button
            onClick={() => {
              setFilterProgramme("");
              setFilterType("");
              setFilterMinScore("");
            }}
            className="flex items-center gap-1 px-3 py-2.5 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" /> Clear Filters
          </button>
        )}
      </div>

      {/* Findings Table */}
      <div className="glass-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[rgba(30,41,59,0.5)] text-slate-400 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-medium">Type</th>
                <th className="px-6 py-4 font-medium">Target</th>
                <th className="px-6 py-4 font-medium">Programme</th>
                <th className="px-6 py-4 font-medium">Triage Score</th>
                <th className="px-6 py-4 font-medium">Discovered</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-panel-border)] text-sm">
              {loading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-700/50 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-48 bg-slate-700/50 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-700/50 rounded" /></td>
                    <td className="px-6 py-4"><div className="h-2 w-16 bg-slate-700/50 rounded-full" /></td>
                    <td className="px-6 py-4"><div className="h-4 w-20 bg-slate-700/50 rounded" /></td>
                  </tr>
                ))
              ) : findings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-slate-500">
                    <Search className="w-12 h-12 mx-auto mb-3 text-slate-600" />
                    <p className="text-lg font-medium text-slate-400">No findings yet</p>
                    <p className="text-sm">Run a recon scan to populate attack surface data</p>
                  </td>
                </tr>
              ) : (
                findings.map((f, i) => (
                  <motion.tr
                    key={f.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => setSelectedFinding(f)}
                    className="hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${typeBadge(f.type)}`}>
                        {f.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-xs text-cyan-300 truncate max-w-xs flex items-center gap-1.5">
                        <ExternalLink className="w-3 h-3 shrink-0" />
                        {f.target}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-300">{f.programme_name}</td>
                    <td className="px-6 py-4">
                      {f.triage_score !== null ? (
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">
                            {(f.triage_score * 10).toFixed(1)}
                          </span>
                          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-cyan-400 to-purple-500"
                              style={{ width: `${f.triage_score * 100}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-400 text-xs">
                      {new Date(f.created_at).toLocaleDateString()}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Side Panel */}
      <AnimatePresence>
        {selectedFinding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedFinding(null)}
          >
            <motion.div
              initial={{ x: 300 }}
              animate={{ x: 0 }}
              exit={{ x: 300 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-md glass-panel m-4 ml-0 rounded-l-2xl overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-[var(--color-panel-border)] flex justify-between items-center sticky top-0 bg-[var(--color-panel)] backdrop-blur-lg z-10">
                <h3 className="text-lg font-semibold text-white">Finding Details</h3>
                <button
                  onClick={() => setSelectedFinding(null)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="text-xs text-slate-400 uppercase tracking-wider">Target</label>
                  <p className="text-cyan-300 font-mono text-sm mt-1 break-all">
                    {selectedFinding.target}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider">Type</label>
                    <p className="text-white mt-1">{selectedFinding.type}</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider">Programme</label>
                    <p className="text-white mt-1">{selectedFinding.programme_name}</p>
                  </div>
                </div>
                {selectedFinding.triage_score !== null && (
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider">Triage Score</label>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-2xl font-bold text-white">
                        {(selectedFinding.triage_score * 10).toFixed(1)}
                      </span>
                      <div className="flex-1 h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-400 to-purple-500"
                          style={{ width: `${selectedFinding.triage_score * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                {selectedFinding.triage_reason && (
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider">Triage Reason</label>
                    <p className="text-slate-300 text-sm mt-1">{selectedFinding.triage_reason}</p>
                  </div>
                )}
                {selectedFinding.metadata && (
                  <div>
                    <label className="text-xs text-slate-400 uppercase tracking-wider">Metadata</label>
                    <pre className="mt-2 p-4 bg-[rgba(15,23,42,0.8)] rounded-lg text-xs text-slate-300 overflow-x-auto">
                      {JSON.stringify(
                        typeof selectedFinding.metadata === "string"
                          ? JSON.parse(selectedFinding.metadata)
                          : selectedFinding.metadata,
                        null,
                        2
                      )}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
