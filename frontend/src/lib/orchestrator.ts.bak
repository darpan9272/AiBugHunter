import { query } from './db';
import { Agent, chat } from './ai-providers';

/**
 * Orchestrates multiple AI agents to perform a coordinated bug hunting scan
 * on a given programme.
 */
export async function launchCoordinatedScan(scanJobId: string, programmeId: string, agentIds: string[]) {
  try {
    // 1. Fetch Programme Details
    const progRes = await query(`SELECT * FROM programmes WHERE id = $1`, [programmeId]);
    if (progRes.rows.length === 0) throw new Error('Programme not found');
    const programme = progRes.rows[0];
    
    // 2. Fetch Assigned Agents
    // We only want the active agents among those assigned
    const agentsRes = await query(
      `SELECT * FROM ai_agents WHERE id = ANY($1) AND status = 'active'`,
      [agentIds]
    );
    const agents: Agent[] = agentsRes.rows;

    if (agents.length === 0) {
      await logActivity(scanJobId, null, 'Initialization Failed', 'No active agents found for this scan.');
      await query(`UPDATE scan_jobs SET status = 'failed', finished_at = NOW() WHERE id = $1`, [scanJobId]);
      return;
    }

    await logActivity(scanJobId, null, 'Scan Started', `Orchestrating ${agents.length} agents for ${programme.name}.`);

    // Group agents by role
    const reconAgents = agents.filter(a => a.role === 'recon');
    const vulnAnalyzerAgents = agents.filter(a => a.role === 'vuln_analyzer');
    // For now, if no specialized agents exist, fallback to general ones if needed.
    const generalAgents = agents.filter(a => a.role === 'general' || a.role === 'triage' || a.role === 'exploit'); // simplified fallback

    // ── Phase 1: Reconnaissance ──
    await logActivity(scanJobId, null, 'Phase 1: Recon', 'Starting recon phase across specialized agents.');
    
    const activeReconAgents = reconAgents.length > 0 ? reconAgents : generalAgents;
    
    if(activeReconAgents.length === 0) {
        await logActivity(scanJobId, null, 'Warning', 'No agents capable of Recon found. Skipping recon phase.');
    } else {
        // Parallel fan-out
        const reconPromises = activeReconAgents.map(async (agent) => {
            await logActivity(scanJobId, agent.id, 'Scanning', `Analyzing scope: ${JSON.stringify(programme.scope)}`);
            
            try {
                // Mock prompt for actual tool execution / analysis
                const systemPrompt = `You are a world-class Reconnaissance Agent. Analyze the following in-scope domains: ${JSON.stringify(programme.scope)}. Identify potential subdomains, interesting endpoints, and parameters. Return your findings as a JSON array of objects with keys: type (subdomain/endpoint/param/service), target (the string), and metadata (JSON object).`;
                const response = await chat(agent, [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Begin reconnaissance and output strictly valid JSON array.' }]);
                
                let findings: any[] = [];
                try {
                    // Extract JSON block if surrounded by markdown
                    const jsonMatch = response.text.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                       findings = JSON.parse(jsonMatch[0]);
                    } else {
                       findings = JSON.parse(response.text);
                    }
                } catch (e) {
                   await logActivity(scanJobId, agent.id, 'Warning', 'Failed to parse structured JSON from agent response.', response.promptTokens, response.completionTokens);
                   return; // Skip if it hallucinated non-JSON
                }

                // Insert findings into DB
                for(const f of findings) {
                     if(!f.type || !f.target) continue;
                     await query(
                        `INSERT INTO findings (programme_id, type, target, metadata, triage_reason) VALUES ($1, $2, $3, $4, $5)`,
                        [programme.id, f.type, f.target, JSON.stringify(f.metadata || {}), `Found by agent ${agent.nickname || agent.model}`]
                     );
                }
                
                await logActivity(scanJobId, agent.id, 'Found Assets', `Agent discovered ${findings.length} potential attack surface targets.`, response.promptTokens, response.completionTokens);

            } catch (err: any) {
                await logActivity(scanJobId, agent.id, 'Error', `Recon task failed: ${err.message}`);
            }
        });

        await Promise.allSettled(reconPromises);
    }

    // ── Phase 2: Vulnerability Analysis & Triage ──
    await logActivity(scanJobId, null, 'Phase 2: Vuln Analysis', 'Aggregating findings for vulnerability analysis.');
    
    const activeVulnAgents = vulnAnalyzerAgents.length > 0 ? vulnAnalyzerAgents : generalAgents;
    
    if(activeVulnAgents.length === 0) {
         await logActivity(scanJobId, null, 'Warning', 'No agents capable of Vuln Analysis found. Skipping phase.');
    } else {
        // Fetch new findings
        const findingsRes = await query(`SELECT * FROM findings WHERE programme_id = $1 AND triage_score IS NULL LIMIT 20`, [programme.id]);
        const newFindings = findingsRes.rows;

        if(newFindings.length > 0) {
            const vulnPromises = activeVulnAgents.map(async (agent) => {
                await logActivity(scanJobId, agent.id, 'Analyzing', `Reviewing ${newFindings.length} new findings for vulnerabilities.`);
                
                try {
                    const findingsJson = JSON.stringify(newFindings.map(f => ({id: f.id, type: f.type, target: f.target, metadata: f.metadata})));
                    const systemPrompt = `You are an expert Vulnerability Triage Agent. Analyze these targets: ${findingsJson}. Score their likelihood of containing a critical vulnerability from 0.0 to 1.0. Output a JSON array of objects with keys: id (finding id), score (float), reason (string explaining the score).`;
                    
                    const response = await chat(agent, [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'Begin analysis and output strictly valid JSON array.' }]);
                    
                     let scores: any[] = [];
                     try {
                         const jsonMatch = response.text.match(/\[[\s\S]*\]/);
                         if (jsonMatch) scores = JSON.parse(jsonMatch[0]);
                         else scores = JSON.parse(response.text);
                     } catch (e) {
                         await logActivity(scanJobId, agent.id, 'Warning', 'Failed to parse triage scores JSON.', response.promptTokens, response.completionTokens);
                         return;
                     }

                     for(const s of scores) {
                         if(!s.id || s.score === undefined) continue;
                         await query(
                             `UPDATE findings SET triage_score = $1, triage_reason = $2 WHERE id = $3`,
                             [s.score, s.reason, s.id]
                         );
                     }
                     await logActivity(scanJobId, agent.id, 'Triage Complete', `Scored ${scores.length} targets.`, response.promptTokens, response.completionTokens);

                } catch (err: any) {
                    await logActivity(scanJobId, agent.id, 'Error', `Analysis task failed: ${err.message}`);
                }
            });

            await Promise.allSettled(vulnPromises);
        }
    }


    // ── Finish ──
    await query(`UPDATE scan_jobs SET status = 'completed', finished_at = NOW() WHERE id = $1`, [scanJobId]);
    await logActivity(scanJobId, null, 'Scan Complete', 'Coordinated multi-agent scan finished successfully.');

  } catch (error: any) {
    console.error('Scan Error:', error);
    await logActivity(scanJobId, null, 'Fatal Error', `Scan failed: ${error.message}`);
    await query(`UPDATE scan_jobs SET status = 'failed', finished_at = NOW() WHERE id = $1`, [scanJobId]);
  }
}

/**
 * Log a real-time event to the agent activity feed.
 */
export async function logActivity(scanJobId: string, agentId: string | null, action: string, detail?: string, promptTokens: number = 0, completionTokens: number = 0) {
    try {
        await query(
            `INSERT INTO agent_activity (scan_job_id, agent_id, action, detail, prompt_tokens, completion_tokens) VALUES ($1, $2, $3, $4, $5, $6)`,
            [scanJobId, agentId, action, detail || null, promptTokens, completionTokens]
        );
    } catch (e) {
        console.error('Failed to log activity:', e);
    }
}
