import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const programmeId = searchParams.get('programme_id');
    const type = searchParams.get('type');
    const minScore = searchParams.get('min_score');

    let sql = `
      SELECT f.id, f.target, f.type, f.triage_score, f.triage_reason,
             f.metadata, f.created_at, p.name as programme_name
      FROM findings f
      JOIN programmes p ON f.programme_id = p.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (programmeId) {
      sql += ` AND f.programme_id = $${idx++}`;
      params.push(programmeId);
    }
    if (type) {
      sql += ` AND f.type = $${idx++}`;
      params.push(type);
    }
    if (minScore) {
      sql += ` AND f.triage_score >= $${idx++}`;
      params.push(parseFloat(minScore));
    }

    sql += ` ORDER BY f.created_at DESC LIMIT 100`;

    const result = await query(sql, params);

    return NextResponse.json({ findings: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch findings' }, { status: 500 });
  }
}
