/**
 * tools.ts — Tool Server client for the harness engine.
 *
 * Tool servers expose MCP tools over a small HTTP bridge:
 *   GET  /tools          → [{name, description, inputSchema}]
 *   POST /call           → {name, arguments} → {result}
 */

import { query } from './db';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface ToolServer {
  id: string;
  name: string;
  url: string;
  kind: string;
  enabled: boolean;
  tools_cache: ToolDef[];
}

export async function getToolServers(enabledOnly = true): Promise<ToolServer[]> {
  const res = await query(
    `SELECT * FROM tool_servers ${enabledOnly ? 'WHERE enabled = TRUE' : ''} ORDER BY name`
  );
  return res.rows;
}

/** Fetch live tool list from a server and cache it in the DB. */
export async function refreshToolServer(server: ToolServer): Promise<{ tools: ToolDef[]; error?: string }> {
  try {
    const res = await fetch(`${server.url.replace(/\/+$/, '')}/tools`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { tools: [], error: `HTTP ${res.status}` };
    const tools: ToolDef[] = await res.json();
    await query(`UPDATE tool_servers SET tools_cache = $1, last_seen = NOW() WHERE id = $2`, [
      JSON.stringify(tools),
      server.id,
    ]);
    return { tools };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { tools: server.tools_cache || [], error: msg };
  }
}

/** Build a flat map of allowed tool name → server for a scan. */
export async function resolveAllowedTools(
  allowedNames: string[]
): Promise<Map<string, { server: ToolServer; def: ToolDef }>> {
  const servers = await getToolServers(true);
  const map = new Map<string, { server: ToolServer; def: ToolDef }>();
  for (const server of servers) {
    const tools: ToolDef[] =
      server.tools_cache?.length ? server.tools_cache : (await refreshToolServer(server)).tools;
    for (const def of tools) {
      if (!allowedNames.length || allowedNames.includes(def.name)) {
        map.set(def.name, { server, def });
      }
    }
  }
  return map;
}

/** Execute one tool call on its server. */
export async function callTool(
  entry: { server: ToolServer; def: ToolDef },
  args: Record<string, unknown>,
  timeoutMs = 300_000
): Promise<{ ok: boolean; result?: string; error?: string }> {
  try {
    const res = await fetch(`${entry.server.url.replace(/\/+$/, '')}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: entry.def.name, arguments: args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return { ok: true, result: typeof data.result === 'string' ? data.result : JSON.stringify(data.result) };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** Render the tool catalog into a prompt block. */
export function describeTools(tools: Map<string, { server: ToolServer; def: ToolDef }>): string {
  if (tools.size === 0) {
    return 'No external tools are available for this phase — reason from your own knowledge.';
  }
  const lines: string[] = [
    'AVAILABLE TOOLS — you may call them by replying with a JSON block:',
    '```tool_call',
    '{"tool": "<tool_name>", "args": { ... }}',
    '```',
    'You will receive the tool output and can continue. Tools:',
    '',
  ];
  for (const [name, { def }] of tools) {
    const schema = def.inputSchema?.properties
      ? Object.keys(def.inputSchema.properties as object).join(', ')
      : '';
    lines.push(`- ${name}(${schema}): ${def.description?.slice(0, 200) || ''}`);
  }
  lines.push('', 'When you have enough information, output your FINAL answer as requested.');
  return lines.join('\n');
}
