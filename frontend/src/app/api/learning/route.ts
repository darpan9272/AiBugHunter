import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { spawn } from 'child_process';
import { resolveCredential } from '@/lib/credentials';
import path from 'path';

/**
 * GET /api/learning — history of learning runs + current strategy.
 */
export async function GET() {
  try {
    const runs = await query(
      `SELECT lr.id, lr.status, lr.outcomes_seen, lr.new_version, lr.started_at, lr.finished_at,
              LEFT(lr.log, 400) AS log_preview, p.name AS provider_name
       FROM learning_runs lr
       LEFT JOIN ai_providers p ON p.id = lr.provider_id
       ORDER BY lr.started_at DESC LIMIT 20`
    );
    const strategy = await query(
      `SELECT version, config, meta_reasoning, created_at FROM strategy_versions ORDER BY version DESC LIMIT 1`
    );
    return NextResponse.json({ runs: runs.rows, strategy: strategy.rows[0] || null });
  } catch (error) {
    console.error('learning GET:', error);
    return NextResponse.json({ error: 'Failed to fetch learning data' }, { status: 500 });
  }
}

/**
 * POST /api/learning — trigger a learning cycle.
 * Body: { providerId?, model?, days? }
 * Runs learning-engine/meta_agent.py with the chosen provider's credentials.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { providerId, model, days } = body as {
      providerId?: string;
      model?: string;
      days?: number;
    };

    // Resolve provider credentials → env for the Python meta-agent
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (providerId) {
      const res = await query(`SELECT * FROM ai_providers WHERE id = $1`, [providerId]);
      if (res.rows.length === 0) return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
      const p = res.rows[0];
      if (p.kind === 'anthropic') {
        env.ANTHROPIC_API_KEY = resolveCredential(p.api_key);
        delete env.LEARNING_BASE_URL;
      } else {
        env.LEARNING_BASE_URL =
          p.kind === 'ollama'
            ? `${(p.base_url || 'http://localhost:11434').replace(/\/+$/, '')}/v1`
            : p.base_url || '';
        env.LEARNING_API_KEY = resolveCredential(p.api_key) || '';
      }
      if (model) env.LEARNING_MODEL = model;
    }

    // Create run record
    const runRes = await query(
      `INSERT INTO learning_runs (provider_id, status) VALUES ($1, 'running') RETURNING id`,
      [providerId || null]
    );
    const runId = runRes.rows[0].id;

    const script = path.join(process.cwd(), '..', 'learning-engine', 'meta_agent.py');
    const fs = await import('fs');
    const venvPython = path.join(process.cwd(), '..', '.venv', 'bin', 'python');
    const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
    const child = spawn(pythonBin, [script, '--days', String(days || 7), '--json'], {
      env,
      cwd: path.join(process.cwd(), '..', 'learning-engine'),
    });

    let output = '';
    child.stdout.on('data', (d) => (output += d.toString()));
    child.stderr.on('data', (d) => (output += d.toString()));

    child.on('close', async (code) => {
      try {
        const jsonPart = output.split('===RESULT_JSON===').pop() || '';
        let parsed: { version?: number; error?: string } = {};
        try {
          parsed = JSON.parse(jsonPart.trim());
        } catch {
          /* keep raw log */
        }
        const ok = code === 0 && !parsed.error;
        await query(
          `UPDATE learning_runs
           SET status = $1, finished_at = NOW(), log = $2,
               new_version = $3
           WHERE id = $4`,
          [ok ? 'done' : 'failed', output.slice(-8000), parsed.version || null, runId]
        );
      } catch (e) {
        console.error('learning run finalize failed:', e);
      }
    });

    return NextResponse.json({ runId, status: 'running' }, { status: 202 });
  } catch (error) {
    console.error('learning POST:', error);
    return NextResponse.json({ error: 'Failed to start learning cycle' }, { status: 500 });
  }
}
