"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Search,
  Globe,
  Bell,
  Loader2,
  Network,
  ShieldCheck,
  Database,
  FileKey2,
  BookUser,
  Play,
  Eye,
} from "lucide-react";
import { Card, PageHeader } from "@/components/ui";

type AssetType = "hosts" | "dns" | "certs" | "whois";

interface Facet { value: string; count: number }
interface Facets { ports: Facet[]; tech: Facet[]; statuses: Facet[]; issuers: Facet[]; recordTypes: Facet[] }

const SAMPLES: Record<AssetType, string[]> = {
  hosts: ["technology:nginx", "port:8443", "status:200 title:login", "host:*.box.com AND port:443", "tls:true"],
  dns: ["type:MX", "name:*.box.com", "value:amazonaws", "type:TXT value:spf"],
  certs: ["cert.issuer:Let's Encrypt", "expiring:30", "san:*.box.com"],
  whois: ["whois.registrar:MarkMonitor", "whois:privacy"],
};

const TYPE_META: Record<AssetType, { label: string; icon: typeof Globe; hint: string }> = {
  hosts: { label: "Hosts", icon: Globe, hint: "host:*.box.com technology:nginx port:443 status:200 title:\"login\" tls:true favicon:<hash>" },
  dns: { label: "DNS", icon: Database, hint: "name:*.box.com type:MX value:google" },
  certs: { label: "Certificates", icon: FileKey2, hint: "cert.issuer:\"Let's Encrypt\" san:*.box.com expiring:30" },
  whois: { label: "WHOIS", icon: BookUser, hint: "whois.registrar:MarkMonitor whois:privacy" },
};

