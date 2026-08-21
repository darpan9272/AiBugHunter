import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { launchCoordinatedScan } from '@/lib/orchestrator';

export async function GET() {
  try {
    const result = await query(`
      SELECT sj.*, p.name as programme_name 
      FROM scan_jobs sj
      JOIN programmes p ON sj.programme_id = p.id
      ORDER BY sj.started_at DESC LIMIT 50
    `);
    return NextResponse.json({ scans: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch scans' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programme_id } = body;

    if (!programme_id) {
      return NextResponse.json({ error: 'programme_id is required' }, { status: 400 });
    }

    // Get active agents
    const agentsRes = await query(`SELECT id FROM ai_agents WHERE status = 'active'`);
    const agentIds = agentsRes.rows.map(r => r.id);

    if (agentIds.length === 0) {
       return NextResponse.json({ error: 'No active AI agents connected. Please connect at least one agent in the Agent Hub.' }, { status: 400 });
    }

    // Create Scan Job
    const result = await query(
      `INSERT INTO scan_jobs (programme_id, agents_assigned)
       VALUES ($1, $2)
       RETURNING *`,
      [programme_id, JSON.stringify(agentIds)]
    );

    const scanJob = result.rows[0];

    // Fire & Forget the orchestrator (runs in background)
    launchCoordinatedScan(scanJob.id, programme_id, agentIds).catch(console.error);

    return NextResponse.json({ scan: scanJob }, { status: 201 });
  } catch (error: any) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to launch scan' }, { status: 500 });
  }
}
