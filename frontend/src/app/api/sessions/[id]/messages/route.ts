import { NextResponse } from 'next/server';
import { appendEvent, runAgent } from '@/lib/session-engine';

/** POST /api/sessions/[id]/messages — operator sends a message; agent runs. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { message } = body;
    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'message is required' }, { status: 400 });
    }

    await appendEvent(id, 'user', message.trim(), {});
    const result = await runAgent(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('messages POST:', error);
    const status = msg.includes('not found') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
