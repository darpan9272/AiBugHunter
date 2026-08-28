/**
 * ingest.ts — Feed recon results into the attack-surface inventory.
 *
 * Sources:
 *   run_httpx_probe  → assets (host, ip, status, title, tech, tls)
 *   run_dnsx         → asset_dns (A/CNAME records)
 *   run_domain_info  → asset_dns (MX/NS/TXT/SOA)
 *   run_crtsh        → asset_certs (issuer, CN, SAN, validity)
 *   run_whois        → assets.whois
 *   run_favicon_hash → assets.favicon_hash
 */

import { query } from './db';
import { getToolServers, callTool, refreshToolServer } from './tools';

async function callReconTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown> | { error: string }> {
  const servers = await getToolServers(true);
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const s of servers) {
      let tools = s.tools_cache || [];
      if (!tools.some((t: { name: string }) => t.name === name) && attempt === 0) {
        // cache may be stale (new tools added) — refresh once
        tools = (await refreshToolServer(s)).tools;
      }
      const def = tools.find((t: { name: string }) => t.name === name);
      if (def) {
        const out = await callTool({ server: s, def }, args);
        if (!out.ok) return { error: out.error || 'tool failed' };
        try {
          return JSON.parse(out.result || '{}');
        } catch {
          return { error: 'unparseable tool output' };
        }
      }
    }
  }
  return { error: `tool ${name} not available` };
}

/** Upsert one host asset. */
async function upsertAsset(programmeId: string | null, data: {
  host: string; ip?: string | null; ports?: number[]; tech?: string[];
  title?: string | null; status?: number | null; tls?: Record<string, unknown>;
  favicon_hash?: string | null; whois?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `INSERT INTO assets (programme_id, host, ip, ports, tech, title, status, tls, favicon_hash, whois)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (programme_id, host) DO UPDATE SET
       ip = COALESCE(EXCLUDED.ip, assets.ip),
       ports = CASE WHEN jsonb_array_length(EXCLUDED.ports) > 0 THEN EXCLUDED.ports ELSE assets.ports END,
       tech = CASE WHEN jsonb_array_length(EXCLUDED.tech) > 0 THEN EXCLUDED.tech ELSE assets.tech END,
       title = COALESCE(EXCLUDED.title, assets.title),
       status = COALESCE(EXCLUDED.status, assets.status),
       tls = CASE WHEN EXCLUDED.tls <> '{}'::jsonb THEN EXCLUDED.tls ELSE assets.tls END,
       favicon_hash = COALESCE(EXCLUDED.favicon_hash, assets.favicon_hash),
       whois = CASE WHEN EXCLUDED.whois <> '{}'::jsonb THEN EXCLUDED.whois ELSE assets.whois END,
       last_seen = NOW()`,
    [
      programmeId, data.host, data.ip || null, JSON.stringify(data.ports || []),
      JSON.stringify(data.tech || []), data.title || null, data.status ?? null,
      JSON.stringify(data.tls || {}), data.favicon_hash || null, JSON.stringify(data.whois || {}),
    ]
  );
}

