import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/expiring-certs?programmeId=xxx&days=30&limit=10
 * Get certificates expiring within N days
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const days = Math.min(parseInt(searchParams.get('days') || '30'), 365);
    const limit = Math.min(parseInt(searchParams.get('limit') || '10'), 100);

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    const certQuery = `
      SELECT 
        subject_cn,
        san,
        issuer_org,
        not_before,
        not_after,
        EXTRACT(DAY FROM (not_after - NOW()))::int AS days_left,
        sha256
      FROM asset_certs
      WHERE programme_id = $1
        AND not_after > NOW()
        AND not_after < NOW() + INTERVAL '${days} days'
      ORDER BY not_after ASC
      LIMIT $2
    `;

    const result = await query(certQuery, [programmeId, limit]);

    return NextResponse.json({
      programmeId,
      days,
      certs: result.rows.map((r: any) => ({
        subject_cn: r.subject_cn,
        san: r.san,
        issuer_org: r.issuer_org,
        not_before: r.not_before,
        not_after: r.not_after,
        days_left: r.days_left,
        sha256: r.sha256,
      })),
    });
  } catch (error) {
    console.error('expiring certs:', error);
    return NextResponse.json({ error: 'Failed to fetch expiring certificates' }, { status: 500 });
  }
}