/**
 * session-engine.ts — Interactive pentest engagement engine.
 *
 * pentest-harness style features:
 *   • Durable sessions — every event persisted (JSONL-style), replay/resume
 *   • Full toolset — security MCP tools + sandbox (shell/fs/web) + built-ins
 *   • Approval stack — dangerous ops pause for operator approve/deny
 *   • Context that never dies — token metering, tool-result pruning, compaction
 *   • Skills & goals — loadable playbooks, objective tracking
 */

import { query } from './db';
import { chatWithProvider, ChatMessage } from './ai-providers';
import type { ProviderRecord } from './providers';
import { resolveAllowedTools, callTool, describeTools, ToolDef, ToolServer } from './tools';

// ── Policy ──
const DANGEROUS_TOOLS = new Set([
  'run_shell', 'fs_write',
  'run_sqlmap', 'run_dalfox', 'run_nuclei_exploit', 'run_ffuf',
  'test_ssrf', 'test_jwt', 'run_nmap_scan',
]);
const PRUNE_THRESHOLD = 8192;
const PRUNE_HEAD = 4096;
const PRUNE_TAIL = 1024;
const CONTEXT_TOKEN_BUDGET = 96_000;   // compact above this
const KEEP_RECENT_EVENTS = 24;         // events kept verbatim after compaction
const MAX_TOOL_ROUNDS = 12;

const TOOL_CALL_RE = /```tool_call\s*\n?([\s\S]*?)```/;

interface SessionRow {
  id: string;
  programme_id: string | null;
  provider_id: string | null;
  model_id: string | null;
  mode: string;
  context_tokens: number;
}

// ─────────────────────────────────────────────
// Event log
// ─────────────────────────────────────────────

async function nextSeq(sessionId: string): Promise<number> {
  const r = await query(`SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM session_events WHERE session_id = $1`, [sessionId]);
  return r.rows[0].s;
}

export async function appendEvent(
  sessionId: string,
  role: string,
  content: string,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const seq = await nextSeq(sessionId);
  await query(
    `INSERT INTO session_events (session_id, seq, role, content, meta) VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, seq, role, content, JSON.stringify(meta)]
  );
  await query(`UPDATE sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
}

/** Prune huge tool outputs (pentest-harness tool-result-pruner defaults). */
function pruneToolResult(text: string): string {
  if (text.length <= PRUNE_THRESHOLD) return text;
  return `${text.slice(0, PRUNE_HEAD)}\n…[${text.length - PRUNE_HEAD - PRUNE_TAIL} chars pruned]…\n${text.slice(-PRUNE_TAIL)}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─────────────────────────────────────────────
// Session setup
// ─────────────────────────────────────────────

export async function createSession(opts: {
  programmeId?: string;
  providerId: string;
  modelId: string;
  title?: string;
}): Promise<{ id: string }> {
  const res = await query(
    `INSERT INTO sessions (programme_id, provider_id, model_id, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [opts.programmeId || null, opts.providerId, opts.modelId, opts.title || 'New engagement']
  );
  const id = res.rows[0].id;
  await appendEvent(id, 'system', 'Session started. Pentest Mode engaged.', {
    provider_id: opts.providerId,
    model: opts.modelId,
  });
  return { id };
}

async function getSession(sessionId: string): Promise<SessionRow> {
  const r = await query(`SELECT * FROM sessions WHERE id = $1`, [sessionId]);
  if (r.rows.length === 0) throw new Error('Session not found');
  return r.rows[0];
}

async function resolveSessionModel(s: SessionRow): Promise<{ provider: ProviderRecord; modelId: string }> {
  const r = await query(`SELECT * FROM ai_providers WHERE id = $1`, [s.provider_id]);
  if (r.rows.length === 0) throw new Error('Session provider no longer exists');
  const p = r.rows[0];
  return {
    provider: {
      id: p.id, name: p.name, kind: p.kind, base_url: p.base_url,
      api_key: p.api_key, is_local: p.is_local, enabled: p.enabled,
    },
    modelId: s.model_id || '',
  };
}

// ─────────────────────────────────────────────
// Persona + tools
// ─────────────────────────────────────────────

async function buildSystemPrompt(s: SessionRow, tools: Map<string, { server: ToolServer; def: ToolDef }>): Promise<string> {
  const tpl = await query(`SELECT content FROM prompt_templates WHERE key = 'pentest_persona'`);
  const persona = tpl.rows[0]?.content || 'You are Pentest Mode, a professional offensive-security agent.';

  let scope = 'none declared — confirm scope with the operator before active testing';
  if (s.programme_id) {
    const p = await query(`SELECT name, scope FROM programmes WHERE id = $1`, [s.programme_id]);
    if (p.rows.length > 0) scope = `${p.rows[0].name}: ${JSON.stringify(p.rows[0].scope)}`;
  }

  const builtins = [
    'BUILT-IN TOOLS (handled by the harness directly):',
    '- load_skill(key): load a pentest playbook into your context',
    '- list_skills(): list available playbooks',
    '- goal_add(text) / goal_update(id, status) / goal_list(): track engagement objectives',
  ].join('\n');

  return persona
    .replace(/\{\{scope\}\}/g, scope)
    .replace(/\{\{tool_hint\}\}/g, `${describeTools(tools)}\n\n${builtins}`);
}

// ─────────────────────────────────────────────
// Context assembly with compaction
// ─────────────────────────────────────────────

function mechanicalSummary(events: { role: string; content: string }[]): string {
  const lines: string[] = [];
  for (const e of events) {
    if (e.role === 'user') lines.push(`Operator: ${e.content.slice(0, 150)}`);
    else if (e.role === 'assistant') lines.push(`Agent: ${e.content.slice(0, 150)}`);
    else if (e.role === 'tool_call') lines.push(`Called: ${e.content.slice(0, 120)}`);
    else if (e.role === 'tool_result') lines.push(`Result: ${e.content.slice(0, 120)}`);
  }
  return lines.join('\n').slice(0, 6000);
}

async function buildMessages(
  s: SessionRow,
  systemPrompt: string
): Promise<{ messages: ChatMessage[]; compacted: boolean }> {
  const evRes = await query(
    `SELECT role, content, meta FROM session_events WHERE session_id = $1 ORDER BY seq`,
    [s.id]
  );
  const events = evRes.rows;

  const totalTokens = events.reduce((n: number, e) => n + estimateTokens(e.content), 0);
  let compacted = false;
  let working = events;

  if (totalTokens > CONTEXT_TOKEN_BUDGET && events.length > KEEP_RECENT_EVENTS) {
    const old = events.slice(0, events.length - KEEP_RECENT_EVENTS);
    const recent = events.slice(events.length - KEEP_RECENT_EVENTS);
    let summary = mechanicalSummary(old);
    try {
      const { provider, modelId } = await resolveSessionModel(s);
      const res = await chatWithProvider(provider, modelId, [
        { role: 'user', content: `Summarize this pentest session history concisely (actions taken, findings so far, open threads):\n\n${mechanicalSummary(old)}` },
      ], { maxTokens: 1024, temperature: 0.2 });
      if (res.text.trim()) summary = res.text.trim();
    } catch {
      /* fall back to mechanical summary */
    }
    working = [
      { role: 'system', content: `CONTEXT SUMMARY (compacted history):\n${summary}`, meta: {} },
      ...recent,
    ];
    compacted = true;
  }

  const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const e of working) {
    if (e.role === 'user') messages.push({ role: 'user', content: e.content });
    else if (e.role === 'assistant') messages.push({ role: 'assistant', content: e.content });
    else if (e.role === 'system') messages.push({ role: 'user', content: `[SYSTEM] ${e.content}` });
    else if (e.role === 'tool_call') messages.push({ role: 'assistant', content: e.content });
    else if (e.role === 'tool_result') messages.push({ role: 'user', content: e.content });
    // approval_request events are informational; skip in context
  }
  return { messages, compacted };
}

