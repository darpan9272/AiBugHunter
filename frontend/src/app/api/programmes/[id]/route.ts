import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await query(
      `SELECT p.*,
        (SELECT COUNT(*) FROM findings f WHERE f.programme_id = p.id) as finding_count,
        (SELECT COUNT(*) FROM exploit_attempts ea
         JOIN findings f ON ea.finding_id = f.id
         WHERE f.programme_id = p.id) as exploit_count
       FROM programmes p WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
    }
    return NextResponse.json({ programme: result.rows[0] });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch programme' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await query(`DELETE FROM programmes WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to delete programme' }, { status: 500 });
  }
}
