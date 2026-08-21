import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const result = await query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM findings f WHERE f.programme_id = p.id) as finding_count,
        (SELECT COUNT(*) FROM scan_jobs r WHERE r.programme_id = p.id) as recon_run_count,
        (SELECT COALESCE(SUM(aa.prompt_tokens + aa.completion_tokens), 0) 
         FROM agent_activity aa 
         JOIN scan_jobs sj ON aa.scan_job_id = sj.id 
         WHERE sj.programme_id = p.id) as total_tokens,
        (SELECT COALESCE(json_object_agg(provider, tokens), '{}'::json) FROM (
            SELECT ai.provider, SUM(aa.prompt_tokens + aa.completion_tokens) as tokens
            FROM agent_activity aa
            JOIN scan_jobs sj ON aa.scan_job_id = sj.id
            JOIN ai_agents ai ON aa.agent_id = ai.id
            WHERE sj.programme_id = p.id
            GROUP BY ai.provider
        ) sub) as provider_tokens
      FROM programmes p
      ORDER BY p.created_at DESC
    `);
    return NextResponse.json({ programmes: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch programmes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, platform, in_scope, out_of_scope } = body;

    if (!name || !in_scope || in_scope.length === 0) {
      return NextResponse.json(
        { error: 'Name and at least one in-scope domain are required' },
        { status: 400 }
      );
    }

    const result = await query(
      `INSERT INTO programmes (name, platform, scope, out_of_scope)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        name,
        platform || 'private',
        JSON.stringify({ in_scope: in_scope }),
        JSON.stringify({ out_of_scope: out_of_scope || [] }),
      ]
    );

    return NextResponse.json({ programme: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Database Error:', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A programme with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create programme' }, { status: 500 });
  }
}
