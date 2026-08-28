import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/timeline?host=example.com&programmeId=xxx&limit=100&fields=ip,ports,tech
 * Get historical timeline of changes for a specific asset.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const host = searchParams.get('host');
    const programmeId = searchParams.get('programmeId') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const fieldsParam = searchParams.get('fields');
    const fields = fieldsParam ? fieldsParam.split(',').map(f => f.trim()) : [];

    if (!host) {
      return NextResponse.json({ error: 'host parameter is required' }, { status: 400 });
    }

    // Find asset ID
    let assetQuery = 'SELECT id FROM assets WHERE host = $1';
    const assetParams: any[] = [host];
    if (programmeId) {
      assetQuery += ' AND programme_id = $2';
      assetParams.push(programmeId);
    }
    const asset = await query(assetQuery, assetParams);
    if (asset.rows.length === 0) {
      return NextResponse.json({ error: `Asset not found: ${host}` }, { status: 404 });
    }

    const assetId = asset.rows[0].id;

    // Get changes
    let changesQuery = `
      SELECT field_name, old_value, new_value, change_type, source, meta, created_at
      FROM asset_changes
      WHERE asset_id = $1
    `;
    const changeParams: any[] = [assetId];
    let paramIdx = 1;

    if (fields.length > 0) {
      const placeholders = fields.map((_, i) => `$${paramIdx + 1 + i}`).join(',');
      changesQuery += ` AND field_name IN (${placeholders})`;
      changeParams.push(...fields);
      paramIdx += fields.length;
    }

    changesQuery += ` ORDER BY created_at DESC LIMIT $${paramIdx + 1}`;
    changeParams.push(limit);

    const changes = await query(changesQuery, changeParams);

    return NextResponse.json({
      host,
      asset_id: assetId,
      changes: changes.rows,
      count: changes.rows.length,
    });
  } catch (error) {
    console.error('timeline:', error);
    return NextResponse.json({ error: 'Failed to fetch timeline' }, { status: 500 });
  }
}