import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    
    const [scanRes, activityRes] = await Promise.all([
        query(`SELECT sj.*, p.name as programme_name FROM scan_jobs sj JOIN programmes p ON sj.programme_id = p.id WHERE sj.id = $1`, [id]),
        query(`
            SELECT act.*, a.provider, a.model, a.role, a.nickname 
            FROM agent_activity act 
            LEFT JOIN ai_agents a ON act.agent_id = a.id 
            WHERE act.scan_job_id = $1 
            ORDER BY act.created_at ASC
        `, [id])
    ]);

    if (scanRes.rows.length === 0) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 });
    }

    return NextResponse.json({ 
        scan: scanRes.rows[0],
        activity: activityRes.rows 
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch scan details' }, { status: 500 });
  }
}
