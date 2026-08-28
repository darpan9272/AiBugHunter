import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/** PATCH /api/providers/[id] — update provider (key, url, enabled) or a model's role/enabled. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Model-level update: { model_pk, enabled?, role?, nickname? }
    if (body.model_pk) {
      const res = await query(
        `UPDATE provider_models
         SET enabled = COALESCE($1, enabled),
             role = COALESCE($2, role),
             nickname = COALESCE($3, nickname)
         WHERE id = $4 AND provider_id = $5
         RETURNING *`,
        [body.enabled ?? null, body.role ?? null, body.nickname ?? null, body.model_pk, id]
      );
      if (res.rows.length === 0) return NextResponse.json({ error: 'Model not found' }, { status: 404 });
      return NextResponse.json({ model: res.rows[0] });
    }

    // Provider-level update
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const f of ['name', 'kind', 'base_url', 'api_key', 'is_local', 'enabled'] as const) {
      if (body[f] !== undefined) {
        fields.push(`${f} = $${idx++}`);
        values.push(body[f]);
      }
    }
    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    values.push(id);
    const res = await query(
      `UPDATE ai_providers SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, name, kind, base_url, is_local, enabled`,
      values
    );
    if (res.rows.length === 0) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    return NextResponse.json({ provider: res.rows[0] });
  } catch (error) {
    console.error('providers PATCH:', error);
    return NextResponse.json({ error: 'Failed to update provider' }, { status: 500 });
  }
}

/** DELETE /api/providers/[id] — remove provider and all its models. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await query(`DELETE FROM ai_providers WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('providers DELETE:', error);
    return NextResponse.json({ error: 'Failed to delete provider' }, { status: 500 });
  }
}
