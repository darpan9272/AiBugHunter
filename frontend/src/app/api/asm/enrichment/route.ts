import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/asm/enrichment?programmeId=xxx&status=running&limit=50
 * List enrichment jobs
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
    const offset = parseInt(searchParams.get('offset') || '0');

    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 0;

    if (programmeId) {
      paramIdx++;
      where += ` AND programme_id = $${paramIdx}`;
      params.push(programmeId);
    }

    if (status) {
      paramIdx++;
      where += ` AND status = $${paramIdx}`;
      params.push(status);
    }

    const selectQuery = `
      SELECT * FROM enrichment_jobs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${paramIdx + 1} OFFSET $${paramIdx + 2}
    `;
    params.push(limit, offset);

    const countQuery = `SELECT COUNT(*) FROM enrichment_jobs ${where}`;

    const [rows, count] = await Promise.all([
      query(selectQuery, params),
      query(countQuery, params.slice(0, -2)),
    ]);

    return NextResponse.json({
      total: parseInt(count.rows[0].count),
      limit,
      offset,
      jobs: rows.rows,
    });
  } catch (error) {
    console.error('enrichment jobs GET:', error);
    return NextResponse.json({ error: 'Failed to fetch enrichment jobs' }, { status: 500 });
  }
}

/**
 * POST /api/asm/enrichment — Trigger enrichment job
 * Body: { programmeId, target, targetType, sources, params }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programmeId, target, targetType, sources, params } = body;

    if (!programmeId || !target) {
      return NextResponse.json({ error: 'programmeId and target are required' }, { status: 400 });
    }

    const sourceList = sources || ['censys', 'shodan'];
    const targetTypeNorm = targetType || 'domain';
    const paramsJson = params || {};

    // Create a job for each source
    const jobIds: string[] = [];
    for (const source of sourceList) {
      const job = await query(
        `INSERT INTO enrichment_jobs (programme_id, source, target, target_type, params, status, started_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
         RETURNING id`,
        [programmeId, source, target, targetTypeNorm, JSON.stringify(paramsJson)]
      );
      jobIds.push(job.rows[0].id);
    }

    // In a real implementation, this would trigger background workers
    // For now, return the job IDs
    return NextResponse.json({
      success: true,
      message: `Enrichment triggered for ${sourceList.length} source(s)`,
      jobIds,
      target,
      sources: sourceList,
    }, { status: 202 });
  } catch (error) {
    console.error('enrichment POST:', error);
    return NextResponse.json({ error: 'Failed to trigger enrichment' }, { status: 500 });
  }
}

/**
 * GET /api/asm/enrichment/[id] — Get enrichment job details
 */
export async function GET_BY_ID(request: Request, { params }: { params: { id: string } }) {
  try {
    const job = await query(`SELECT * FROM enrichment_jobs WHERE id = $1`, [params.id]);
    if (job.rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job: job.rows[0] });
  } catch (error) {
    console.error('enrichment job GET:', error);
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500 });
  }
}