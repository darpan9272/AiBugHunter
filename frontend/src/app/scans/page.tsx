"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Play, CheckCircle2, XCircle, Clock, Loader2, Bot } from "lucide-react";
import Link from "next/link";

interface ScanJob {
  id: string;
  programme_name: string;
  status: string;
  agents_assigned: string[];
  started_at: string;
  finished_at: string | null;
}

interface ActivityEvent {
  id: string;
  action: string;
  detail: string;
  created_at: string;
  nickname: string;
  model: string;
  provider: string;
}

export default function ScansPage() {
  const [scans, setScans] = useState<ScanJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedScanId, setSelectedScanId] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    loadScans();
    // Refresh scans every 10 seconds if there's a running scan
    const interval = setInterval(loadScans, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadScans() {
    try {
      const res = await fetch("/api/scans");
      const data = await res.json();
      if (data.scans) setScans(data.scans);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedScanId) return;
    
    // Load activity immediately, then poll
    loadActivity();
    const interval = setInterval(loadActivity, 3000);
    return () => clearInterval(interval);

    async function loadActivity() {
      try {
        const res = await fetch(`/api/scans/${selectedScanId}`);
        const data = await res.json();
        if (data.activity) setActivityFeed(data.activity);
      } catch (err) {
        console.error(err);
      }
    }
  }, [selectedScanId]);

  const statusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'completed': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'failed': return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default: return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'running': return <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
      case 'failed': return <XCircle className="w-4 h-4 text-rose-400" />;
      default: return <Clock className="w-4 h-4 text-slate-400" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6 h-[calc(100vh-4rem)]">
      {/* Left Column: Scan List */}
      <div className="w-full md:w-1/3 flex flex-col space-y-4">
        <header>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-cyan-400" />
            Scan Jobs
          </h2>
        </header>

        <div className="flex-1 overflow-y-auto space-y-3 pr-2">
          {loading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-24 bg-[rgba(30,41,59,0.5)] rounded-xl" />)}
            </div>
          ) : scans.length === 0 ? (
            <div className="text-center p-8 bg-[rgba(30,41,59,0.3)] rounded-xl border border-[var(--color-panel-border)]">
              <p className="text-slate-400 mb-4">No scans have been launched yet.</p>
              <Link href="/programs" className="text-cyan-400 hover:text-cyan-300 font-medium text-sm">
                Go to Programs to launch a scan →
              </Link>
            </div>
          ) : (
            scans.map(scan => (
              <div
                key={scan.id}
                onClick={() => setSelectedScanId(scan.id)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedScanId === scan.id 
                    ? "bg-[rgba(34,211,238,0.05)] border-cyan-500/50" 
                    : "bg-[rgba(15,23,42,0.6)] border-[var(--color-panel-border)] hover:border-cyan-500/30"
                }`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-semibold text-white truncate pr-2">{scan.programme_name}</h3>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {statusIcon(scan.status)}
                  </div>
                </div>
                <div className="text-xs text-slate-400 space-y-1.5">
                  <p>Started: {new Date(scan.started_at).toLocaleTimeString()}</p>
                  <p className="flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5" />
                    {scan.agents_assigned.length} agents assigned
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right Column: Live Activity Feed */}
      <div className="flex-1 glass-panel flex flex-col overflow-hidden">
        {selectedScanId ? (
          <>
            <div className="p-4 border-b border-[var(--color-panel-border)] bg-[rgba(15,23,42,0.8)] flex justify-between items-center">
              <h3 className="font-semibold text-white">Live Activity Feed</h3>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  {scans.find(s => s.id === selectedScanId)?.status === 'running' && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${scans.find(s => s.id === selectedScanId)?.status === 'running' ? 'bg-cyan-500' : 'bg-slate-500'}`}></span>
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {scans.find(s => s.id === selectedScanId)?.status === 'running' ? 'SYNCING...' : 'DISCONNECTED'}
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <AnimatePresence>
                {activityFeed.map((event, i) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex gap-4"
                  >
                    <div className="flex flex-col items-center mt-1">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                      {i !== activityFeed.length - 1 && (
                        <div className="w-px h-full bg-[var(--color-panel-border)] my-1" />
                      )}
                    </div>
                    
                    <div className="flex-1 bg-[rgba(30,41,59,0.4)] border border-[var(--color-panel-border)] rounded-lg p-3">
                      <div className="flex justify-between items-start mb-1">
                        <span className="font-medium text-white text-sm">
                          {event.nickname || event.model || 'System Orchestrator'}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          {new Date(event.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      
                      <div className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 uppercase tracking-wider mb-2">
                        {event.action}
                      </div>
                      
                      {event.detail && (
                        <p className="text-sm text-slate-300 whitespace-pre-wrap font-mono">
                          {event.detail}
                        </p>
                      )}
                    </div>
                  </motion.div>
                ))}
                {activityFeed.length === 0 && (
                  <div className="text-center py-12 text-slate-500">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-3" />
                    <p>Waiting for agents to report in...</p>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center">
            <Activity className="w-16 h-16 mb-4 opacity-50" />
            <h3 className="text-xl font-medium text-white mb-2">No Scan Selected</h3>
            <p>Select a scan from the left to view the real-time activity feed from the agent swarm.</p>
          </div>
        )}
      </div>
    </div>
  );
}
