"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Filter, X, Link2, FileSearch } from "lucide-react";
import { apiService } from "@/lib/api";
import {
  PageHeader,
  Card,
  EmptyState,
  Skeleton,
  SeverityPill,
  severityFromScore,
  formatDate,
} from "@/components/ui";

interface Finding {
  id: string;
  target: string;
  type: string;
  triage_score: number | null;
  triage_reason: string | null;
  metadata: unknown;
  created_at: string;
  programme_name: string | null;
}

interface ProgrammeRef {
  id: string;
  name: string;
}

function scorePct(score: number | null | undefined): number {
  const s = typeof score === "number" && Number.isFinite(score) ? score : 0;
  return Math.max(0, Math.min(100, Math.round(s * 100)));
}

function safeJson(value: unknown): string {
  if (value == null) return "";
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return typeof value === "string" ? value : String(value);
  }
}

export default function FindingsPage() {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [programmes, setProgrammes] = useState<ProgrammeRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);

  // Filters
  const [filterProgramme, setFilterProgramme] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterMinScore, setFilterMinScore] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [findingsRes, progRes] = await Promise.all([
        apiService.findings.getAll(),
        apiService.programmes.getAll(),
      ]);
      let filteredFindings = findingsRes.data && Array.isArray(findingsRes.data.findings)
        ? findingsRes.data.findings
        : [];

      // Apply filters
      if (filterProgramme) {
        filteredFindings = filteredFindings.filter(f => f.programme_name === filterProgramme);
      }
      if (filterType) {
        filteredFindings = filteredFindings.filter(f => f.type === filterType);
      }
      if (filterMinScore) {
        const minScore = parseFloat(filterMinScore);
        if (!isNaN(minScore)) {
          filteredFindings = filteredFindings.filter(f =>
            f.triage_score !== null && f.triage_score >= minScore
          );
        }
      }

      setFindings(filteredFindings);
      if (progRes.data && Array.isArray(progRes.data.programmes)) setProgrammes(progRes.data.programmes);
    } catch (err) {
      console.error("Failed to load findings", err);
    } finally {
      setLoading(false);
    }
  }, [filterProgramme, filterType, filterMinScore]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close the detail panel on Escape
  useEffect(() => {
    if (!selectedFinding) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedFinding(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedFinding]);

  const hasFilters = Boolean(filterProgramme || filterType || filterMinScore);
  const clearFilters = () => {
    setFilterProgramme("");
    setFilterType("");
    setFilterMinScore("");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      <PageHeader
        title="Findings"
        description="Attack surface discovered and triaged by the recon swarm."
        icon={FileSearch}
      />

      {/* Filters */}
      <section aria-label="Filters" className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Filter className="h-4 w-4" aria-hidden="true" />
          <span>Filter</span>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-programme" className="sr-only">
            Programme
          </label>
          <select
            id="filter-programme"
            className="select min-w-[11rem]"
            value={filterProgramme}
            onChange={(e) => setFilterProgramme(e.target.value)}
          >
            <option value="">All programmes</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-type" className="sr-only">
            Finding type
          </label>
          <select
            id="filter-type"
            className="select min-w-[9rem]"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All types</option>
            <option value="subdomain">Subdomain</option>
            <option value="endpoint">Endpoint</option>
            <option value="param">Parameter</option>
            <option value="service">Service</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="filter-score" className="sr-only">
            Minimum triage score
          </label>
          <select
            id="filter-score"
            className="select min-w-[9rem]"
            value={filterMinScore}
            onChange={(e) => setFilterMinScore(e.target.value)}
          >
            <option value="">Any score</option>
            <option value="0.7">High (≥ 70%)</option>
            <option value="0.4">Medium+ (≥ 40%)</option>
            <option value="0.1">Low+ (≥ 10%)</option>
          </select>
        </div>

        {hasFilters && (
          <button type="button" onClick={clearFilters} className="btn btn-ghost btn-sm">
            <X className="h-4 w-4" aria-hidden="true" />
            Clear
          </button>
        )}
      </section>

      {/* Findings */}
      <Card>
        {loading ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="hidden h-4 w-24 sm:block" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        ) : findings.length === 0 ? (
          <div className="p-5">
            <EmptyState
              icon={FileSearch}
              title={hasFilters ? "No findings match these filters" : "No findings yet"}
              description={
                hasFilters
                  ? "Try widening the score threshold or clearing the type filter."
                  : "Run a recon scan against a programme to populate the attack surface here."
              }
              action={
                hasFilters ? (
                  <button type="button" onClick={clearFilters} className="btn btn-secondary btn-sm">
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wider text-subtle">
                    <th className="px-5 py-3 font-medium">Severity</th>
                    <th className="px-5 py-3 font-medium">Finding</th>
                    <th className="px-5 py-3 font-medium">Programme</th>
                    <th className="px-5 py-3 font-medium">Score</th>
                    <th className="px-5 py-3 font-medium">Detected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {findings.map((f) => {
                    const pct = scorePct(f.triage_score);
                    return (
                      <tr
                        key={f.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`View details for ${f.type} ${f.target}`}
                        onClick={() => setSelectedFinding(f)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedFinding(f);
                          }
                        }}
                        className="cursor-pointer transition-colors hover:bg-surface-2/50 focus:bg-surface-2/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <td className="px-5 py-3">
                          <SeverityPill severity={severityFromScore(f.triage_score)} />
                        </td>
                        <td className="px-5 py-3">
                          <div className="font-medium capitalize text-foreground">{f.type}</div>
                          <div className="flex max-w-xs items-center gap-1.5 truncate font-mono text-xs text-subtle">
                            <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{f.target}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {f.programme_name || "—"}
                        </td>
                        <td className="px-5 py-3">
                          {f.triage_score === null ? (
                            <span className="text-subtle">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="tabular-nums font-medium text-foreground">
                                {pct}%
                              </span>
                              <div
                                className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2"
                                role="presentation"
                              >
                                <div
                                  className="h-full rounded-full bg-accent"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {formatDate(f.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <ul className="divide-y divide-border md:hidden">
              {findings.map((f) => {
                const pct = scorePct(f.triage_score);
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedFinding(f)}
                      className="flex w-full flex-col gap-2 px-5 py-4 text-left transition-colors hover:bg-surface-2/50 focus:bg-surface-2/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <SeverityPill severity={severityFromScore(f.triage_score)} />
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {f.triage_score === null ? "—" : `${pct}%`}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium capitalize text-foreground">{f.type}</p>
                        <p className="truncate font-mono text-xs text-subtle">{f.target}</p>
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="truncate">{f.programme_name || "—"}</span>
                        <span>{formatDate(f.created_at)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      {/* Detail Side Panel */}
      <AnimatePresence>
        {selectedFinding && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
            onClick={() => setSelectedFinding(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Finding details"
              initial={{ x: 360 }}
              animate={{ x: 0 }}
              exit={{ x: 360 }}
              transition={{ type: "spring", damping: 28, stiffness: 240 }}
              className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface/95 px-5 py-4 backdrop-blur">
                <h2 className="text-base font-semibold text-foreground">Finding details</h2>
                <button
                  type="button"
                  onClick={() => setSelectedFinding(null)}
                  className="icon-btn"
                  aria-label="Close details"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-6 p-5">
                <div>
                  <p className="label mb-1">Target</p>
                  <p className="break-all font-mono text-sm text-accent">
                    {selectedFinding.target}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="label mb-1">Type</p>
                    <p className="capitalize text-foreground">{selectedFinding.type}</p>
                  </div>
                  <div>
                    <p className="label mb-1">Programme</p>
                    <p className="text-foreground">{selectedFinding.programme_name || "—"}</p>
                  </div>
                </div>

                {selectedFinding.triage_score !== null && (
                  <div>
                    <p className="label mb-2">Triage score</p>
                    <div className="flex items-center gap-3">
                      <SeverityPill
                        severity={severityFromScore(selectedFinding.triage_score)}
                      />
                      <span className="text-2xl font-semibold tabular-nums text-foreground">
                        {scorePct(selectedFinding.triage_score)}%
                      </span>
                    </div>
                    <div
                      className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${scorePct(selectedFinding.triage_score)}%` }}
                      />
                    </div>
                  </div>
                )}

                {selectedFinding.triage_reason && (
                  <div>
                    <p className="label mb-1">Triage reason</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedFinding.triage_reason}
                    </p>
                  </div>
                )}

                {safeJson(selectedFinding.metadata) && (
                  <div>
                    <p className="label mb-2">Metadata</p>
                    <pre className="overflow-x-auto rounded-lg border border-border bg-background p-4 text-xs text-muted-foreground">
                      {safeJson(selectedFinding.metadata)}
                    </pre>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
