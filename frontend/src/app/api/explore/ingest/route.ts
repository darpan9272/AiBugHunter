import { NextResponse } from 'next/server';
import { ingestDomain, ingestHttpxProbe, ingestDnsx, ingestFavicons } from '@/lib/ingest';
import { query } from '@/lib/db';

/**
 * POST /api/explore/ingest — pull live recon data into the inventory.
 * Body: { programmeId?, domain, liveHosts?[] }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programmeId, domain, liveHosts } = body;
    if (!domain) return NextResponse.json({ error: 'domain is required' }, { status: 400 });
    const result = await ingestDomain(programmeId || null, domain, liveHosts);
    return NextResponse.json({ ok: true, result }, { status: 202 });
  } catch (error) {
    console.error('ingest:', error);
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 });
  }
}

/** GET /api/explore/ingest?programmeId= — ingestion status. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const res = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM assets WHERE programme_id IS NOT DISTINCT FROM $1) AS assets,
         (SELECT COUNT(*)::int FROM asset_dns WHERE programme_id IS NOT DISTINCT FROM $1) AS dns_records,
         (SELECT COUNT(*)::int FROM asset_certs WHERE programme_id IS NOT DISTINCT FROM $1) AS certs,
         (SELECT MAX(last_seen) FROM assets WHERE programme_id IS NOT DISTINCT FROM $1) AS last_ingest`,
      [programmeId]
    );
    return NextResponse.json(res.rows[0]);
  } catch (error) {
    console.error('ingest status:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
