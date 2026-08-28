import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/exposure-trend?programmeId=xxx&days=30
 * Get exposure trend over time (new assets, new exposures per day)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const days = Math.min(parseInt(searchParams.get('days') || '30'), 90);

    if (!programmeId) {
      return NextResponse.json({ error: 'programmeId is required' }, { status: 400 });
    }

    // Get daily new assets and high-risk exposures
    const trendQuery = `
      WITH date_series AS (
        SELECT generate_series(
          (NOW() - INTERVAL '${days} days')::date,
          NOW()::date,
          INTERVAL '1 day'
        )::date AS date
      ),
      daily_assets AS (
        SELECT 
          DATE(first_seen) AS date,
          COUNT(*) AS new_assets,
          COUNT(*) FILTER (WHERE 
            EXISTS (
              SELECT 1 FROM asset_scores s 
              WHERE s.asset_id = a.id AND s.risk_score >= 60
            )
          ) AS new_exposures
        FROM assets a
        WHERE programme_id = $1 
          AND first_seen >= NOW() - INTERVAL '${days} days'
        GROUP BY DATE(first_seen)
      ),
      daily_changes AS (
        SELECT 
          DATE(created_at) AS date,
          COUNT(*) AS changes,
          COUNT(DISTINCT asset_id) AS changed_assets
        FROM asset_changes
        WHERE programme_id = $1 
          AND created_at >= NOW() - INTERVAL '${days} days'
          AND change_type IN ('created', 'updated')
        GROUP BY DATE(created_at)
      )
      SELECT 
        ds.date,
        COALESCE(da.new_assets, 0) AS new_assets,
        COALESCE(da.new_exposures, 0) AS new_exposures,
        COALESCE(dc.changes, 0) AS changes,
        COALESCE(dc.changed_assets, 0) AS changed_assets
      FROM date_series ds
      LEFT JOIN daily_assets da ON da.date = ds.date
      LEFT JOIN daily_changes dc ON dc.date = ds.date
      ORDER BY ds.date ASC
    `;

    const result = await query(trendQuery, [programmeId]);

    return NextResponse.json({
      programmeId,
      days,
      trend: result.rows.map((r: any) => ({
        date: r.date,
        new_assets: parseInt(r.new_assets),
        new_exposures: parseInt(r.new_exposures),
        changes: parseInt(r.changes),
        changed_assets: parseInt(r.changed_assets),
      })),
    });
  } catch (error) {
    console.error('exposure trend:', error);
    return NextResponse.json({ error: 'Failed to fetch exposure trend' }, { status: 500 });
  }
}