// ─────────────────────────────────────────────
// Built-in tools: skills + goals
// ─────────────────────────────────────────────

async function handleBuiltinTool(name: string, args: Record<string, unknown>, sessionId: string): Promise<string> {
  if (name === 'list_skills') {
    const r = await query(`SELECT key, name, description FROM skills ORDER BY key`);
    return JSON.stringify(r.rows);
  }
  if (name === 'load_skill') {
    const r = await query(`SELECT * FROM skills WHERE key = $1`, [args.key]);
    return r.rows.length ? r.rows[0].content : `Skill not found: ${args.key}`;
  }
  if (name === 'goal_add') {
    const r = await query(
      `INSERT INTO goals (session_id, text) VALUES ($1, $2) RETURNING id, text, status`,
      [sessionId, args.text]
    );
    return JSON.stringify(r.rows[0]);
  }
  if (name === 'goal_update') {
    const r = await query(
      `UPDATE goals SET status = $1, updated_at = NOW() WHERE id = $2 AND session_id = $3 RETURNING *`,
      [args.status, args.id, sessionId]
    );
    return r.rows.length ? JSON.stringify(r.rows[0]) : 'Goal not found';
  }
  if (name === 'goal_list') {
    const r = await query(`SELECT * FROM goals WHERE session_id = $1 ORDER BY created_at`, [sessionId]);
    return JSON.stringify(r.rows);
  }
  return `Unknown built-in tool: ${name}`;
}

const BUILTIN_TOOLS = new Set(['list_skills', 'load_skill', 'goal_add', 'goal_update', 'goal_list']);

// ─────────────────────────────────────────────
// Main agent loop
// ─────────────────────────────────────────────

