import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { search, AssetType } from '@/lib/explore';
import { getToolServers, callTool } from '@/lib/tools';

/**
 * POST /api/watch/check — run all enabled watch rules.
 * Detects NEW assets matching each rule since last check → fires webhook + records.
 * ("Know when it changes" — Profundis alerting.)
 */
export async function POST() {
  try {
    const rules = await query(`SELECT * FROM watch_rules WHERE enabled = TRUE`);
    const results: { rule: string; new_matches: number; alerted: boolean }[] = [];

    const servers = await getToolServers(true);
    const reportServer = servers.find((s) =>
      (s.tools_cache || []).some((t: { name: string }) => t.name === 'submit_to_webhook')
    );

    for (const rule of rules.rows) {
      const res = await search({
        type: (rule.asset_type || 'hosts') as AssetType,
        q: rule.query,
        programmeId: rule.programme_id || undefined,
        limit: 200,
      });
      const keyOf = (r: Record<string, unknown>) =>
        String(r.host || r.name || r.subject_cn || r.id || JSON.stringify(r));
      const currentKeys = (res.rows as Record<string, unknown>[]).map(keyOf);
      const previous = new Set((rule.seen_keys as string[]) || []);
      const newKeys = previous.size === 0 ? [] : currentKeys.filter((k) => !previous.has(k));
      // first run = baseline, no alert storm
      let alerted = false;

      if (newKeys.length > 0) {
        if (rule.webhook && reportServer) {
          const def = (reportServer.tools_cache || []).find((t: { name: string }) => t.name === 'submit_to_webhook')!;
          await callTool({ server: reportServer, def }, {
            webhook_url: rule.webhook,
            title: `🔔 Watch alert: ${rule.name}`,
            summary: `${newKeys.length} new asset(s) matching "${rule.query}":\n${newKeys.slice(0, 10).join('\n')}`,
          });
          alerted = true;
        }
      }

      await query(
        `UPDATE watch_rules SET seen_keys = $1, last_match_at = NOW() WHERE id = $2`,
        [JSON.stringify(currentKeys.slice(0, 1000)), rule.id]
      );
      results.push({ rule: rule.name, new_matches: newKeys.length, alerted });
    }
    return NextResponse.json({ checked: rules.rows.length, results });
  } catch (error) {
    console.error('watch check:', error);
    return NextResponse.json({ error: 'Watch check failed' }, { status: 500 });
  }
}
