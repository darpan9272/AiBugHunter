import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * GET /api/scan-profiles
 * Returns a list of all scan profiles.
 */
export async function GET() {
  try {
    const result = await query(`
      SELECT id, name, description, scan_type, recon_tools, triage_tools, exploit_tools, 
             rate_limit, timeout, safe_mode, evidence_capture, config, created_at, updated_at
      FROM scan_profiles
      ORDER BY name
    `);
    return NextResponse.json({ scanProfiles: result.rows });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch scan profiles' }, { status: 500 });
  }
}

/**
 * POST /api/scan-profiles
 * Creates a new scan profile.
 */
export async function POST(request: Request) {
  try {
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

    // Basic validation
    if (!name || !scan_type) {
      return NextResponse.json(
        { error: 'Name and scan type are required' },
        { status: 400 }
      );
    }

    // Check if profile with this name already exists
    const existing = await query(
      'SELECT id FROM scan_profiles WHERE name = $1',
      [name]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json(
        { error: 'A scan profile with this name already exists' },
        { status: 409 }
      );
    }

    const result = await query(`
      INSERT INTO scan_profiles (
        name, description, scan_type, recon_tools, triage_tools, exploit_tools, 
        rate_limit, timeout, safe_mode, evidence_capture, config
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      name,
      description || null,
      scan_type,
      recon_tools || [],
      triage_tools || [],
      exploit_tools || [],
      rate_limit ?? 10,
      timeout ?? 3600,
      safe_mode ?? true,
      evidence_capture ?? true,
      config || {}
    ]);

    return NextResponse.json({ scanProfile: result.rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error('Database Error:', error);
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A scan profile with this name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create scan profile' }, { status: 500 });
  }
}