export async function runAgent(sessionId: string): Promise<{ status: 'idle' | 'awaiting_approval' | 'error'; error?: string }> {
  try {
    const s = await getSession(sessionId);

    // Never run while an approval is pending
    const pending = await query(
      `SELECT id FROM approvals WHERE session_id = $1 AND status = 'pending' LIMIT 1`,
      [sessionId]
    );
    if (pending.rows.length > 0) return { status: 'awaiting_approval' };

    const { provider, modelId } = await resolveSessionModel(s);
    if (!provider.enabled) throw new Error(`Provider "${provider.name}" is disabled`);

    const tools = await resolveAllowedTools([]); // all enabled tool servers
    const systemPrompt = await buildSystemPrompt(s, tools);

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { messages, compacted } = await buildMessages(s, systemPrompt);
      if (compacted) await appendEvent(sessionId, 'system', 'Context compacted to fit token budget.', { compacted: true });

      const res = await chatWithProvider(provider, modelId, messages, {
        maxTokens: 4096,
        temperature: 0.3,
      });

      await query(`UPDATE sessions SET context_tokens = $1 WHERE id = $2`, [res.promptTokens, sessionId]);

      const match = res.text.match(TOOL_CALL_RE);
      if (!match) {
        await appendEvent(sessionId, 'assistant', res.text, {
          prompt_tokens: res.promptTokens,
          completion_tokens: res.completionTokens,
        });
        return { status: 'idle' };
      }

      // ── Tool call requested ──
      await appendEvent(sessionId, 'tool_call', res.text, {});

      let parsed: { tool?: string; args?: Record<string, unknown> };
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        await appendEvent(sessionId, 'tool_result', 'Your tool_call block was invalid JSON. Re-emit it correctly or answer.', { error: 'parse' });
        continue;
      }
      const toolName = parsed.tool || '';
      const args = parsed.args || {};

      // Built-ins execute immediately
      if (BUILTIN_TOOLS.has(toolName)) {
        const out = await handleBuiltinTool(toolName, args, sessionId);
        await appendEvent(sessionId, 'tool_result', `TOOL OUTPUT (${toolName}):\n${pruneToolResult(out)}`, { tool: toolName });
        continue;
      }

      const entry = tools.get(toolName);
      if (!entry) {
        await appendEvent(sessionId, 'tool_result', `Tool '${toolName}' not available. Available: ${[...tools.keys()].join(', ')}.`, { error: 'unknown_tool' });
        continue;
      }

      // Bind programme scope into tool calls when the server supports it
      if (s.programme_id && entry.def.inputSchema?.properties) {
        const props = entry.def.inputSchema.properties as Record<string, unknown>;
        if ('programme' in props && !args.programme) {
          const p = await query(`SELECT name FROM programmes WHERE id = $1`, [s.programme_id]);
          if (p.rows.length > 0) args.programme = p.rows[0].name;
        }
      }

      // ── Approval gate for dangerous operations ──
      if (DANGEROUS_TOOLS.has(toolName)) {
        const ap = await query(
          `INSERT INTO approvals (session_id, tool, args) VALUES ($1, $2, $3) RETURNING id`,
          [sessionId, toolName, JSON.stringify(args)]
        );
        await appendEvent(sessionId, 'approval_request', `Approval required for ${toolName}: ${JSON.stringify(args).slice(0, 300)}`, {
          approval_id: ap.rows[0].id,
          tool: toolName,
        });
        return { status: 'awaiting_approval' };
      }

      const out = await callTool(entry, args);
      const text = out.ok ? out.result || '' : `TOOL ERROR: ${out.error}`;
      await appendEvent(sessionId, 'tool_result', `TOOL OUTPUT (${toolName}):\n${pruneToolResult(text)}`, {
        tool: toolName,
        ok: out.ok,
      });
    }

    await appendEvent(sessionId, 'system', 'Tool round limit reached. Send another message to continue.', {});
    return { status: 'idle' };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await appendEvent(sessionId, 'system', `Engine error: ${msg}`, { error: true });
    return { status: 'error', error: msg };
  }
}

/** Resume after an approval decision. */
export async function resolveApproval(
  approvalId: string,
  approve: boolean
): Promise<{ status: 'idle' | 'awaiting_approval' | 'error'; error?: string }> {
  const ap = await query(`SELECT * FROM approvals WHERE id = $1`, [approvalId]);
  if (ap.rows.length === 0) throw new Error('Approval not found');
  const a = ap.rows[0];
  if (a.status !== 'pending') throw new Error('Approval already resolved');

  await query(
    `UPDATE approvals SET status = $1, resolved_at = NOW() WHERE id = $2`,
    [approve ? 'approved' : 'denied', approvalId]
  );

  if (!approve) {
    await appendEvent(a.session_id, 'tool_result', `OPERATOR DENIED the ${a.tool} call. Choose a different approach or ask why.`, {
      tool: a.tool,
      denied: true,
    });
  } else {
    const tools = await resolveAllowedTools([]);
    const entry = tools.get(a.tool);
    if (!entry) {
      await appendEvent(a.session_id, 'tool_result', `Tool ${a.tool} is no longer available.`, { error: true });
    } else {
      const out = await callTool(entry, a.args || {});
      const text = out.ok ? out.result || '' : `TOOL ERROR: ${out.error}`;
      await appendEvent(a.session_id, 'tool_result', `TOOL OUTPUT (${a.tool}, approved):\n${pruneToolResult(text)}`, {
        tool: a.tool,
        ok: out.ok,
        approved: true,
      });
    }
  }

  return runAgent(a.session_id);
}
