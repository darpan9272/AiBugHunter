import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/** GET /api/prompts — all editable prompt templates. */
export async function GET() {
  try {
    const res = await query(`SELECT * FROM prompt_templates ORDER BY key`);
    return NextResponse.json({ templates: res.rows });
  } catch (error) {
    console.error('prompts GET:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}

/** PUT /api/prompts — { key, content, name? } update a template. */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { key, content, name } = body;
    if (!key || content === undefined) {
      return NextResponse.json({ error: 'key and content are required' }, { status: 400 });
    }
    const res = await query(
      `UPDATE prompt_templates
       SET content = $1, name = COALESCE($2, name), updated_at = NOW()
       WHERE key = $3
       RETURNING *`,
      [content, name ?? null, key]
    );
    if (res.rows.length === 0) return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    return NextResponse.json({ template: res.rows[0] });
  } catch (error) {
    console.error('prompts PUT:', error);
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 });
  }
}

/** POST /api/prompts — create a custom template. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { key, name, content } = body;
    if (!key || !name || !content) {
      return NextResponse.json({ error: 'key, name and content are required' }, { status: 400 });
    }
    const res = await query(
      `INSERT INTO prompt_templates (key, name, content) VALUES ($1, $2, $3) RETURNING *`,
      [key, name, content]
    );
    return NextResponse.json({ template: res.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return NextResponse.json({ error: 'Template key already exists' }, { status: 409 });
    console.error('prompts POST:', error);
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 });
  }
}
