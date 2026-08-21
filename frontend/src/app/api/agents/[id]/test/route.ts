import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { testConnection } from '@/lib/ai-providers';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agentRes = await query(`SELECT * FROM ai_agents WHERE id = $1`, [id]);
    
    if (agentRes.rows.length === 0) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const agent = agentRes.rows[0];
    const result = await testConnection(agent);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Test Connection Error:', error);
    return NextResponse.json({ error: 'Internal test failure' }, { status: 500 });
  }
}