export default function ExplorePage() {
  const [type, setType] = useState<AssetType>("hosts");
  const [q, setQ] = useState("");
  const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
  const [programmeId, setProgrammeId] = useState("");
  const [data, setData] = useState<{ rows: Record<string, any>[]; total: number; facets?: Facets; stats?: Record<string, any> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [notice, setNotice] = useState("");
  const [graph, setGraph] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [graphSeed, setGraphSeed] = useState("");
  const [ingesting, setIngesting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(""), 5000); };

  useEffect(() => {
    fetch("/api/programmes").then((r) => r.json()).then((d) => setProgrammes(d.programmes || []));
  }, []);

  const runSearch = useCallback(
    async (query = q, t = type, off = 0) => {
      setLoading(true);
      const params = new URLSearchParams({ q: query, type: t, limit: "50", offset: String(off) });
      if (programmeId) params.set("programmeId", programmeId);
      const res = await fetch(`/api/explore?${params}`);
      const d = await res.json();
      if (!res.ok) flash(d.error || "Search failed");
      setData(d);
      setOffset(off);
      setLoading(false);
    },
    [q, type, programmeId]
  );

  useEffect(() => {
    runSearch("", "hosts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programmeId]);

  const refine = (term: string) => {
    const next = q ? `${q} AND ${term}` : term;
    setQ(next);
    runSearch(next);
  };

  const watchQuery = async () => {
    const name = prompt("Name this watch rule:", q.slice(0, 40) || "New watch");
    if (!name) return;
    const res = await fetch("/api/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, query: q, asset_type: type, programmeId: programmeId || undefined }),
    });
    flash(res.ok ? `Watching "${name}" — you'll be alerted on new matches` : "Failed to create watch");
  };

  const loadGraph = async (seed: string) => {
    setGraph(null);
    setGraphSeed(seed);
    const res = await fetch(`/api/explore/graph?seed=${encodeURIComponent(seed)}`);
    setGraph(await res.json());
  };

  const runIngest = async () => {
    const domain = prompt("Domain to ingest (runs httpx+dnsx+whois+favicon+certs):", graphSeed || "box.com");
    if (!domain) return;
    setIngesting(true);
    const res = await fetch("/api/explore/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain, programmeId: programmeId || undefined }),
    });
    const d = await res.json();
    setIngesting(false);
    flash(res.ok ? `Ingested ${domain}: ${JSON.stringify(d.result)}` : d.error || "Ingest failed");
    runSearch();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Explore"
        description="Attack-surface search engine — query your inventory with field syntax across hosts, DNS, certificates and WHOIS."
        icon={Search}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={programmeId}
              onChange={(e) => setProgrammeId(e.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value="">All programmes</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              onClick={runIngest}
              disabled={ingesting}
              className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-2 disabled:opacity-50"
            >
              {ingesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Ingest domain
            </button>
          </div>
        }
      />

      {notice && <div className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">{notice}</div>}

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder={TYPE_META[type].hint}
            className="w-full rounded-xl border border-border bg-surface-1 py-3 pl-11 pr-4 font-mono text-sm text-foreground outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={() => runSearch()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Search
        </button>
        <button
          onClick={watchQuery}
          title="Alert me when new assets match this query"
          className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm text-foreground hover:bg-surface-2"
        >
          <Bell className="h-4 w-4" /> Watch
        </button>
      </div>

      {/* Type tabs */}
      <div className="flex gap-2">
        {(Object.keys(TYPE_META) as AssetType[]).map((t) => {
          const M = TYPE_META[t];
          return (
            <button
              key={t}
              onClick={() => { setType(t); runSearch(q, t); }}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                type === t ? "bg-accent/15 text-accent" : "border border-border text-muted-foreground hover:bg-surface-2"
              }`}
            >
              <M.icon className="h-4 w-4" /> {M.label}
            </button>
          );
        })}
      </div>

      {/* Samples */}
      {SAMPLES[type] && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Try:</span>
          {SAMPLES[type].map((s) => (
            <button key={s} onClick={() => { setQ(s); runSearch(s); }} className="rounded bg-surface-2 px-2 py-1 font-mono hover:bg-accent/15 hover:text-accent">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Facets */}
        <div className="space-y-3">
          {data?.facets && (
            <>
              <FacetCard title="Top Technologies" items={data.facets.tech} onPick={(v) => refine(`technology:${v}`)} show={type === "hosts"} />
              <FacetCard title="Top Ports" items={data.facets.ports} onPick={(v) => refine(`port:${v}`)} show={type === "hosts"} />
              <FacetCard title="Status Codes" items={data.facets.statuses} onPick={(v) => refine(`status:${v}`)} show={type === "hosts"} />
              <FacetCard title="Cert Issuers" items={data.facets.issuers} onPick={(v) => refine(`cert.issuer:"${v}"`)} show={type === "certs"} />
              <FacetCard title="Record Types" items={data.facets.recordTypes} onPick={(v) => refine(`type:${v}`)} show={type === "dns"} />
            </>
          )}
          {data?.stats && (
            <Card className="p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Portfolio</h3>
              <div className="space-y-1 text-xs text-foreground">
                <div className="flex justify-between"><span>Assets</span><b>{data.stats.assets as number}</b></div>
                <div className="flex justify-between"><span>DNS records</span><b>{data.stats.dnsRecords as number}</b></div>
                <div className="flex justify-between"><span>Certificates</span><b>{data.stats.certs as number}</b></div>
                <div className="flex justify-between text-amber-300"><span>Certs expiring ≤30d</span><b>{data.stats.expiringCerts30d as number}</b></div>
              </div>
            </Card>
          )}
        </div>

        {/* Results */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{data ? `${data.total.toLocaleString()} results` : "…"}</span>
            <div className="flex gap-2">
              <button disabled={offset === 0 || loading} onClick={() => runSearch(q, type, Math.max(0, offset - 50))} className="rounded border border-border px-3 py-1 text-xs disabled:opacity-40">← Prev</button>
              <button disabled={!data || offset + 50 >= data.total || loading} onClick={() => runSearch(q, type, offset + 50)} className="rounded border border-border px-3 py-1 text-xs disabled:opacity-40">Next →</button>
            </div>
          </div>

          {loading && <Card className="p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></Card>}
          {!loading && data?.rows.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No assets match. Run a scan first, or click <b>Ingest domain</b> to pull live data into the inventory.
            </Card>
          )}

          {!loading && data?.rows.map((r, i) => (
            <ResultCard key={i} row={r} type={type} refine={refine} loadGraph={loadGraph} />
          ))}
        </div>
      </div>

      {/* Threat graph */}
      {graphSeed && (
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Network className="h-4 w-4" /> Threat graph — {graphSeed}
            <button onClick={() => setGraphSeed("")} className="ml-auto text-xs text-muted-foreground hover:text-foreground">close</button>
          </h3>
          {!graph ? (
            <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : (
            <GraphView nodes={graph.nodes} edges={graph.edges} />
          )}
        </Card>
      )}
    </div>
  );
}

function FacetCard({ title, items, onPick, show }: { title: string; items: Facet[]; onPick: (v: string) => void; show: boolean }) {
  if (!show || !items?.length) return null;
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</h3>
      <div className="space-y-1">
        {items.map((f) => (
          <button key={f.value} onClick={() => onPick(f.value)} className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs hover:bg-surface-2">
            <span className="truncate font-mono text-foreground">{f.value}</span>
            <span className="ml-2 text-muted-foreground">{f.count}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}

function Badge({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} title={`refine: ${label}:${value}`} className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent/15 hover:text-accent">
      {label}:{value}
    </button>
  );
}

function ResultCard({ row, type, refine, loadGraph }: { row: Record<string, any>; type: AssetType; refine: (t: string) => void; loadGraph: (s: string) => void }) {
  if (type === "hosts") {
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Globe className="h-4 w-4 text-accent" />
          <button onClick={() => refine(`host:${row.host}`)} className="font-mono text-sm font-semibold text-foreground hover:text-accent">{row.host}</button>
          {row.ip && <Badge label="ip" value={row.ip} onClick={() => refine(`ip:${row.ip}`)} />}
          {row.status && <Badge label="status" value={String(row.status)} onClick={() => refine(`status:${row.status}`)} />}
          {row.tls && Object.keys(row.tls).length > 0 && <ShieldCheck className="h-4 w-4 text-emerald-400" />}
          <button onClick={() => loadGraph(row.host)} title="threat graph" className="ml-auto rounded border border-border p-1.5 text-muted-foreground hover:text-accent"><Network className="h-4 w-4" /></button>
        </div>
        {row.title && <p className="mt-1 text-xs text-muted-foreground">{row.title}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(row.ports || []).map((p: number) => <Badge key={p} label="port" value={String(p)} onClick={() => refine(`port:${p}`)} />)}
          {(row.tech || []).map((t: string) => <Badge key={t} label="tech" value={t} onClick={() => refine(`technology:${t}`)} />)}
          {row.favicon_hash && <Badge label="favicon" value={row.favicon_hash} onClick={() => refine(`favicon:${row.favicon_hash}`)} />}
        </div>
      </Card>
    );
  }
  if (type === "dns") {
    return (
      <Card className="flex flex-wrap items-center gap-2 p-3">
        <button onClick={() => refine(`name:${row.name}`)} className="font-mono text-sm text-foreground hover:text-accent">{row.name}</button>
        <Badge label="type" value={row.type} onClick={() => refine(`type:${row.type}`)} />
        <button onClick={() => refine(`value:${row.value}`)} className="truncate font-mono text-xs text-muted-foreground hover:text-accent">{row.value}</button>
      </Card>
    );
  }
  if (type === "certs") {
    const expiring = row.not_after && new Date(row.not_after) < new Date(Date.now() + 30 * 864e5);
    return (
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <FileKey2 className="h-4 w-4 text-accent" />
          <button onClick={() => refine(`cn:${row.subject_cn}`)} className="font-mono text-sm font-semibold text-foreground hover:text-accent">{row.subject_cn}</button>
          {expiring && <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">expiring ≤30d</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {row.issuer_org && <Badge label="issuer" value={row.issuer_org} onClick={() => refine(`cert.issuer:"${row.issuer_org}"`)} />}
          {row.not_after && <Badge label="expires" value={String(row.not_after).slice(0, 10)} />}
          {(row.san || []).slice(0, 4).map((s: string) => <Badge key={s} label="san" value={s} onClick={() => refine(`san:${s}`)} />)}
          {(row.san || []).length > 4 && <span className="text-[10px] text-muted-foreground">+{row.san.length - 4} SANs</span>}
        </div>
      </Card>
    );
  }
  // whois
  const w = row.whois || {};
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-2">
        <BookUser className="h-4 w-4 text-accent" />
        <button onClick={() => refine(`host:${row.host}`)} className="font-mono text-sm font-semibold text-foreground hover:text-accent">{row.host}</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {w.registrar && <Badge label="registrar" value={w.registrar} onClick={() => refine(`whois.registrar:"${w.registrar}"`)} />}
        {w.created && <Badge label="created" value={String(w.created).slice(0, 10)} />}
        {w.expires && <Badge label="expires" value={String(w.expires).slice(0, 10)} />}
        {w.org && <Badge label="org" value={String(w.org).slice(0, 30)} />}
      </div>
    </Card>
  );
}

/** Lightweight SVG force-graph (no deps). */
function GraphView({ nodes, edges }: { nodes: { id: string; kind: string }[]; edges: { from: string; to: string }[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    const W = 900, H = 460;
    const p: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    nodes.forEach((n, i) => {
      const a = (i / nodes.length) * Math.PI * 2;
      p[n.id] = { x: W / 2 + Math.cos(a) * 180, y: H / 2 + Math.sin(a) * 160, vx: 0, vy: 0 };
    });
    // simple force simulation
    for (let iter = 0; iter < 220; iter++) {
      for (const a of nodes) for (const b of nodes) {
        if (a.id === b.id) continue;
        const dx = p[a.id].x - p[b.id].x, dy = p[a.id].y - p[b.id].y;
        const d2 = Math.max(dx * dx + dy * dy, 40);
        const f = 2600 / d2;
        p[a.id].vx += (dx / Math.sqrt(d2)) * f;
        p[a.id].vy += (dy / Math.sqrt(d2)) * f;
      }
      for (const e of edges) {
        const a = p[e.from], b = p[e.to];
        if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.max(Math.hypot(dx, dy), 1);
        const f = (d - 90) * 0.004;
        a.vx += dx * f; a.vy += dy * f;
        b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) {
        const o = p[n.id];
        o.x = Math.min(W - 20, Math.max(20, o.x + o.vx * 0.3));
        o.y = Math.min(H - 20, Math.max(20, o.y + o.vy * 0.3));
        o.vx *= 0.6; o.vy *= 0.6;
      }
    }
    const out: Record<string, { x: number; y: number }> = {};
    for (const id of Object.keys(p)) out[id] = { x: p[id].x, y: p[id].y };
    setPos(out);
  }, [nodes, edges]);

  const colors: Record<string, string> = {
    apex: "#f59e0b", host: "#38bdf8", ip: "#a78bfa", cert: "#34d399", dns: "#94a3b8", cname: "#fb7185",
  };

  return (
    <div ref={ref} className="overflow-x-auto">
      <svg width="900" height="460" className="mx-auto">
        {edges.map((e, i) => {
          const a = pos[e.from], b = pos[e.to];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#334155" strokeWidth="1" />;
        })}
        {nodes.map((n) => {
          const o = pos[n.id];
          if (!o) return null;
          return (
            <g key={n.id}>
              <circle cx={o.x} cy={o.y} r={n.kind === "apex" ? 9 : 5} fill={colors[n.kind] || "#64748b"} />
              <text x={o.x + 8} y={o.y + 3} fontSize="9" fill="#cbd5e1" fontFamily="monospace">
                {n.id.length > 28 ? n.id.slice(0, 28) + "…" : n.id}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
