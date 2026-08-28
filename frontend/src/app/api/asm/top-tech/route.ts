import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/top-tech?programmeId=xxx&limit=10
 * Get top technologies with average risk scores
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 50);

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    const techQuery = `
      SELECT 
        tech_item AS tech,
        COUNT(DISTINCT a.id) AS count,
        COALESCE(AVG(s.risk_score), 0) AS avg_risk,
        COALESCE(MAX(s.risk_score), 0) AS max_risk,
        COUNT(*) FILTER (WHERE s.tier IN ('critical', 'high')) AS high_risk_count
      FROM assets a
      CROSS JOIN LATERAL jsonb_array_elements_text(a.tech) AS tech_item
      LEFT JOIN asset_scores s ON s.asset_id = a.id
      WHERE a.programme_id = $1
        AND a.tech IS NOT NULL
        AND jsonb_array_length(a.tech) > 0
      GROUP BY tech_item
      ORDER BY count DESC, avg_risk DESC
      LIMIT $2
    `;

    const result = await query(techQuery, [programmeId, limit]);

    return NextResponse.json({
      programmeId,
      tech: result.rows.map((r: any) => ({
        tech: r.tech,
        count: parseInt(r.count),
        avg_risk: parseFloat(r.avg_risk),
        max_risk: parseFloat(r.max_risk),
        high_risk_count: parseInt(r.high_risk_count),
      })),
    });
  } catch (error) {
    console.error('top tech:', error);
    return NextResponse.json({ error: 'Failed to fetch top technologies' }, { status: 500 });
  }
}