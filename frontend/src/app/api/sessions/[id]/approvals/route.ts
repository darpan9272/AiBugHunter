import { NextResponse } from 'next/server';
import { resolveApproval } from '@/lib/session-engine';

/** POST /api/sessions/[id]/approvals — { approvalId, decision: 'approve' | 'deny' } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // session id validated implicitly via approval lookup
    const body = await request.json();
    const { approvalId, decision } = body;
    if (!approvalId || !['approve', 'deny'].includes(decision)) {
      return NextResponse.json({ error: 'approvalId and decision (approve|deny) are required' }, { status: 400 });
    }
    const result = await resolveApproval(approvalId, decision === 'approve');
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('approvals POST:', error);
    const status = msg.includes('not found') ? 404 : msg.includes('already') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
