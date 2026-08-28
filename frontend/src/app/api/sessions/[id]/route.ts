import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

/** GET /api/sessions/[id] — full session state: events, goals, pending approvals. */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const s = await query(`
      SELECT s.*, p.name AS programme_name, p.scope AS programme_scope, pr.name AS provider_name
      FROM sessions s
      LEFT JOIN programmes p ON p.id = s.programme_id
      LEFT JOIN ai_providers pr ON pr.id = s.provider_id
      WHERE s.id = $1
    `, [id]);
    if (s.rows.length === 0) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const [events, goals, approvals] = await Promise.all([
      query(`SELECT id, seq, role, content, meta, created_at FROM session_events WHERE session_id = $1 ORDER BY seq`, [id]),
      query(`SELECT * FROM goals WHERE session_id = $1 ORDER BY created_at`, [id]),
      query(`SELECT * FROM approvals WHERE session_id = $1 AND status = 'pending' ORDER BY created_at`, [id]),
    ]);

    return NextResponse.json({
      session: s.rows[0],
      events: events.rows,
      goals: goals.rows,
      pendingApprovals: approvals.rows,
    });
  } catch (error) {
    console.error('session GET:', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

/** DELETE /api/sessions/[id] — archive the engagement. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    await query(`UPDATE sessions SET status = 'archived' WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('session DELETE:', error);
    return NextResponse.json({ error: 'Failed to archive session' }, { status: 500 });
  }
}

/** PATCH /api/sessions/[id] — rename / change mode. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { title, mode } = body;
    const res = await query(
      `UPDATE sessions SET title = COALESCE($2, title), mode = COALESCE($3, mode) WHERE id = $1 RETURNING *`,
      [id, title ?? null, mode ?? null]
    );
    if (res.rows.length === 0) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    return NextResponse.json({ session: res.rows[0] });
  } catch (error) {
    console.error('session PATCH:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
