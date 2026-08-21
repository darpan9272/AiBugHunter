import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query(
      `SELECT * FROM strategy_versions ORDER BY version DESC LIMIT 1`
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ config: null });
    }
    return NextResponse.json({
      config: result.rows[0].config,
      version: result.rows[0].version,
      reasoning: result.rows[0].meta_reasoning,
      updated_at: result.rows[0].created_at,
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { config, reasoning } = body;

    if (!config) {
      return NextResponse.json({ error: 'config is required' }, { status: 400 });
    }

    // Get current latest version
    const latest = await query(`SELECT MAX(version) as v FROM strategy_versions`);
    const nextVersion = (latest.rows[0].v || 0) + 1;

    const result = await query(
      `INSERT INTO strategy_versions (version, config, meta_reasoning)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [nextVersion, JSON.stringify(config), reasoning || 'Manual update from dashboard']
    );

    return NextResponse.json({
      config: result.rows[0].config,
      version: result.rows[0].version,
    }, { status: 201 });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
