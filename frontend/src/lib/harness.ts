/**
 * harness.ts — The customizable pipeline engine.
 *
 * Replaces the hardcoded 3-phase orchestrator with a config-driven engine:
 *   • Phases come from harness_config (user-editable, versioned)
 *   • Prompts come from prompt_templates (user-editable)
 *   • Models come from ai_providers + provider_models (any API or local)
 *   • Tools come from tool_servers (MCP-over-HTTP), called in a real loop
 *
 * The model can call tools by emitting:
 *   ```tool_call
 *   {"tool": "run_subfinder", "args": {"domain": "x.com", "programme": "prog"}}
 *   ```
 * The engine executes the call on the matching tool server and feeds the
 * result back, up to settings.max_tool_rounds.
 */

import { query } from './db';
import { chatWithProvider, ChatMessage } from './ai-providers';
import type { ProviderRecord } from './providers';
import {
  resolveAllowedTools,
  callTool,
  describeTools,
  ToolDef,
  ToolServer,
} from './tools';

interface HarnessPhase {
  key: string;
  name: string;
  template_key: string;
  role: string;
  enabled: boolean;
  default_tools: string[];
  output: 'findings' | 'scores' | 'exploit_attempts';
  min_score?: number;
}

interface HarnessSettings {
  max_tool_rounds: number;
  max_findings_per_phase: number;
  scope_enforced: boolean;
  temperature: number;
  max_tokens: number;
}

interface ResolvedModel {
  provider: ProviderRecord;
  model_id: string;
  nickname: string | null;
}

// ─────────────────────────────────────────────
// Loading config
// ─────────────────────────────────────────────

async function loadHarness(): Promise<{ phases: HarnessPhase[]; settings: HarnessSettings }> {
  const res = await query(`SELECT phases, settings FROM harness_config WHERE active = TRUE ORDER BY version DESC LIMIT 1`);
  if (res.rows.length === 0) throw new Error('No active harness_config found');
  return { phases: res.rows[0].phases, settings: res.rows[0].settings };
}

async function loadTemplate(key: string): Promise<string> {
  const res = await query(`SELECT content FROM prompt_templates WHERE key = $1`, [key]);
  if (res.rows.length === 0) throw new Error(`Prompt template '${key}' not found`);
  return res.rows[0].content;
}

/** Pick the best enabled model for a role: role match first, then any enabled model. */
async function resolveModel(role: string): Promise<ResolvedModel | null> {
  const base = `
    SELECT pm.model_id, pm.role, pm.nickname,
           p.id AS pid, p.name AS pname, p.kind, p.base_url, p.api_key, p.is_local
    FROM provider_models pm
    JOIN ai_providers p ON p.id = pm.provider_id
    WHERE pm.enabled = TRUE AND p.enabled = TRUE
  `;
  let res = await query(`${base} AND pm.role = $1 ORDER BY pm.nickname NULLS LAST LIMIT 1`, [role]);
  if (res.rows.length === 0) res = await query(`${base} ORDER BY pm.role LIMIT 1`);
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    provider: {
      id: r.pid,
      name: r.pname,
      kind: r.kind,
      base_url: r.base_url,
      api_key: r.api_key,
      is_local: r.is_local,
      enabled: true,
    },
    model_id: r.model_id,
    nickname: r.nickname,
  };
}

// ─────────────────────────────────────────────
// Agent loop with real tool calling
// ─────────────────────────────────────────────

const TOOL_CALL_RE = /```tool_call\s*\n?([\s\S]*?)```/;

interface LoopResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
}