/** Ingest live web hosts via httpx probe (creates rich assets). */
export async function ingestHttpxProbe(programmeId: string | null, domains: string[]): Promise<{ ingested: number; error?: string }> {
  const res = await callReconTool('run_httpx_probe', { targets: domains, timeout: 240 });
  if ('error' in res) return { ingested: 0, error: res.error as string };
  const hosts = (res.results as Record<string, unknown>[]) || (res.hosts as Record<string, unknown>[]) || [];
  let n = 0;
  for (const h of hosts) {
    const url = (h.url as string) || '';
    const host = (h.host as string) || url.replace(/^https?:\/\//, '').split('/')[0];
    if (!host) continue;
    const tech: string[] = [];
    if (Array.isArray(h.tech)) tech.push(...(h.tech as string[]));
    if (h.webserver && typeof h.webserver === 'string') tech.push(h.webserver);
    const ports: number[] = [];
    const portNum = parseInt(String(h.port || ''));
    if (portNum) ports.push(portNum);
    else if (url.startsWith('https')) ports.push(443);
    else if (url.startsWith('http')) ports.push(80);
    await upsertAsset(programmeId, {
      host, ip: (h.ip as string) || null, ports, tech: [...new Set(tech)],
      title: (h.title as string) || null, status: (h.status_code as number) ?? null,
    });
    n++;
  }
  return { ingested: n };
}

/** Ingest DNS records via dnsx (A/CNAME). */
export async function ingestDnsx(programmeId: string | null, domains: string[]): Promise<{ ingested: number; error?: string }> {
  const res = await callReconTool('run_dnsx', { domains, timeout: 300 });
  if ('error' in res) return { ingested: 0, error: res.error as string };
  const records = (res.records as Record<string, unknown>[]) || [];
  let n = 0;
  for (const r of records) {
    const name = r.host as string;
    if (!name) continue;
    for (const ip of (r.a as string[]) || []) {
      await query(
        `INSERT INTO asset_dns (programme_id, name, type, value) VALUES ($1, $2, 'A', $3)
         ON CONFLICT (programme_id, name, type, value) DO UPDATE SET last_seen = NOW()`,
        [programmeId, name, ip]
      );
      n++;
    }
    const cname = r.cname as string;
    if (cname) {
      await query(
        `INSERT INTO asset_dns (programme_id, name, type, value) VALUES ($1, $2, 'CNAME', $3)
         ON CONFLICT (programme_id, name, type, value) DO UPDATE SET last_seen = NOW()`,
        [programmeId, name, cname]
      );
      n++;
    }
    // also create/update the asset's IP
    const ips = (r.a as string[]) || [];
    if (ips.length) await upsertAsset(programmeId, { host: name, ip: ips[0] });
  }
  return { ingested: n };
}

/** Ingest MX/NS/TXT via domain_info. */
export async function ingestDomainInfo(programmeId: string | null, domain: string): Promise<{ ingested: number; error?: string }> {
  const res = await callReconTool('run_domain_info', { domain });
  if ('error' in res) return { ingested: 0, error: res.error as string };
  const records = (res.records as Record<string, unknown>) || {};
  let n = 0;
  for (const [type, values] of Object.entries(records)) {
    if (type === 'wildcard_dns' || !Array.isArray(values)) continue;
    for (const v of values as string[]) {
      await query(
        `INSERT INTO asset_dns (programme_id, name, type, value) VALUES ($1, $2, $3, $4)
         ON CONFLICT (programme_id, name, type, value) DO UPDATE SET last_seen = NOW()`,
        [programmeId, domain, type, v]
      );
      n++;
    }
  }
  await upsertAsset(programmeId, { host: domain, whois: { wildcard: String(!!records.wildcard_dns) } });
  return { ingested: n };
}

/** Ingest certificates from crt.sh. */
export async function ingestCerts(programmeId: string | null, domain: string): Promise<{ ingested: number; error?: string }> {
  const servers = await getToolServers(true);
  const server = servers.find((s) => (s.tools_cache || []).some((t: { name: string }) => t.name === 'run_crtsh'));
  if (!server) return { ingested: 0, error: 'crt.sh tool unavailable' };
  const def = (server.tools_cache || []).find((t: { name: string }) => t.name === 'run_crtsh')!;
  const out = await callTool({ server, def }, { domain, raw: true });
  // raw mode: return full entries? fall back to parsing subdomains only if raw unsupported
  if (!out.ok) return { ingested: 0, error: out.error || 'crtsh failed' };
  try {
    const data = JSON.parse(out.result || '{}');
    const certs = (data.certificates as Record<string, unknown>[]) || [];
    let n = 0;
    for (const c of certs) {
      await query(
        `INSERT INTO asset_certs (programme_id, sha256, subject_cn, san, issuer_org, not_before, not_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (programme_id, sha256) DO NOTHING`,
        [
          programmeId, (c.sha256 as string) || `${domain}-${n}`, (c.common_name as string) || null,
          JSON.stringify(c.san || []), (c.issuer_org as string) || null,
          c.not_before || null, c.not_after || null,
        ]
      );
      n++;
    }
    return { ingested: n };
  } catch {
    return { ingested: 0, error: 'cert parse failed' };
  }
}

/** Ingest WHOIS for a domain onto its asset. */
export async function ingestWhois(programmeId: string | null, domain: string): Promise<{ ingested: number; error?: string }> {
  const res = await callReconTool('run_whois', { domain });
  if ('error' in res) return { ingested: 0, error: res.error as string };
  await upsertAsset(programmeId, { host: domain, whois: res as Record<string, unknown> });
  return { ingested: 1 };
}

/** Compute + store favicon mmh3 hashes for live assets. */
export async function ingestFavicons(programmeId: string | null, limit = 20): Promise<{ ingested: number; error?: string }> {
  const rows = await query(
    `SELECT host FROM assets WHERE programme_id IS NOT DISTINCT FROM $1 AND status IS NOT NULL AND favicon_hash IS NULL LIMIT $2`,
    [programmeId, limit]
  );
  let n = 0;
  for (const r of rows.rows) {
    const res = await callReconTool('run_favicon_hash', { host: r.host });
    if ('error' in res) continue;
    const hash = res.favicon_hash as string;
    if (hash) {
      await query(`UPDATE assets SET favicon_hash = $1 WHERE host = $2 AND programme_id IS NOT DISTINCT FROM $3`, [hash, r.host, programmeId]);
      n++;
    }
  }
  return { ingested: n };
}

/** Full ingestion pass for a domain (used by scan hook + manual button). */
export async function ingestDomain(programmeId: string | null, domain: string, liveHosts?: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { domain };
  const di = await ingestDomainInfo(programmeId, domain);
  out.dns_records = di.ingested;
  const subs = [domain, `www.${domain}`, `app.${domain}`, `api.${domain}`, `mail.${domain}`];
  const dx = await ingestDnsx(programmeId, liveHosts?.length ? liveHosts.slice(0, 200) : subs);
  out.dnsx = dx.ingested;
  if (liveHosts?.length) {
    const hx = await ingestHttpxProbe(programmeId, liveHosts.slice(0, 100));
    out.assets = hx.ingested;
  }
  const w = await ingestWhois(programmeId, domain);
  out.whois = w.ingested;
  const f = await ingestFavicons(programmeId, 15);
  out.favicons = f.ingested;
  return out;
}
