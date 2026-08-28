import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { discoverModels } from '@/lib/providers';

/** POST /api/providers/[id]/discover — auto-discover models and upsert them. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const res = await query(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    const provider = res.rows[0];

    const { models, error } = await discoverModels(provider);
    if (error && models.length === 0) {
      return NextResponse.json({ error }, { status: 502 });
    }

    let added = 0;
    for (const modelId of models) {
      const up = await query(
        `INSERT INTO provider_models (provider_id, model_id)
         VALUES ($1, $2)
         ON CONFLICT (provider_id, model_id) DO NOTHING
         RETURNING id`,
        [id, modelId]
      );
      if (up.rows.length > 0) added++;
    }

    const list = await query(`SELECT * FROM provider_models WHERE provider_id = $1 ORDER BY model_id`, [id]);
    return NextResponse.json({ discovered: models.length, added, models: list.rows, warning: error || null });
  } catch (error) {
    console.error('discover:', error);
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }
}