async function runAgentLoop(opts: {
  model: ResolvedModel;
  systemPrompt: string;
  userPrompt: string;
  tools: Map<string, { server: ToolServer; def: ToolDef }>;
  programmeName: string;
  settings: HarnessSettings;
  onEvent: (action: string, detail: string, pt?: number, ct?: number) => Promise<void>;
}): Promise<LoopResult> {
  const { model, systemPrompt, userPrompt, tools, programmeName, settings, onEvent } = opts;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let promptTokens = 0;
  let completionTokens = 0;
  let toolCalls = 0;
  let lastText = '';

  for (let round = 0; round <= settings.max_tool_rounds; round++) {
    const res = await chatWithProvider(model.provider, model.model_id, messages, {
      maxTokens: settings.max_tokens,
      temperature: settings.temperature,
    });
    promptTokens += res.promptTokens;
    completionTokens += res.completionTokens;
    lastText = res.text;

    const match = res.text.match(TOOL_CALL_RE);
    if (!match) break; // no tool requested → final answer

    let parsed: { tool?: string; args?: Record<string, unknown> };
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      messages.push({ role: 'assistant', content: res.text });
      messages.push({
        role: 'user',
        content: 'Your tool_call block was not valid JSON. Fix it or give your FINAL answer.',
      });
      continue;
    }

    const entry = parsed.tool ? tools.get(parsed.tool) : undefined;
    if (!entry) {
      messages.push({ role: 'assistant', content: res.text });
      messages.push({
        role: 'user',
        content: `Tool '${parsed.tool}' is not available. Available: ${[...tools.keys()].join(', ') || 'none'}. Try another or give your FINAL answer.`,
      });
      continue;
    }

    // Scope enforcement: always bind tool calls to the programme being scanned
    const args = { ...(parsed.args || {}) };
    if (settings.scope_enforced && entry.def.inputSchema?.properties) {
      const props = entry.def.inputSchema.properties as Record<string, unknown>;
      if ('programme' in props && !args.programme) args.programme = programmeName;
    }

    toolCalls++;
    await onEvent('Tool Call', `${parsed.tool} ${JSON.stringify(args).slice(0, 200)}`);
    const out = await callTool(entry, args);
    const resultText = out.ok
      ? (out.result || '').slice(0, 6000)
      : `TOOL ERROR: ${out.error}`;
    await onEvent(
      out.ok ? 'Tool Result' : 'Tool Error',
      `${parsed.tool} → ${resultText.slice(0, 300)}`,
    );

    messages.push({ role: 'assistant', content: res.text });
    messages.push({ role: 'user', content: `TOOL OUTPUT (${parsed.tool}):\n${resultText}\n\nContinue, call another tool, or output your FINAL answer.` });
  }

  return { text: lastText, promptTokens, completionTokens, toolCalls };
}

/** Extract the first JSON array from a model reply. */
function extractJsonArray(text: string): unknown[] | null {
  // Prefer fenced ```json blocks
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/g);
  const candidates = fenced
    ? fenced.map((b) => b.replace(/```(?:json)?\s*\n?/, '').replace(/```$/, ''))
    : [];
  candidates.push(text);
  for (const c of candidates) {
    const m = c.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        /* try next candidate */
      }
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────

