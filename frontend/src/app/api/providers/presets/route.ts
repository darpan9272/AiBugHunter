import { NextResponse } from 'next/server';
import { PROVIDER_PRESETS } from '@/lib/providers';

/** GET /api/providers/presets — one-click connector presets. */
export async function GET() {
  return NextResponse.json({ presets: PROVIDER_PRESETS });
}
