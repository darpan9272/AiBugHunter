import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import crypto from 'crypto';

/**
 * GET /api/asm/alert-channels — List all alert channels
 * POST /api/asm/alert-channels — Create new alert channel
 * Body: { name, type, config, description }
 * 
 * Types: email, slack, discord, pagerduty, opsgenie, teams, webhook
 * Config examples:
 * - email: { recipients: ["a@b.com"], template: "default" }
 * - slack: { webhook_url: "https://hooks.slack.com/...", template: "slack" }
 * - discord: { webhook_url: "https://discord.com/api/webhooks/...", template: "discord" }
 * - pagerduty: { service_key: "xxx", severity: "critical" }
 * - opsgenie: { api_key: "xxx", priority: "P1" }
 * - teams: { webhook_url: "https://outlook.office.com/webhook/..." }
 * - webhook: { url: "https://...", method: "POST", headers: {}, template: "custom" }
 */
export async function GET() {
  try {
    const res = await query(
      `SELECT id, name, type, config, enabled, description, created_at, updated_at
       FROM alert_channels ORDER BY created_at DESC`
    );
    return NextResponse.json({ channels: res.rows });
  } catch (error) {
    console.error('alert channels GET:', error);
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, type, config, description } = body;

    if (!name || !type || !config) {
      return NextResponse.json({ error: 'name, type, and config are required' }, { status: 400 });
    }

    const validTypes = ['email', 'slack', 'discord', 'pagerduty', 'opsgenie', 'teams', 'webhook'];
    if (!validTypes.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${validTypes.join(', ')}` }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO alert_channels (name, type, config, description)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, type, JSON.stringify(config), description || null]
    );

    return NextResponse.json({ channel: res.rows[0] }, { status: 201 });
  } catch (error) {
    console.error('alert channels POST:', error);
    return NextResponse.json({ error: 'Failed to create channel' }, { status: 500 });
  }
}

/**
 * PATCH /api/asm/alert-channels — Update alert channel
 * Body: { id, name?, config?, enabled?, description? }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, name, config, enabled, description } = body;

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIdx = 0;

    if (name !== undefined) {
      paramIdx++;
      updates.push(`name = $${paramIdx}`);
      params.push(name);
    }
    if (config !== undefined) {
      paramIdx++;
      updates.push(`config = $${paramIdx}`);
      params.push(JSON.stringify(config));
    }
    if (enabled !== undefined) {
      paramIdx++;
      updates.push(`enabled = $${paramIdx}`);
      params.push(enabled);
    }
    if (description !== undefined) {
      paramIdx++;
      updates.push(`description = $${paramIdx}`);
      params.push(description);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    paramIdx++;
    params.push(id);

    const res = await query(
      `UPDATE alert_channels SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    return NextResponse.json({ channel: res.rows[0] });
  } catch (error) {
    console.error('alert channels PATCH:', error);
    return NextResponse.json({ error: 'Failed to update channel' }, { status: 500 });
  }
}

/**
 * DELETE /api/asm/alert-channels?id=xxx
 */
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    await query(`DELETE FROM alert_channels WHERE id = $1`, [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('alert channels DELETE:', error);
    return NextResponse.json({ error: 'Failed to delete channel' }, { status: 500 });
  }
}

/**
 * POST /api/asm/alert-channels/test — Test an alert channel
 * Body: { channelId, testPayload? }
 */
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { channelId, testPayload } = body;

    if (!channelId) {
      return NextResponse.json({ error: 'channelId is required' }, { status: 400 });
    }

    const channel = await query(`SELECT * FROM alert_channels WHERE id = $1 AND enabled = TRUE`, [channelId]);
    if (channel.rows.length === 0) {
      return NextResponse.json({ error: 'Channel not found or disabled' }, { status: 404 });
    }

    const ch = channel.rows[0];
    const payload = testPayload || {
      title: '🧪 Test Alert',
      summary: 'This is a test alert from the ASM platform',
      timestamp: new Date().toISOString(),
    };

    let result: any = { sent: false };

    switch (ch.type) {
      case 'slack':
      case 'discord':
      case 'teams':
      case 'webhook':
        if (ch.config.webhook_url) {
          const res = await fetch(ch.config.webhook_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          result = { sent: res.ok, status: res.status };
        }
        break;
      case 'email':
        // Would integrate with email service
        result = { sent: false, note: 'Email sending not implemented in test' };
        break;
      case 'pagerduty':
        if (ch.config.service_key) {
          // Would integrate with PagerDuty Events API
          result = { sent: false, note: 'PagerDuty integration not implemented in test' };
        }
        break;
      case 'opsgenie':
        if (ch.config.api_key) {
          // Would integrate with OpsGenie API
          result = { sent: false, note: 'OpsGenie integration not implemented in test' };
        }
        break;
    }

    return NextResponse.json({ channel: ch.name, type: ch.type, ...result });
  } catch (error) {
    console.error('alert channel test:', error);
    return NextResponse.json({ error: 'Test failed' }, { status: 500 });
  }
}