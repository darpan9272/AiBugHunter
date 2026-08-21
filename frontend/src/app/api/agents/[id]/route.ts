import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await query(`DELETE FROM ai_agents WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { role, status } = body;

    const updates: string[] = [];
    const paramsList: any[] = [id];
    let idx = 2;

    if (role) {
      updates.push(`role = $${idx++}`);
      paramsList.push(role);
    }
    if (status) {
      updates.push(`status = $${idx++}`);
      paramsList.push(status);
    }

    if (updates.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    const result = await query(
      `UPDATE ai_agents SET ${updates.join(', ')} WHERE id = $1 RETURNING id, provider, model, role, status, nickname`,
      paramsList
    );

    return NextResponse.json({ agent: result.rows[0] });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 });
  }
}
