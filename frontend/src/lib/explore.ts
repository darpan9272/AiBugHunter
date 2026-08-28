/**
 * explore.ts — Attack-surface search engine (Profundis-style).
 *
 * Query syntax:
 *   host:box.com            field match (contains)
 *   *.box.com               wildcard (bare or with host:)
 *   port:443  port:80,443   numeric / list
 *   tech:nginx  title:"Box login"  status:200
 *   ip:74.112.186.  favicon:-1775...  tls:true
 *   cert.issuer:Let's Encrypt  cert.cn:*.box.com  san:foo.box.com
 *   dns.type:MX  dns.value:google  whois.registrar:MarkMonitor
 *   foo bar                 bare terms = full text (AND)
 *   a OR b                  top-level OR groups
 *   -port:22  NOT title:x   negation
 */

import { query } from './db';

export type AssetType = 'hosts' | 'dns' | 'certs' | 'whois';

interface Term {
  field: string | null; // null = bare full-text term
  value: string;
  negated: boolean;
}

/** Split query into OR-groups of AND-terms, respecting quotes. */
export function parseQuery(q: string): Term[][] {
  const orGroups: Term[][] = [[]];
  const tokenRe = /(?:[^\s"]+|"[^"]*")+/g;
  const tokens = q.match(tokenRe) || [];
  let negateNext = false;

  for (let tok of tokens) {
    if (/^OR$/i.test(tok)) {
      if (orGroups[orGroups.length - 1].length > 0) orGroups.push([]);
      continue;
    }
    if (/^NOT$/i.test(tok)) {
      negateNext = true;
      continue;
    }
    let negated = negateNext;
    negateNext = false;
    if (tok.startsWith('-') && tok.length > 1) {
      negated = true;
      tok = tok.slice(1);
    }
    const m = tok.match(/^([a-z][a-z_.]*):(.*)$/i);
    let field: string | null = null;
    let value = tok;
    if (m) {
      field = m[1].toLowerCase();
      value = m[2];
    }
    value = value.replace(/^"(.*)"$/, '$1');
    if (!value) continue;
    orGroups[orGroups.length - 1].push({ field, value, negated });
  }
  return orGroups.filter((g) => g.length > 0);
}

const FIELD_ALIASES: Record<string, string> = {
  tech: 'technology',
  product: 'technology',
  cn: 'cert.cn',
  issuer: 'cert.issuer',
  ssl: 'tls',
  has_tls: 'tls',
  registrar: 'whois.registrar',
  dns: 'dns.value',
  record: 'dns.type',
  type: 'dns.type',
};

interface SqlParts {
  where: string;
  params: unknown[];
}

function like(v: string): string {
  return `%${v.replace(/[%_]/g, '')}%`;
}

function wildcardToLike(v: string): string {
  return v.replace(/[%_]/g, '').replace(/\*/g, '%');
}

/** Compile one AND-group into SQL for the given asset type. */
function compileGroup(terms: Term[], type: AssetType, startIdx: number): SqlParts {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startIdx;
  const push = (sql: string, ...vals: unknown[]) => {
    clauses.push(`(${sql})`);
    params.push(...vals);
  };

  for (const t of terms) {
    const field = FIELD_ALIASES[t.field || ''] ?? t.field;
    const NOT = t.negated ? 'NOT ' : '';

    switch (type) {
      case 'hosts': {
        if (!field) {
          push(`${NOT}(host ILIKE $${++i} OR title ILIKE $${++i} OR ip ILIKE $${++i} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(tech) x WHERE x ILIKE $${++i}))`,
            like(t.value), like(t.value), like(t.value), like(t.value));
        } else if (field === 'host') push(`${NOT}host ILIKE $${++i}`, wildcardToLike(t.value));
        else if (field === 'ip') push(`${NOT}ip ILIKE $${++i}`, wildcardToLike(t.value));
        else if (field === 'title') push(`${NOT}title ILIKE $${++i}`, like(t.value));
        else if (field === 'status') push(`${NOT}status = $${++i}`, parseInt(t.value) || 0);
        else if (field === 'technology') push(`${NOT}EXISTS (SELECT 1 FROM jsonb_array_elements_text(tech) x WHERE x ILIKE $${++i})`, like(t.value));
        else if (field === 'favicon') push(`${NOT}favicon_hash = $${++i}`, t.value);
        else if (field === 'tls') push(`${NOT}(tls <> '{}'::jsonb)`);
        else if (field === 'port') {
          const parts = t.value.split(',').map((p) => p.trim());
          const range = t.value.match(/^(\d+)-(\d+)$/);
          if (range) {
            push(`${NOT}EXISTS (SELECT 1 FROM jsonb_array_elements(ports) p WHERE (p::text)::int BETWEEN $${++i} AND $${++i})`, parseInt(range[1]), parseInt(range[2]));
          } else {
            const conds = parts.map(() => `ports @> $${++i}::jsonb`);
            push(`${NOT}(${conds.join(' OR ')})`, ...parts.map((p) => `[${parseInt(p) || 0}]`));
          }
        } else if (field === 'cert.issuer') push(`${NOT}tls->>'issuer' ILIKE $${++i}`, like(t.value));
        else if (field === 'cert.cn') push(`${NOT}tls->>'cn' ILIKE $${++i}`, wildcardToLike(t.value));
        else if (field === 'whois.registrar') push(`${NOT}whois->>'registrar' ILIKE $${++i}`, like(t.value));
        else if (field === 'whois') push(`${NOT}whois::text ILIKE $${++i}`, like(t.value));
        else push(`${NOT}(host ILIKE $${++i} OR title ILIKE $${++i})`, like(t.value), like(t.value));
        break;
      }
      case 'dns': {
        if (!field) push(`${NOT}(name ILIKE $${++i} OR value ILIKE $${++i})`, like(t.value), like(t.value));
        else if (field === 'host' || field === 'name') push(`${NOT}name ILIKE $${++i}`, wildcardToLike(t.value));
        else if (field === 'dns.type') push(`${NOT}type = $${++i}`, t.value.toUpperCase());
        else if (field === 'dns.value' || field === 'value') push(`${NOT}value ILIKE $${++i}`, like(t.value));
        else if (field === 'ip') push(`${NOT}value ILIKE $${++i}`, wildcardToLike(t.value));
        break;
      }
      case 'certs': {
        if (!field) push(`${NOT}(subject_cn ILIKE $${++i} OR issuer_org ILIKE $${++i} OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(san) x WHERE x ILIKE $${++i}))`, like(t.value), like(t.value), like(t.value));
        else if (field === 'cert.cn' || field === 'host') push(`${NOT}subject_cn ILIKE $${++i}`, wildcardToLike(t.value));
        else if (field === 'cert.issuer') push(`${NOT}issuer_org ILIKE $${++i}`, like(t.value));
        else if (field === 'san') push(`${NOT}EXISTS (SELECT 1 FROM jsonb_array_elements_text(san) x WHERE x ILIKE $${++i})`, wildcardToLike(t.value));
        else if (field === 'expiring') {
          const days = parseInt(t.value) || 30;
          push(`${NOT}not_after < NOW() + INTERVAL '1 day' * $${++i}`, days);
        }
        break;
      }
      case 'whois': {
        if (!field) push(`${NOT}(host ILIKE $${++i} OR whois::text ILIKE $${++i})`, like(t.value), like(t.value));
        else if (field === 'host') push(`${NOT}host ILIKE $${++i}`, wildcardToLike(t.value));
        else if (field === 'whois.registrar') push(`${NOT}whois->>'registrar' ILIKE $${++i}`, like(t.value));
        else if (field === 'whois') push(`${NOT}whois::text ILIKE $${++i}`, like(t.value));
        break;
      }
    }
  }
  return { where: clauses.join(' AND ') || 'TRUE', params };
}

const TABLE: Record<AssetType, string> = {
  hosts: 'assets',
  dns: 'asset_dns',
  certs: 'asset_certs',
  whois: 'assets',
};

export async function search(opts: {
  type: AssetType;
  q?: string;
  programmeId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: unknown[]; total: number; error?: string }> {
  const { type, q = '', programmeId, limit = 50, offset = 0 } = opts;
  try {
    const groups = parseQuery(q);
    const params: unknown[] = [];
    const orParts: string[] = [];
    let idx = 0;

    for (const g of groups) {
      const compiled = compileGroup(g, type, idx);
      idx += compiled.params.length;
      params.push(...compiled.params);
      orParts.push(compiled.where);
    }

    let where = groups.length ? `(${orParts.join(' OR ')})` : 'TRUE';
    if (programmeId) {
      where += ` AND programme_id = $${++idx}`;
      params.push(programmeId);
    }

    const table = TABLE[type];
    const order =
      type === 'hosts' ? 'last_seen DESC' :
      type === 'certs' ? 'not_after ASC NULLS LAST' : 'name ASC';

    const selectCols = type === 'whois' ? 'host, whois, last_seen' : '*';
    const [rows, count] = await Promise.all([
      query(`SELECT ${selectCols} FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT $${++idx} OFFSET $${++idx}`,
        [...params, limit, offset]),
      query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE ${where}`, params),
    ]);
    return { rows: rows.rows, total: count.rows[0].n };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { rows: [], total: 0, error: msg };
  }
}

/** Facet aggregations for the search sidebar (Profundis-style filters). */
export async function facets(programmeId?: string): Promise<Record<string, { value: string; count: number }[]>> {
  const scope = programmeId ? 'WHERE programme_id = $1' : '';
  const p = programmeId ? [programmeId] : [];
  const run = async (sql: string) => (await query(sql, p)).rows;

  const [ports, tech, statuses, issuers, recordTypes] = await Promise.all([
    run(`SELECT p::text AS value, COUNT(*)::int AS count FROM assets, jsonb_array_elements(ports) p ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    run(`SELECT x AS value, COUNT(*)::int AS count FROM assets, jsonb_array_elements_text(tech) x ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    run(`SELECT status::text AS value, COUNT(*)::int AS count FROM assets ${scope} ${scope ? 'AND' : 'WHERE'} status IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
    run(`SELECT issuer_org AS value, COUNT(*)::int AS count FROM asset_certs ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    run(`SELECT type AS value, COUNT(*)::int AS count FROM asset_dns ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
  ]);
  return { ports, tech, statuses, issuers, recordTypes };
}

/** Portfolio-level insights (Profundis "portfolio analysis"). */
export async function portfolioStats(programmeId?: string): Promise<Record<string, unknown>> {
  const scope = programmeId ? 'WHERE programme_id = $1' : '';
  const p = programmeId ? [programmeId] : [];
  const q = async (sql: string) => (await query(sql, p)).rows[0];

  return {
    assets: (await q(`SELECT COUNT(*)::int AS n FROM assets ${scope}`)).n,
    dnsRecords: (await q(`SELECT COUNT(*)::int AS n FROM asset_dns ${scope}`)).n,
    certs: (await q(`SELECT COUNT(*)::int AS n FROM asset_certs ${scope}`)).n,
    expiringCerts30d: (await q(
      `SELECT COUNT(*)::int AS n FROM asset_certs ${scope ? scope + ' AND' : 'WHERE'} not_after < NOW() + INTERVAL '30 days'`
    )).n,
    wildcardHosts: (await q(
      `SELECT COUNT(*)::int AS n FROM assets ${scope ? scope + ' AND' : 'WHERE'} whois->>'wildcard' = 'true'`
    )).n,
    withFavicon: (await q(
      `SELECT COUNT(*)::int AS n FROM assets ${scope ? scope + ' AND' : 'WHERE'} favicon_hash IS NOT NULL`
    )).n,
    topTech: (
      await query(
        `SELECT x AS tech, COUNT(*)::int AS count FROM assets, jsonb_array_elements_text(tech) x ${scope} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
        p
      )
    ).rows,
  };
}
