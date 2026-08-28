import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/shadow-it?programmeId=xxx&limit=10
 * Detect potential shadow IT - assets not in scope but related to known assets
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    // Get in-scope patterns for this programme
    const scopeResult = await query(
      `SELECT scope FROM programmes WHERE id = $1`,
      [programmeId]
    );
    
    const scope = scopeResult.rows[0]?.scope || { in_scope: [], out_of_scope: [] };
    const inScopePatterns = scope.in_scope || [];
    
    // If no scope defined, return empty
    if (inScopePatterns.length === 0) {
      return NextResponse.json({ programmeId, candidates: [] });
    }

    // Build a query to find assets that might be related but not in scope
    // Look for:
    // 1. Assets with same base domain but not matching scope patterns
    // 2. Assets sharing favicon hash with in-scope assets
    // 3. Assets sharing SSL fingerprint with in-scope assets
    // 4. Assets in same ASN/org as in-scope assets
    // 5. Cloud assets not linked to programme

    const shadowQuery = `
      WITH in_scope_assets AS (
        SELECT id, host, favicon_hash, tls, ip
        FROM assets
        WHERE programme_id = $1
          AND (
            ${inScopePatterns.map((_, i) => `host ILIKE $${i + 2}`).join(' OR ')}
          )
      ),
      candidate_assets AS (
        SELECT a.*, s.risk_score, s.tier
        FROM assets a
        LEFT JOIN asset_scores s ON s.asset_id = a.id
        WHERE a.programme_id = $1
          AND NOT (
            ${inScopePatterns.map((_, i) => `a.host ILIKE $${i + 2}`).join(' OR ')}
          )
          AND a.status IS NOT NULL
      )
      SELECT 
        ca.host,
        ca.ip,
        ca.tech,
        ca.title,
        ca.status,
        ca.favicon_hash,
        ca.tls,
        COALESCE(s.risk_score, 0) AS risk_score,
        COALESCE(s.tier, 'info') AS tier,
        CASE 
          WHEN ca.favicon_hash IS NOT NULL AND EXISTS (
            SELECT 1 FROM in_scope_assets isa 
            WHERE isa.favicon_hash = ca.favicon_hash
          ) THEN 'Shared favicon with in-scope asset'
          WHEN ca.tls IS NOT NULL AND ca.tls <> '{}'::jsonb AND EXISTS (
            SELECT 1 FROM in_scope_assets isa 
            WHERE isa.tls->>'cn' = ca.tls->>'cn'
          ) THEN 'Shared SSL certificate with in-scope asset'
          WHEN ca.ip IS NOT NULL AND EXISTS (
            SELECT 1 FROM in_scope_assets isa 
            WHERE isa.ip = ca.ip
          ) THEN 'Shared IP with in-scope asset'
          WHEN EXISTS (
            SELECT 1 FROM asset_relationships ar
            JOIN assets a2 ON a2.id = ar.target_asset_id
            WHERE ar.source_asset_id = ca.id
              AND ar.relationship IN ('same_asn', 'same_org', 'same_cloud')
              AND a2.programme_id = $1
          ) THEN 'Related via ASN/Org/Cloud to in-scope asset'
          ELSE 'Discovered outside defined scope'
        END AS reason
      FROM candidate_assets ca
      LEFT JOIN asset_scores s ON s.asset_id = ca.id
      ORDER BY risk_score DESC, ca.last_seen DESC
      LIMIT $${inScopePatterns.length + 2}
    `;

    const params = [programmeId, ...inScopePatterns.map((p: string) => p.replace('*.', '%')), limit];
    const result = await query(shadowQuery, params);

    return NextResponse.json({
      programmeId,
      candidates: result.rows.map((r: any) => ({
        host: r.host,
        ip: r.ip,
        tech: r.tech,
        title: r.title,
        status: r.status,
        risk_score: parseFloat(r.risk_score),
        tier: r.tier,
        reason: r.reason,
      })),
    });
  } catch (error) {
    console.error('shadow it:', error);
    return NextResponse.json({ error: 'Failed to detect shadow IT' }, { status: 500 });
  }
}