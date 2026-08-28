import { NextResponse } from 'next/server';
import { search, facets, portfolioStats, AssetType } from '@/lib/explore';

/**
 * GET /api/explore?q=&type=&programmeId=&limit=&offset=
 * Profundis-style field-syntax search across the asset inventory.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const type = (searchParams.get('type') || 'hosts') as AssetType;
    if (!['hosts', 'dns', 'certs', 'whois'].includes(type)) {
      return NextResponse.json({ error: 'type must be hosts|dns|certs|whois' }, { status: 400 });
    }
    const q = searchParams.get('q') || '';
    const programmeId = searchParams.get('programmeId') || undefined;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    const result = await search({ type, q, programmeId, limit, offset });
    if (result.error) {
      return NextResponse.json({ error: `Query error: ${result.error}` }, { status: 400 });
    }
    const [facetData, stats] = await Promise.all([facets(programmeId), portfolioStats(programmeId)]);
    return NextResponse.json({ ...result, type, q, facets: facetData, stats });
  } catch (error) {
    console.error('explore search:', error);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
