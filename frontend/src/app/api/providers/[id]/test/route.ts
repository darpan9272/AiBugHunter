import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { testProvider } from '@/lib/providers';

/** POST /api/providers/[id]/test — { model } → cheap live connectivity test. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const res = await query(`SELECT * FROM ai_providers WHERE id = $1`, [id]);
    if (res.rows.length === 0) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    const provider = res.rows[0];

    let model = body.model as string | undefined;
    if (!model) {
      const m = await query(`SELECT model_id FROM provider_models WHERE provider_id = $1 LIMIT 1`, [id]);
      model = m.rows[0]?.model_id;
    }
    if (!model) return NextResponse.json({ error: 'No model specified or discovered yet' }, { status: 400 });

    const result = await testProvider(provider, model);
    return NextResponse.json({ model, ...result });
  } catch (error) {
    console.error('provider test:', error);
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}
