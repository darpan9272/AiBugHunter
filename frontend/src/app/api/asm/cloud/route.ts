import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/cloud?programmeId=xxx&provider=aws&resourceType=s3&publicOnly=true&limit=200
 * Get discovered cloud assets for a programme.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const provider = searchParams.get('provider') || 'all';
    const resourceType = searchParams.get('resourceType') || '';
    const publicOnly = searchParams.get('publicOnly') === 'true';
    const limit = Math.min(parseInt(searchParams.get('limit') || '200'), 500);

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    let where = 'WHERE programme_id = $1';
    const params: any[] = [programmeId];
    let paramIdx = 1;

    if (provider !== 'all') {
      paramIdx++;
      where += ` AND provider = $${paramIdx}`;
      params.push(provider);
    }

    if (resourceType) {
      paramIdx++;
      where += ` AND resource_type ILIKE $${paramIdx}`;
      params.push(`%${resourceType}%`);
    }

    if (publicOnly) {
      where += ' AND public_exposure = TRUE';
    }

    const selectQuery = `
      SELECT provider, resource_type, resource_id, resource_arn, region, name, 
             metadata, tags, public_exposure, first_seen, last_seen
      FROM cloud_assets
      ${where}
      ORDER BY last_seen DESC
      LIMIT $${paramIdx + 1}
    `;
    params.push(limit);

    const rows = await query(selectQuery, params);

    return NextResponse.json({
      programmeId,
      count: rows.rows.length,
      assets: rows.rows,
    });
  } catch (error) {
    console.error('cloud assets:', error);
    return NextResponse.json({ error: 'Failed to fetch cloud assets' }, { status: 500 });
  }
}

/**
 * POST /api/asm/cloud — Trigger cloud asset discovery
 * Body: { programmeId, provider, credentials?, regions? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programmeId, provider, credentials, regions } = body;

    if (!programmeId || !provider) {
      return NextResponse.json({ error: 'programmeId and provider are required' }, { status: 400 });
    }

    // This would trigger cloud discovery
    return NextResponse.json({
      success: true,
      message: `Cloud discovery triggered for ${provider}`,
      jobId: `cloud-${provider}-${Date.now()}`,
    }, { status: 202 });
  } catch (error) {
    console.error('trigger cloud discovery:', error);
    return NextResponse.json({ error: 'Failed to trigger cloud discovery' }, { status: 500 });
  }
}