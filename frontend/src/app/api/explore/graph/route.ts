import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/explore/graph?seed=box.com&depth=2&max_nodes=500&include=subdomain,ip,cert,cname,san,asn,org,favicon,ssl_fp,cloud
 * Enhanced pivot graph with ASN, org, favicon, SSL fingerprint, cloud relationships.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const seed = (searchParams.get('seed') || '').replace(/\./g, '\\.').replace(/%/g, '');
    if (!seed) return NextResponse.json({ error: 'seed required' }, { status: 400 });

    const depth = Math.min(parseInt(searchParams.get('depth') || '2'), 3);
    const maxNodes = Math.min(parseInt(searchParams.get('max_nodes') || '500'), 1000);
    const includeParam = searchParams.get('include') || 'subdomain,ip,cert,cname,san,asn,org,favicon,ssl_fp,cloud';
    const include = includeParam.split(',').map(s => s.trim());
    const programmeId = searchParams.get('programmeId') || undefined;

    const nodes = new Map<string, { id: string; label: string; kind: string; meta?: any }>();
    const edges: { from: string; to: string; kind: string; meta?: any }[] = [];
    
    const addNode = (id: string, kind: string, label?: string, meta?: any) => {
      if (!nodes.has(id) && nodes.size < maxNodes) {
        nodes.set(id, { id, label: label || id, kind, meta });
      }
    };
    
    const addEdge = (from: string, to: string, kind: string, meta?: any) => {
      if (nodes.has(from) && nodes.has(to)) {
        edges.push({ from, to, kind, meta });
      }
    };

    const apex = seed.replace(/\\\./g, '.');
    addNode(apex, 'apex', apex);

    const like = `%.${apex}`;
    
    // Build scope filter
    const scopeFilter = programmeId ? 'AND programme_id = $1' : '';
    const scopeParams = programmeId ? [programmeId] : [];
    
    // 1. Subdomain → Apex (hosts)
    if (include.includes('subdomain')) {
      const assets = await query(
        `SELECT host, ip, tech, status, tls, favicon_hash, whois FROM assets WHERE (host ILIKE $1 OR host = $2) ${scopeFilter} LIMIT 200`,
        [like, apex, ...scopeParams]
      );
      
      for (const a of assets.rows) {
        addNode(a.host, 'host', a.host, { ip: a.ip, tech: a.tech, status: a.status });
        addEdge(a.host, apex, 'subdomain');
        
        // Host → IP
        if (a.ip && include.includes('ip')) {
          addNode(a.ip, 'ip', a.ip);
          addEdge(a.host, a.ip, 'resolves');
        }
        
        // Host → Cert (TLS)
        if (a.tls && typeof a.tls === 'object' && a.tls.cn && include.includes('cert')) {
          const cn = a.tls.cn as string;
          addNode(cn, 'cert', cn, { issuer: a.tls.issuer, expiry: a.tls.not_after });
          addEdge(a.host, cn, 'tls');
        }
        
        // Favicon hash
        if (a.favicon_hash && include.includes('favicon')) {
          const fp = `favicon:${a.favicon_hash}`;
          addNode(fp, 'favicon', `favicon:${a.favicon_hash.slice(0, 16)}...`);
          addEdge(a.host, fp, 'favicon');
        }
      }
    }
    
    // 2. DNS Records
    if (include.includes('cname') || include.includes('san') || include.includes('dns')) {
      const dns = await query(
        `SELECT name, type, value FROM asset_dns WHERE name ILIKE $1 ${scopeFilter} LIMIT 300`,
        [like, ...scopeParams]
      );
      
      for (const d of dns.rows) {
        addNode(d.name, 'dns', d.name, { type: d.type, value: d.value });
        addEdge(d.name, apex, 'dns');
        
        if (d.type === 'CNAME' && d.value && include.includes('cname')) {
          addNode(d.value, 'cname', d.value);
          addEdge(d.name, d.value, 'cname');
        }
      }
    }
    
    // 3. Certificates (CT logs + live)
    if (include.includes('cert') || include.includes('san')) {
      const certs = await query(
        `SELECT subject_cn, issuer_org, san, not_after, sha256 FROM asset_certs WHERE subject_cn ILIKE $1 ${scopeFilter} LIMIT 100`,
        [like, ...scopeParams]
      );
      
      for (const c of certs.rows) {
        if (c.subject_cn) {
          addNode(c.subject_cn, 'cert', c.subject_cn, { issuer: c.issuer_org, expiry: c.not_after });
          addEdge(c.subject_cn, apex, 'cert');
          
          // SAN siblings
          if (c.san && include.includes('san')) {
            for (const san of (c.san as string[]).slice(0, 10)) {
              if (san.endsWith(apex)) {
                addNode(san, 'host', san);
                addEdge(san, c.subject_cn, 'san');
              }
            }
          }
        }
      }
    }
    
    // 4. ASN / Organization / Cloud relationships (from asset_relationships table)
    if (include.some(x => ['asn', 'org', 'cloud', 'ssl_fp'].includes(x))) {
      // Get asset IDs for hosts we've found
      const hostIdsQuery = `
        SELECT id, host FROM assets 
        WHERE (host ILIKE $1 OR host = $2) ${scopeFilter}
      `;
      const hostRows = await query(hostIdsQuery, [like, apex, ...scopeParams]);
      const hostIds = hostRows.rows.map((r: any) => r.id);
      
      if (hostIds.length > 0) {
        const placeholders = hostIds.map((_, i) => `$${i + 1 + scopeParams.length}`).join(',');
        const relQuery = `
          SELECT ar.*, a1.host as source_host, a2.host as target_host
          FROM asset_relationships ar
          LEFT JOIN assets a1 ON a1.id = ar.source_asset_id
          LEFT JOIN assets a2 ON a2.id = ar.target_asset_id
          WHERE (ar.source_asset_id IN (${placeholders}) OR ar.target_asset_id IN (${placeholders}))
          AND ar.programme_id = $1
        `;
        const relParams = programmeId ? [programmeId, ...hostIds] : hostIds;
        
        try {
          const rels = await query(relQuery, relParams);
          
          for (const r of rels.rows) {
            if (!include.includes(r.relationship)) continue;
            
            const sourceLabel = r.source_host || r.source_asset_id;
            const targetLabel = r.target_host || r.target_asset_id;
            
            addNode(r.source_asset_id, r.relationship, sourceLabel, r.metadata);
            addNode(r.target_asset_id, r.relationship, targetLabel, r.metadata);
            addEdge(r.source_asset_id, r.target_asset_id, r.relationship, r.metadata);
          }
        } catch (e) {
          // Table might not exist yet
          console.log('asset_relationships query failed (table may not exist):', e);
        }
      }
    }

    return NextResponse.json({
      seed,
      nodes: [...nodes.values()].slice(0, maxNodes),
      edges: edges.slice(0, maxNodes * 2),
      counts: { nodes: nodes.size, edges: edges.length },
      included_types: include,
    });
  } catch (error) {
    console.error('graph:', error);
    return NextResponse.json({ error: 'Graph failed' }, { status: 500 });
  }
}
