import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getToolServers, refreshToolServer } from '@/lib/tools';

/** GET /api/tools — list tool servers + their tools (live refresh). */
export async function GET() {
  try {
    const servers = await getToolServers(false);
    const out = [];
    for (const s of servers) {
      const { tools, error } = await refreshToolServer(s);
      out.push({
        id: s.id,
        name: s.name,
        url: s.url,
        enabled: s.enabled,
        online: !error,
        error: error || null,
        tools,
      });
    }
    return NextResponse.json({ servers: out });
  } catch (error) {
    console.error('tools GET:', error);
    return NextResponse.json({ error: 'Failed to list tool servers' }, { status: 500 });
  }
}

/** POST /api/tools — register a custom tool server. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, url, kind } = body;
    if (!name || !url) return NextResponse.json({ error: 'name and url are required' }, { status: 400 });
    const res = await query(
      `INSERT INTO tool_servers (name, url, kind) VALUES ($1, $2, $3) RETURNING *`,
      [name, url, kind || 'mcp-http']
    );
    return NextResponse.json({ server: res.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return NextResponse.json({ error: 'Tool server name already exists' }, { status: 409 });
    console.error('tools POST:', error);
    return NextResponse.json({ error: 'Failed to register tool server' }, { status: 500 });
  }
}

/** PATCH /api/tools — { id, enabled } toggle a server. */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, enabled } = body;
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    const res = await query(`UPDATE tool_servers SET enabled = $1 WHERE id = $2 RETURNING *`, [!!enabled, id]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ server: res.rows[0] });
  } catch (error) {
    console.error('tools PATCH:', error);
    return NextResponse.json({ error: 'Failed to update tool server' }, { status: 500 });
  }
}
