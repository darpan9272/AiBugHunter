import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/** GET /api/skills — list playbooks. */
export async function GET() {
  try {
    const res = await query(`SELECT * FROM skills ORDER BY key`);
    return NextResponse.json({ skills: res.rows });
  } catch (error) {
    console.error('skills GET:', error);
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 });
  }
}

/** POST /api/skills — create a playbook. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, name, description, content } = body;
    if (!key || !name || !content) {
      return NextResponse.json({ error: 'key, name and content are required' }, { status: 400 });
    }
    const res = await query(
      `INSERT INTO skills (key, name, description, content) VALUES ($1, $2, $3, $4) RETURNING *`,
      [key, name, description || '', content]
    );
    return NextResponse.json({ skill: res.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return NextResponse.json({ error: 'Skill key already exists' }, { status: 409 });
    console.error('skills POST:', error);
    return NextResponse.json({ error: 'Failed to create skill' }, { status: 500 });
  }
}

/** PUT /api/skills — update a playbook by key. */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { key, name, description, content } = body;
    if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
    const res = await query(
      `UPDATE skills SET name = COALESCE($2, name), description = COALESCE($3, description),
       content = COALESCE($4, content), updated_at = NOW()
       WHERE key = $1 RETURNING *`,
      [key, name ?? null, description ?? null, content ?? null]
    );
    if (res.rows.length === 0) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    return NextResponse.json({ skill: res.rows[0] });
  } catch (error) {
    console.error('skills PUT:', error);
    return NextResponse.json({ error: 'Failed to update skill' }, { status: 500 });
  }
}

/** DELETE /api/skills — delete by key in body. */
export async function DELETE(request: Request) {
  try {
    const body = await request.json();
    if (!body.key) return NextResponse.json({ error: 'key is required' }, { status: 400 });
    await query(`DELETE FROM skills WHERE key = $1`, [body.key]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('skills DELETE:', error);
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}
