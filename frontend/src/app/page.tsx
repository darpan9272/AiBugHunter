"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Target, AlertOctagon, Search, Bell } from "lucide-react";

export default function Dashboard() {
  const [metrics, setMetrics] = useState({ activeTargets: 0, highSeverity: 0, agentsRunning: 0 });
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [metricsRes, findingsRes] = await Promise.all([
          fetch("/api/metrics").then((r) => r.json()),
          fetch("/api/findings").then((r) => r.json())
        ]);
        if (metricsRes.activeTargets !== undefined) setMetrics(metricsRes);
        if (findingsRes.findings) setFindings(findingsRes.findings);
      } catch (err) {
        console.error("Failed to load dashboard data", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
    const interval = setInterval(loadData, 10000); // refresh every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-700">
      
      {/* Header */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-white">Dashboard</h2>
          <p className="text-slate-400 mt-1">Autonomous Bug Hunting System Overview</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search..." 
              className="bg-[rgba(30,41,59,0.5)] border border-[var(--color-panel-border)] rounded-full pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all text-white placeholder-slate-500 w-64"
            />
          </div>
          <button className="p-2 rounded-full bg-[rgba(30,41,59,0.5)] border border-[var(--color-panel-border)] text-slate-400 hover:text-white transition-colors relative">
            <Bell className="w-5 h-5" />
            <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-[var(--color-background)]"></span>
          </button>
        </div>
      </header>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel p-6 relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl group-hover:bg-cyan-500/20 transition-all duration-500"></div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-1">Active Targets</p>
              <h3 className="text-4xl font-bold text-white">{loading ? "-" : metrics.activeTargets}</h3>
            </div>
            <div className="p-3 bg-cyan-500/20 rounded-xl text-cyan-400">
              <Target className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-4 h-12 w-full bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent rounded-lg flex items-end">
             {/* Fake sparkline using SVG could go here */}
             <svg viewBox="0 0 100 30" className="w-full h-full stroke-cyan-400 fill-none opacity-50" preserveAspectRatio="none">
               <path d="M0 25 Q10 15 20 20 T40 10 T60 15 T80 5 T100 15" strokeWidth="2" />
             </svg>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-6 relative overflow-hidden group glow-purple border-purple-500/30"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/10 rounded-full blur-3xl group-hover:bg-purple-500/20 transition-all duration-500"></div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-1">High Severity Bugs</p>
              <h3 className="text-4xl font-bold text-white">{loading ? "-" : metrics.highSeverity}</h3>
            </div>
            <div className="p-3 bg-purple-500/20 rounded-xl text-purple-400">
              <AlertOctagon className="w-6 h-6" />
            </div>
          </div>
           <div className="mt-4 h-12 w-full bg-gradient-to-r from-transparent via-purple-500/20 to-transparent rounded-lg flex items-end">
             <svg viewBox="0 0 100 30" className="w-full h-full stroke-purple-400 fill-none opacity-50" preserveAspectRatio="none">
               <path d="M0 20 Q15 25 30 10 T50 15 T70 5 T100 10" strokeWidth="2" />
             </svg>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass-panel p-6 relative overflow-hidden group glow-cyan border-cyan-500/30"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl group-hover:bg-emerald-500/20 transition-all duration-500"></div>
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <p className="text-sm font-medium text-slate-400 uppercase tracking-wider mb-1">Agents Running</p>
              <div className="flex items-center gap-3">
                 <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)] animate-pulse"></div>
                 <h3 className="text-4xl font-bold text-white">{loading ? "-" : metrics.agentsRunning}</h3>
              </div>
            </div>
            <div className="p-3 bg-emerald-500/20 rounded-xl text-emerald-400">
              <Activity className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--color-panel-border)] relative z-10 flex justify-between items-center text-sm">
             <span className="text-slate-400">Status</span>
             <span className="text-emerald-400 font-medium">ONLINE</span>
          </div>
        </motion.div>
      </div>

      {/* Findings Table */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="glass-panel overflow-hidden"
      >
        <div className="p-6 border-b border-[var(--color-panel-border)] flex justify-between items-center">
          <h3 className="text-lg font-semibold text-white">Recent Vulnerability Findings</h3>
          <button className="text-sm text-cyan-400 hover:text-cyan-300 font-medium">View All</button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[rgba(30,41,59,0.5)] text-slate-400 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-medium">Severity</th>
                <th className="px-6 py-4 font-medium">Finding Title</th>
                <th className="px-6 py-4 font-medium">Target Program</th>
                <th className="px-6 py-4 font-medium">Triage Score</th>
                <th className="px-6 py-4 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-panel-border)] text-sm">
              {loading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-700/50 rounded-full"></div></td>
                    <td className="px-6 py-4"><div className="h-4 w-48 bg-slate-700/50 rounded"></div></td>
                    <td className="px-6 py-4"><div className="h-4 w-24 bg-slate-700/50 rounded"></div></td>
                    <td className="px-6 py-4"><div className="h-2 w-16 bg-slate-700/50 rounded-full"></div></td>
                    <td className="px-6 py-4"><div className="h-6 w-20 bg-slate-700/50 rounded-full"></div></td>
                  </tr>
                ))
              ) : findings.length === 0 ? (
                 <tr>
                   <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                     No findings recorded yet.
                   </td>
                 </tr>
              ) : (
                findings.map((f, i) => {
                  // Determine severity badge colors
                  let sevColor = "bg-slate-500/20 border-slate-500/50 text-slate-300";
                  let sevLabel = "INFO";
                  if (f.triage_score >= 9) {
                    sevColor = "bg-rose-500/20 border-rose-500/50 text-rose-400 glow-rose";
                    sevLabel = "CRITICAL";
                  } else if (f.triage_score >= 7) {
                    sevColor = "bg-purple-500/20 border-purple-500/50 text-purple-400 glow-purple";
                    sevLabel = "HIGH";
                  } else if (f.triage_score >= 4) {
                    sevColor = "bg-cyan-500/20 border-cyan-500/50 text-cyan-400";
                    sevLabel = "MEDIUM";
                  }

                  return (
                    <motion.tr 
                      key={f.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${sevColor}`}>
                          {sevLabel}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-white">{f.vulnerability_type}</div>
                        <div className="text-xs text-slate-500 truncate max-w-xs">{f.url}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-300">{f.program_name}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">{Number(f.triage_score).toFixed(1)}</span>
                          <span className="text-slate-500 text-xs">/ 10</span>
                          <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden ml-2">
                            <div 
                              className="h-full bg-gradient-to-r from-cyan-400 to-purple-500" 
                              style={{ width: `${(f.triage_score / 10) * 100}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                          {f.status || 'Triage'}
                        </span>
                      </td>
                    </motion.tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </motion.div>

    </div>
  );
}
