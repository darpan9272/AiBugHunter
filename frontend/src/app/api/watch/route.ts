import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { search } from '@/lib/explore';
import { getToolServers, callTool } from '@/lib/tools';

/** GET /api/watch — list watch rules. POST — create. */
export async function GET() {
  try {
    const res = await query(
      `SELECT w.*, p.name AS programme_name FROM watch_rules w
       LEFT JOIN programmes p ON p.id = w.programme_id ORDER BY w.created_at DESC`
    );
    return NextResponse.json({ rules: res.rows });
  } catch (error) {
    console.error('watch GET:', error);
    return NextResponse.json({ error: 'Failed to fetch rules' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, query: q, asset_type, programmeId, webhook } = body;
    if (!name || !q) return NextResponse.json({ error: 'name and query are required' }, { status: 400 });
    const res = await query(
      `INSERT INTO watch_rules (name, query, asset_type, programme_id, webhook)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, q, asset_type || 'hosts', programmeId || null, webhook || null]
    );
    return NextResponse.json({ rule: res.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('watch POST:', error);
    return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, enabled } = body;
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const res = await query(`UPDATE watch_rules SET enabled = $1 WHERE id = $2 RETURNING *`, [!!enabled, id]);
    return NextResponse.json({ rule: res.rows[0] });
  } catch (error) {
    console.error('watch PATCH:', error);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await query(`DELETE FROM watch_rules WHERE id = $1`, [body.id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('watch DELETE:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
