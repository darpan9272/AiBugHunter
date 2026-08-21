import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const status = searchParams.get('status');

    let sql = `
      SELECT br.*, p.name as programme_name
      FROM bug_reports br
      LEFT JOIN programmes p ON br.programme_id = p.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (status) {
      sql += ` AND br.status = $${idx++}`;
      params.push(status);
    }

    sql += ` ORDER BY br.created_at DESC LIMIT 100`;

    const result = await query(sql, params);
    return NextResponse.json({ reports: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: 'id and status are required' }, { status: 400 });
    }

    const validStatuses = ['draft', 'submitted', 'accepted', 'rejected', 'informative'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

    const updates: string[] = [`status = $2`];
    const params: any[] = [id, status];

    if (status === 'submitted') {
      updates.push(`submitted_at = NOW()`);
    } else if (status === 'accepted' || status === 'rejected') {
      updates.push(`resolved_at = NOW()`);
    }

    const result = await query(
      `UPDATE bug_reports SET ${updates.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json({ report: result.rows[0] });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
  }
}
