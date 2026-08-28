import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createSession } from '@/lib/session-engine';

/** GET /api/sessions — list engagements. */
export async function GET() {
  try {
    const res = await query(`
      SELECT s.*, p.name AS programme_name, pr.name AS provider_name,
             (SELECT COUNT(*)::int FROM session_events ev WHERE ev.session_id = s.id) AS event_count,
             (SELECT COUNT(*)::int FROM approvals a WHERE a.session_id = s.id AND a.status = 'pending') AS pending_approvals
      FROM sessions s
      LEFT JOIN programmes p ON p.id = s.programme_id
      LEFT JOIN ai_providers pr ON pr.id = s.provider_id
      WHERE s.status = 'active'
      ORDER BY s.updated_at DESC
    `);
    return NextResponse.json({ sessions: res.rows });
  } catch (error) {
    console.error('sessions GET:', error);
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 });
  }
}

/** POST /api/sessions — start a new engagement. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programmeId, providerId, modelId, title } = body;
    if (!providerId || !modelId) {
      return NextResponse.json({ error: 'providerId and modelId are required' }, { status: 400 });
    }
    const prov = await query(`SELECT id FROM ai_providers WHERE id = $1 AND enabled = TRUE`, [providerId]);
    if (prov.rows.length === 0) {
      return NextResponse.json({ error: 'Provider not found or disabled' }, { status: 404 });
    }
    const session = await createSession({ programmeId, providerId, modelId, title });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('sessions POST:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}
