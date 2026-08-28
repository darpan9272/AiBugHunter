import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/scan-profiles/[id]
 * Returns a single scan profile by ID.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format (basic check)
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return NextResponse.json({ error: 'Invalid scan profile ID' }, { status: 400 });
    }

    const result = await query(`
      SELECT id, name, description, scan_type, recon_tools, triage_tools, exploit_tools, 
             rate_limit, timeout, safe_mode, evidence_capture, config, created_at, updated_at
      FROM scan_profiles
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Scan profile not found' }, { status: 404 });
    }

    return NextResponse.json({ scanProfile: result.rows[0] });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch scan profile' }, { status: 500 });
  }
}

/**
 * PUT /api/scan-profiles/[id]
 * Updates an existing scan profile.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { 
      name, 
      description, 
      scan_type, 
      recon_tools, 
      triage_tools, 
      exploit_tools, 
      rate_limit, 
      timeout, 
      safe_mode, 
      evidence_capture,
      config
    } = body;

    // Validate UUID format
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return NextResponse.json({ error: 'Invalid scan profile ID' }, { status: 400 });
    }

    // Check if profile exists
    const existing = await query(
      'SELECT id FROM scan_profiles WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Scan profile not found' }, { status: 404 });
    }

    // If name is being changed, check for conflict
    if (name) {
      const nameConflict = await query(
        'SELECT id FROM scan_profiles WHERE name = $1 AND id != $2',
        [name, id]
      );
      if (nameConflict.rows.length > 0) {
        return NextResponse.json(
          { error: 'A scan profile with this name already exists' },
          { status: 409 }
        );
      }
    }

    // Build update query dynamically to only update provided fields
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    const fields = [
      { name: 'name', value: name },
      { name: 'description', value: description },
      { name: 'scan_type', value: scan_type },
      { name: 'recon_tools', value: recon_tools },
      { name: 'triage_tools', value: triage_tools },
      { name: 'exploit_tools', value: exploit_tools },
      { name: 'rate_limit', value: rate_limit },
      { name: 'timeout', value: timeout },
      { name: 'safe_mode', value: safe_mode },
      { name: 'evidence_capture', value: evidence_capture },
      { name: 'config', value: config }
    ];

    for (const field of fields) {
      if (field.value !== undefined) {
        updates.push(`${field.name} = $${paramIndex}`);
        values.push(field.value);
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      // No fields to update
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // Add updated_at timestamp
    updates.push(`updated_at = NOW()`);
    values.push(id); // for WHERE clause

    const queryString = `
      UPDATE scan_profiles
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await query(queryString, values);
    return NextResponse.json({ scanProfile: result.rows[0] });
  } catch (error: any) {
    console.error('Database Error:', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A scan profile with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to update scan profile' }, { status: 500 });
  }
}

/**
 * DELETE /api/scan-profiles/[id]
 * Deletes a scan profile.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format
    if (!id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return NextResponse.json({ error: 'Invalid scan profile ID' }, { status: 400 });
    }

    // Check if profile exists
    const existing = await query(
      'SELECT id FROM scan_profiles WHERE id = $1',
      [id]
    );
    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'Scan profile not found' }, { status: 404 });
    }

    // Check if profile is in use by any scan jobs
    const inUse = await query(
      'SELECT id FROM scan_jobs WHERE scan_profile_id = $1 LIMIT 1',
      [id]
    );
    if (inUse.rows.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete scan profile that is in use by scan jobs' },
        { status: 400 }
      );
    }

    await query('DELETE FROM scan_profiles WHERE id = $1', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to delete scan profile' }, { status: 500 });
  }
}
