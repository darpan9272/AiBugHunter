import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/** GET /api/harness — active pipeline config + version history. */
export async function GET() {
  try {
    const active = await query(`SELECT * FROM harness_config WHERE active = TRUE ORDER BY version DESC LIMIT 1`);
    const history = await query(`SELECT id, version, active, created_at FROM harness_config ORDER BY version DESC LIMIT 20`);
    return NextResponse.json({ config: active.rows[0] || null, history: history.rows });
  } catch (error) {
    console.error('harness GET:', error);
    return NextResponse.json({ error: 'Failed to fetch harness config' }, { status: 500 });
  }
}

/** POST /api/harness — save a new pipeline version and activate it. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phases, settings } = body;
    if (!Array.isArray(phases)) return NextResponse.json({ error: 'phases array is required' }, { status: 400 });

    const latest = await query(`SELECT MAX(version) AS v FROM harness_config`);
    const nextVersion = (latest.rows[0].v || 0) + 1;

    await query(`UPDATE harness_config SET active = FALSE`);
    const res = await query(
      `INSERT INTO harness_config (version, phases, settings, active)
       VALUES ($1, $2, $3, TRUE) RETURNING *`,
      [nextVersion, JSON.stringify(phases), JSON.stringify(settings || {})]
    );
    return NextResponse.json({ config: res.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('harness POST:', error);
    return NextResponse.json({ error: 'Failed to save harness config' }, { status: 500 });
  }
}
