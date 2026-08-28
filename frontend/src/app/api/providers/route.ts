import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { saveCredential } from '@/lib/credentials';

/** GET /api/providers — list providers (API keys masked) with model counts. */
export async function GET() {
  try {
    const res = await query(`
      SELECT p.id, p.name, p.kind, p.base_url, p.is_local, p.enabled, p.meta, p.created_at,
             CASE WHEN p.api_key <> '' THEN true ELSE false END AS has_key,
             COALESCE(json_agg(json_build_object(
               'id', pm.id, 'model_id', pm.model_id, 'enabled', pm.enabled,
               'role', pm.role, 'nickname', pm.nickname
             )) FILTER (WHERE pm.id IS NOT NULL), '[]') AS models
      FROM ai_providers p
      LEFT JOIN provider_models pm ON pm.provider_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at
    `);
    return NextResponse.json({ providers: res.rows });
  } catch (error) {
    console.error('providers GET:', error);
    return NextResponse.json({ error: 'Failed to fetch providers' }, { status: 500 });
  }
}

/** POST /api/providers — register a provider connection. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, kind, base_url, api_key, is_local, meta } = body;

    if (!name || !kind) {
      return NextResponse.json({ error: 'name and kind are required' }, { status: 400 });
    }

    // Store the secret in the owner-only credential store; keep only a reference in the DB.
    const keyRef = api_key ? `cred:${saveCredential(api_key, name)}` : '';

    const res = await query(
      `INSERT INTO ai_providers (name, kind, base_url, api_key, is_local, meta)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, kind, base_url, is_local, enabled`,
      [name, kind, base_url || null, keyRef, !!is_local, JSON.stringify(meta || {})]
    );
    return NextResponse.json({ provider: res.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      return NextResponse.json({ error: 'A provider with this name already exists' }, { status: 409 });
    }
    console.error('providers POST:', error);
    return NextResponse.json({ error: 'Failed to create provider' }, { status: 500 });
  }
}
