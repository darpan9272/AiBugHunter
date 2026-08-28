import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { launchCoordinatedScan } from '@/lib/orchestrator';
import { launchHarnessScan } from '@/lib/harness';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const programmeId = searchParams.get('programmeId');
    const status = searchParams.get('status');

    let queryText = `
      SELECT sj.*, p.name as programme_name
      FROM scan_jobs sj
      JOIN programmes p ON sj.programme_id = p.id
    `;
    const params: any[] = [];
    const conditions = [];

    if (programmeId) {
      conditions.push(`sj.programme_id = $${params.length + 1}`);
      params.push(programmeId);
    }
    if (status) {
      conditions.push(`sj.status = $${params.length + 1}`);
      params.push(status);
    }

    if (conditions.length > 0) {
      queryText += ` WHERE ${conditions.join(' AND ')}`;
    }

    queryText += ` ORDER BY sj.started_at DESC`;

    const result = await query(queryText, params);
    return NextResponse.json({ scanJobs: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch scan jobs' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { programmeId, scanProfileId, agentIds } = body;

    // Validate required fields
    if (!programmeId) {
      return NextResponse.json(
        { error: 'Programme ID is required' },
        { status: 400 }
      );
    }

    // Validate programme exists
    const programmeCheck = await query(
      `SELECT id FROM programmes WHERE id = $1`,
      [programmeId]
    );
    if (programmeCheck.rows.length === 0) {
      return NextResponse.json(
        { error: 'Programme not found' },
        { status: 404 }
      );
    }

    // Validate scan profile if provided
    if (scanProfileId) {
      const profileCheck = await query(
        `SELECT id FROM scan_profiles WHERE id = $1`,
        [scanProfileId]
      );
      if (profileCheck.rows.length === 0) {
        return NextResponse.json(
          { error: 'Scan profile not found' },
          { status: 404 }
        );
      }
    }

    // Check harness availability first (harness-only setups need no legacy agents)
    const harnessModels = await query(
      `SELECT COUNT(*)::int AS n FROM provider_models pm
       JOIN ai_providers p ON p.id = pm.provider_id
       WHERE pm.enabled = TRUE AND p.enabled = TRUE`
    );
    const useHarness = (harnessModels.rows[0]?.n || 0) > 0;

    // Validate agent IDs if provided (legacy engine)
    let validatedAgentIds: string[] = [];
    if (agentIds && agentIds.length > 0) {
      const agentsCheck = await query(
        `SELECT id FROM ai_agents WHERE id = ANY($1) AND status = 'active'`,
        [agentIds]
      );
      if (agentsCheck.rows.length === 0) {
        return NextResponse.json(
          { error: 'No active agents found for the provided IDs' },
          { status: 400 }
        );
      }
      validatedAgentIds = agentsCheck.rows.map((row: any) => row.id);
    } else if (!useHarness) {
      // Legacy engine requires at least one active ai_agent
      const agentsCheck = await query(
        `SELECT id FROM ai_agents WHERE status = 'active'`
      );
      validatedAgentIds = agentsCheck.rows.map((row: any) => row.id);
      if (validatedAgentIds.length === 0) {
        return NextResponse.json(
          { error: 'No active agents available. Connect a provider in "Connect AI" first.' },
          { status: 400 }
        );
      }
    }

    // Create the scan job
    const result = await query(
      `INSERT INTO scan_jobs (programme_id, scan_profile_id, status, agents_assigned)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        programmeId,
        scanProfileId || null,
        'running',
        JSON.stringify(validatedAgentIds)
      ]
    );
    const scanJob = result.rows[0];

    // Launch the scan in the background (long-running; not awaited)
    const launcher = useHarness
      ? launchHarnessScan(scanJob.id, programmeId)
      : launchCoordinatedScan(scanJob.id, programmeId, validatedAgentIds);

    launcher.catch((error) => {
      console.error('Scan orchestration failed:', error);
      query(
        `UPDATE scan_jobs SET status = 'failed', finished_at = NOW() WHERE id = $1`,
        [scanJob.id]
      );
    });

    return NextResponse.json({ scanJob: { ...scanJob, engine: useHarness ? 'harness' : 'legacy' } }, { status: 201 });
  } catch (error: any) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to create scan job' }, { status: 500 });
  }
}