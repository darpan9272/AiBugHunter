import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/scores?programmeId=xxx&minRisk=50&tier=high&limit=100
 * Get attack surface risk scores for assets.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const minRisk = parseFloat(searchParams.get('minRisk') || '0');
    const tier = searchParams.get('tier') || 'all';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    let where = 'WHERE a.programme_id = $1 AND s.risk_score >= $2';
    const params: any[] = [programmeId, minRisk];
    let paramIdx = 2;

    if (tier !== 'all') {
      paramIdx++;
      where += ` AND s.tier = $${paramIdx}`;
      params.push(tier);
    }

    const selectQuery = `
      SELECT a.host, a.ip, a.ports, a.tech, a.title, a.status, a.tls,
             s.exposure_score, s.attractiveness_score, s.exploitability_score, 
             s.risk_score, s.tier, s.factors, s.calculated_at
      FROM assets a
      JOIN asset_scores s ON s.asset_id = a.id
      ${where}
      ORDER BY s.risk_score DESC
      LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}
    `;
    params.push(limit, offset);

    const countQuery = `
      SELECT COUNT(*) FROM assets a
      JOIN asset_scores s ON s.asset_id = a.id
      ${where}
    `;

    const [rows, count] = await Promise.all([
      query(selectQuery, params),
      query(countQuery, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      programmeId,
      total: parseInt(count.rows[0].count),
      limit,
      offset,
      assets: rows.rows,
    });
  } catch (error) {
    console.error('risk scores:', error);
    return NextResponse.json({ error: 'Failed to fetch risk scores' }, { status: 500 });
  }
}

/**
 * POST /api/asm/scores — Trigger risk score calculation for a programme
 * Body: { programmeId, assetIds?, force? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programmeId, assetIds, force } = body;

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    // This would trigger the scoring calculation
    // For now, return a job ID placeholder
    return NextResponse.json({
      success: true,
      message: 'Risk score calculation triggered',
      jobId: 'scoring-' + Date.now(),
    }, { status: 202 });
  } catch (error) {
    console.error('trigger scoring:', error);
    return NextResponse.json({ error: 'Failed to trigger scoring' }, { status: 500 });
  }
}