export async function launchHarnessScan(
  scanJobId: string,
  programmeId: string
): Promise<void> {
  const log = async (action: string, detail: string, pt = 0, ct = 0, agentLabel: string | null = null) => {
    try {
      await query(
        `INSERT INTO agent_activity (scan_job_id, agent_id, action, detail, prompt_tokens, completion_tokens)
         VALUES ($1, NULL, $2, $3, $4, $5)`,
        [scanJobId, action, agentLabel ? `[${agentLabel}] ${detail}` : detail, pt, ct]
      );
    } catch (e) {
      console.error('activity log failed:', e);
    }
  };

  try {
    // ── Load context ──
    const progRes = await query(`SELECT * FROM programmes WHERE id = $1`, [programmeId]);
    if (progRes.rows.length === 0) throw new Error('Programme not found');
    const programme = progRes.rows[0];

    const { phases, settings } = await loadHarness();
    await log('Harness Started', `Pipeline v(latest) · ${phases.filter((p) => p.enabled).length} phases · scope: ${JSON.stringify(programme.scope).slice(0, 200)}`);

    const scopeJson = JSON.stringify(programme.scope);

    for (const phase of phases) {
      if (!phase.enabled) {
        await log(`Phase Skipped`, `${phase.name} is disabled in harness config.`);
        continue;
      }

      await log('Phase Start', phase.name);

      const model = await resolveModel(phase.role);
      if (!model) {
        await log('Phase Skipped', `No enabled model for role '${phase.role}'. Enable one in Connect AI.`);
        continue;
      }
      const modelLabel = model.nickname || `${model.provider.name}/${model.model_id}`;

      // Resolve tools for this phase
      const tools = await resolveAllowedTools(phase.default_tools || []);
      const toolHint = describeTools(tools);

      const template = await loadTemplate(phase.template_key);

      // ── Phase-specific input ──
      let inputBlock = '';
      let targetRows: { id: string; type: string; target: string; metadata: unknown }[] = [];

      if (phase.output === 'findings') {
        inputBlock = 'Begin reconnaissance now.';
      } else {
        const minScore = phase.min_score ?? 0;
        const params: unknown[] = [programmeId];
        let sql = `SELECT id, type, target, metadata FROM findings WHERE programme_id = $1`;
        if (minScore > 0) {
          params.push(minScore);
          sql += ` AND triage_score >= $2`;
        } else {
          sql += ` AND triage_score IS NULL`;
        }
        params.push(settings.max_findings_per_phase);
        sql += ` ORDER BY triage_score DESC NULLS LAST LIMIT $${params.length}`;
        const fRes = await query(sql, params);
        targetRows = fRes.rows;
        if (targetRows.length === 0) {
          await log('Phase Skipped', `${phase.name}: nothing to process.`);
          continue;
        }
        inputBlock = `Process these ${targetRows.length} items.`;
      }

      const systemPrompt = template
        .replace(/\{\{scope\}\}/g, scopeJson)
        .replace(/\{\{programme\}\}/g, programme.name)
        .replace(/\{\{tool_hint\}\}/g, toolHint)
        .replace(/\{\{findings\}\}/g, JSON.stringify(targetRows));

      const loop = await runAgentLoop({
        model,
        systemPrompt,
        userPrompt: inputBlock,
        tools,
        programmeName: programme.name,
        settings,
        onEvent: (action, detail, pt, ct) => log(action, detail, pt, ct, modelLabel),
      });

      await log('Model Response', `${loop.text.slice(0, 300)}${loop.text.length > 300 ? '…' : ''}`, loop.promptTokens, loop.completionTokens, modelLabel);

      const parsed = extractJsonArray(loop.text);
      if (!parsed) {
        await log('Parse Warning', `${phase.name}: model returned no parseable JSON array.`, 0, 0, modelLabel);
        continue;
      }

      // ── Persist outputs ──
      if (phase.output === 'findings') {
        let inserted = 0;
        for (const f of parsed as { type?: string; target?: string; metadata?: unknown }[]) {
          if (!f.type || !f.target) continue;
          await query(
            `INSERT INTO findings (programme_id, type, target, metadata, triage_reason)
             VALUES ($1, $2, $3, $4, $5)`,
            [programme.id, f.type, f.target, JSON.stringify(f.metadata || {}), `harness:${phase.key}:${modelLabel}`]
          );
          inserted++;
        }
        await log('Phase Complete', `${phase.name}: stored ${inserted} findings (${loop.toolCalls} tool calls).`, 0, 0, modelLabel);
      } else if (phase.output === 'scores') {
        let updated = 0;
        for (const s of parsed as { id?: string; score?: number; reason?: string }[]) {
          if (!s.id || s.score === undefined) continue;
          await query(`UPDATE findings SET triage_score = $1, triage_reason = $2 WHERE id = $3 AND programme_id = $4`, [
            Math.max(0, Math.min(1, Number(s.score))),
            s.reason || `harness:${phase.key}`,
            s.id,
            programmeId,
          ]);
          updated++;
        }
        await log('Phase Complete', `${phase.name}: scored ${updated} findings.`, 0, 0, modelLabel);
      } else if (phase.output === 'exploit_attempts') {
        let stored = 0;
        for (const r of parsed as { id?: string; success?: boolean; vulnerability_type?: string; evidence?: unknown; confidence?: number; payload?: string }[]) {
          if (!r.id) continue;
          await query(
            `INSERT INTO exploit_attempts (finding_id, agent_type, payload, response_snippet, success, confidence, evidence)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              r.id,
              r.vulnerability_type || phase.key,
              r.payload || '',
              JSON.stringify(r.evidence || {}).slice(0, 500),
              !!r.success,
              r.confidence ?? 0.5,
              JSON.stringify({ ...(typeof r.evidence === 'object' && r.evidence ? r.evidence : {}), harness: true, model: modelLabel, tool_calls: loop.toolCalls }),
            ]
          );
          stored++;
        }
        await log('Phase Complete', `${phase.name}: recorded ${stored} validation attempts.`, 0, 0, modelLabel);
      }
    }

    await query(`UPDATE scan_jobs SET status = 'completed', finished_at = NOW() WHERE id = $1`, [scanJobId]);
    await log('Harness Complete', 'All enabled phases finished.');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Harness error:', error);
    await log('Fatal Error', `Harness failed: ${msg}`);
    await query(`UPDATE scan_jobs SET status = 'failed', finished_at = NOW() WHERE id = $1`, [scanJobId]);
  }
}
