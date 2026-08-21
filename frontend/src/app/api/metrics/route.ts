import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  try {
    const [programmes, findings, highSev, exploits, reports] = await Promise.all([
      query(`SELECT COUNT(*) as count FROM programmes`),
      query(`SELECT COUNT(*) as count FROM findings`),
      query(`SELECT COUNT(*) as count FROM findings WHERE triage_score >= 0.7`),
      query(`SELECT COUNT(*) as count FROM exploit_attempts`),
      query(`SELECT COUNT(*) as count FROM bug_reports`),
    ]);

    return NextResponse.json({
      activeTargets: parseInt(programmes.rows[0].count, 10),
      totalFindings: parseInt(findings.rows[0].count, 10),
      highSeverity: parseInt(highSev.rows[0].count, 10),
      totalExploits: parseInt(exploits.rows[0].count, 10),
      totalReports: parseInt(reports.rows[0].count, 10),
      agentsRunning: 3,
    });
  } catch (error) {
    console.error('Database Error:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
