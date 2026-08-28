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
  Play,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  PageHeader,
  Card,
  EmptyState,
  Skeleton,
  formatDate,
} from "@/components/ui";
import { apiService } from "@/lib/api";

interface Programme {
  id: string;
  name: string;
  platform: string;
  scope: unknown;
  out_of_scope: unknown;
  finding_count: number;
  recon_run_count: number;
  total_tokens?: string | number;
  provider_tokens?: Record<string, number>;
  created_at: string;
}

const PLATFORM_CLS: Record<string, string> = {
  hackerone: "text-success bg-success/12 border-success/40",
  bugcrowd: "text-high bg-high/12 border-high/40",
  intigriti: "text-low bg-low/12 border-low/40",
  private: "text-muted-foreground bg-surface-2 border-border-strong",
};

function platformClass(platform: string): string {
  return PLATFORM_CLS[(platform || "").toLowerCase()] || PLATFORM_CLS.private;
}

/** scope may arrive as a JSON string or an already-parsed object; never throw. */
function inScopeDomains(scope: unknown): string[] {
  try {
    const parsed = typeof scope === "string" ? JSON.parse(scope) : scope;
    const list = (parsed as { in_scope?: unknown } | null)?.in_scope;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
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
      setLoading(true);
      const res = await apiService.programmes.getAll();
      if (res.data) setProgrammes(res.data.programmes);
    } catch (err) {
      console.error("Failed to load programmes", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProgrammes();
  }, []);

  // Close the modal on Escape
  useEffect(() => {
    if (!showModal) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setShowModal(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showModal]);

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
      const res = await apiService.programmes.create({
        name: formName,
        platform: formPlatform,
        in_scope: scopeLines,
        out_of_scope: outOfScopeLines,
      });
      if (res.error) {
        setError(res.error || "Failed to create programme");
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
      await apiService.programmes.delete(id);
      loadProgrammes();
    } catch (err) {
      console.error("Failed to delete", err);
    }
  }

  async function handleLaunchScan(programmeId: string) {
    try {
      const res = await apiService.scanJobs.create({ programme_id: programmeId });
      if (res.error) {
        alert(res.error || "Failed to launch scan");
        return;
      }
      router.push("/scans");
    } catch (err) {
      alert("Network error while launching scan");
    }
  }

  const filtered = programmes.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const addButton = (
    <button
      type="button"
      onClick={() => setShowModal(true)}
      className="btn btn-primary"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      Add program
    </button>
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="space-y-8"
    >
      <PageHeader
        title="Programs"
        description="Manage your bug bounty targets and scope."
        icon={Globe}
        actions={addButton}
      />

      {/* Search */}
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle"
          aria-hidden="true"
        />
        <label htmlFor="prog-search" className="sr-only">
          Search programmes
        </label>
        <input
          id="prog-search"
          type="search"
          className="input pl-9"
          placeholder="Search programmes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Programmes */}
      {loading ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-4 p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Globe}
          title={search ? "No matching programmes" : "No programmes yet"}
          description={
            search
              ? "Try a different search term."
              : "Add your first bug bounty programme to start hunting."
          }
          action={
            !search ? (
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="btn btn-primary"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first programme
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p, i) => {
            const domains = inScopeDomains(p.scope);
            const tokenBreakdown = Object.entries(p.provider_tokens || {})
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ");
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
              >
                <Card className="flex h-full flex-col gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-foreground">
                        {p.name}
                      </h2>
                      <span
                        className={`mt-1.5 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${platformClass(
                          p.platform
                        )}`}
                      >
                        {p.platform || "private"}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(p.id, p.name)}
                      aria-label={`Delete programme ${p.name}`}
                      className="icon-btn shrink-0 text-subtle hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>

                  {/* In-scope domains */}
                  <div className="min-h-[4.5rem] space-y-1.5">
                    {domains.length === 0 ? (
                      <p className="text-xs text-subtle">
                        No in-scope domains listed.
                      </p>
                    ) : (
                      <>
                        {domains.slice(0, 3).map((d) => (
                          <div
                            key={d}
                            className="flex items-center gap-2 text-sm text-muted-foreground"
                          >
                            <ExternalLink
                              className="h-3.5 w-3.5 shrink-0 text-accent"
                              aria-hidden="true"
                            />
                            <span className="truncate font-mono text-xs">{d}</span>
                          </div>
                        ))}
                        {domains.length > 3 && (
                          <p className="text-xs text-subtle">
                            +{domains.length - 3} more
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Stats & actions */}
                  <div className="mt-auto flex items-end justify-between gap-3 border-t border-border pt-4">
                    <dl className="flex gap-4 text-xs">
                      <div className="flex flex-col">
                        <dt className="text-subtle">Findings</dt>
                        <dd className="font-semibold tabular-nums text-foreground">
                          {p.finding_count}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-subtle">Scans</dt>
                        <dd className="font-semibold tabular-nums text-foreground">
                          {p.recon_run_count}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-subtle">Tokens</dt>
                        <dd
                          className="font-semibold tabular-nums text-accent"
                          title={tokenBreakdown || undefined}
                        >
                          {Number(p.total_tokens || 0).toLocaleString()}
                        </dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      onClick={() => handleLaunchScan(p.id)}
                      className="btn btn-secondary btn-sm shrink-0"
                    >
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      Scan
                    </button>
                  </div>
                </Card>
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-programme-title"
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 260 }}
              className="card w-full max-w-lg overflow-hidden p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-border px-5 py-4">
                <h2
                  id="add-programme-title"
                  className="text-lg font-semibold text-foreground"
                >
                  Add program
                </h2>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="icon-btn"
                  aria-label="Close dialog"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-5 p-5">
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
                  >
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="prog-name" className="label mb-1.5 block">
                    Programme name
                  </label>
                  <input
                    id="prog-name"
                    className="input"
                    required
                    autoFocus
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Acme Bug Bounty"
                  />
                </div>

                <div>
                  <label htmlFor="prog-platform" className="label mb-1.5 block">
                    Platform
                  </label>
                  <select
                    id="prog-platform"
                    className="select"
                    value={formPlatform}
                    onChange={(e) => setFormPlatform(e.target.value)}
                  >
                    <option value="private">Private</option>
                    <option value="hackerone">HackerOne</option>
                    <option value="bugcrowd">Bugcrowd</option>
                    <option value="intigriti">Intigriti</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="prog-scope" className="label mb-1.5 block">
                    In-scope domains{" "}
                    <span className="font-normal text-subtle">(one per line)</span>
                  </label>
                  <textarea
                    id="prog-scope"
                    className="textarea font-mono text-sm"
                    required
                    rows={4}
                    value={formScope}
                    onChange={(e) => setFormScope(e.target.value)}
                    placeholder={"*.example.com\napi.example.com\nexample.com"}
                  />
                </div>

                <div>
                  <label htmlFor="prog-oos" className="label mb-1.5 block">
                    Out-of-scope patterns{" "}
                    <span className="font-normal text-subtle">(optional)</span>
                  </label>
                  <textarea
                    id="prog-oos"
                    className="textarea font-mono text-sm"
                    rows={2}
                    value={formOutOfScope}
                    onChange={(e) => setFormOutOfScope(e.target.value)}
                    placeholder={"support\\.example\\.com\nstaging\\..*"}
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="btn btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn btn-primary flex-1"
                  >
                    {submitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    )}
                    Create
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
