import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/timeline/all?programmeId=xxx&days=30&limit=500
 * Get recent changes across all assets in a programme
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const days = Math.min(parseInt(searchParams.get('days') || '30'), 365);
    const limit = Math.min(parseInt(searchParams.get('limit') || '500'), 2000);

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    // Get recent changes grouped by asset
    const changesQuery = `
      SELECT 
        ac.*,
        a.host,
        a.id as asset_id
      FROM asset_changes ac
      JOIN assets a ON a.id = ac.asset_id
      WHERE ac.programme_id = $1
        AND ac.created_at >= NOW() - INTERVAL '${days} days'
      ORDER BY ac.created_at DESC
      LIMIT $2
    `;

    const result = await query(changesQuery, [programmeId, limit]);

    // Group by asset
    const assetsMap = new Map<string, any>();
    for (const row of result.rows) {
      const assetId = row.asset_id;
      if (!assetsMap.has(assetId)) {
        assetsMap.set(assetId, {
          host: row.host,
          asset_id: assetId,
          changes: [],
        });
      }
      assetsMap.get(assetId).changes.push({
        id: row.id,
        asset_id: row.asset_id,
        field_name: row.field_name,
        old_value: row.old_value,
        new_value: row.new_value,
        change_type: row.change_type,
        source: row.source,
        meta: row.meta,
        created_at: row.created_at,
      });
    }

    return NextResponse.json({
      programmeId,
      days,
      assets: Array.from(assetsMap.values()),
    });
  } catch (error) {
    console.error('timeline all:', error);
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 });
  }
}