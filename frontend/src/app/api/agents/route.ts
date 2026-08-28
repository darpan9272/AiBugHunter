import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

async function syncEnvAgents() {
  const envAgents = [
    { provider: 'openai', model: 'gpt-5.6-sol', key: process.env.OPENAI_API_KEY, nickname: 'OpenAI (.env auto)' },
    { provider: 'anthropic', model: 'claude-opus-5', key: process.env.ANTHROPIC_API_KEY, nickname: 'Anthropic (.env auto)' },
    { provider: 'google', model: 'gemini-3.1-pro-preview', key: process.env.GOOGLE_API_KEY, nickname: 'Gemini (.env auto)' }
  ];

  for (const agent of envAgents) {
    if (agent.key) {
      // Check if we already have this key in the DB
      const res = await query(`SELECT id FROM ai_agents WHERE api_key = $1`, [agent.key]);
      if (res.rows.length === 0) {
        await query(
          `INSERT INTO ai_agents (provider, model, api_key, role, nickname, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
          [agent.provider, agent.model, agent.key, 'general', agent.nickname]
        );
      } else {
        // Keep the auto-synced row's model current when the default changes above
        await query(`UPDATE ai_agents SET model = $1 WHERE id = $2`, [agent.model, res.rows[0].id]);
      }
    }
  }
}

export async function GET() {
  try {
    await syncEnvAgents();
    const result = await query(`SELECT id, provider, model, role, status, nickname, created_at, base_url FROM ai_agents ORDER BY created_at DESC`);
    return NextResponse.json({ agents: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { provider, model, api_key, role, nickname, base_url } = body;

    if (!provider || !model || !api_key) {
      return NextResponse.json({ error: 'provider, model, and api_key are required' }, { status: 400 });
    }

    const result = await query(
      `INSERT INTO ai_agents (provider, model, api_key, role, nickname, base_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, provider, model, role, status, nickname, created_at, base_url`,
      [provider, model, api_key, role || 'general', nickname || null, base_url || null]
    );

    return NextResponse.json({ agent: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 });
  }
}
