-- ═══════════════════════════════════════════════════════════════
-- Sessions Migration — pentest-harness style engagement workspace
--   1. sessions        — durable interactive engagements
--   2. session_events  — JSONL-style event log (replay/resume)
--   3. skills          — loadable pentest playbooks
--   4. goals           — per-session objective tracking
--   5. approvals       — human-in-the-loop gate for dangerous tools
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sessions (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id),
    title        TEXT NOT NULL DEFAULT 'New engagement',
    provider_id  UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
    model_id     TEXT,
    mode         TEXT NOT NULL DEFAULT 'pentest',   -- pentest | plan
    status       TEXT NOT NULL DEFAULT 'active',    -- active | archived
    context_tokens INT NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_events (
    id         BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    seq        INT NOT NULL,
    role       TEXT NOT NULL,   -- user | assistant | tool_call | tool_result | system | approval_request
    content    TEXT NOT NULL DEFAULT '',
    meta       JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, seq);

CREATE TABLE IF NOT EXISTS skills (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS goals (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    text       TEXT NOT NULL,
    status     TEXT NOT NULL DEFAULT 'pending',  -- pending | in_progress | done | dropped
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_goals_session ON goals(session_id);

CREATE TABLE IF NOT EXISTS approvals (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    tool       TEXT NOT NULL,
    args       JSONB NOT NULL DEFAULT '{}',
    status     TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | denied
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(session_id, status);

-- ── Pentest Mode persona (adapted operating standard) ──
INSERT INTO prompt_templates (key, name, content) VALUES
('pentest_persona', 'Pentest Mode Persona', E'You are Pentest Mode, a professional offensive-security agent. You conduct authorized security testing on the targets the user names — assets they own or have written authorization to test (bug bounty programmes, engagement scopes, internal labs, CTFs).

Operating standards:
- Work like a senior pentester: efficient, decisive, thorough. No disclaimers inside an authorized engagement — deliver results.
- Respect the stated scope. Stay on targets in scope: {{scope}}. When scope or rules of engagement are unclear, ask one focused question.
- Professional methodology: recon and enumeration first, then attack-surface mapping, then targeted testing, then exploitation of confirmed findings, then a clear report.
- Verify findings before reporting; distinguish confirmed impact from theory. NEVER fabricate findings — report faithfully, including failures.
- Evidence-based output: document what you did, what you found (with proof), and remediation.
- Use your full toolset: security tools, shell, filesystem, web research and skills, in whatever combination the task requires.
- Dangerous operations (shell commands, active exploitation) require approval — request them via tool calls; the operator decides.

{{tool_hint}}')
ON CONFLICT (key) DO NOTHING;

-- ── Seed skills (loadable playbooks) ──
INSERT INTO skills (key, name, description, content) VALUES
('recon-playbook', 'Recon Playbook', 'Systematic reconnaissance methodology', E'# Recon Playbook
1. Scope confirmation — list in-scope domains/IPs, note exclusions.
2. Passive enumeration: subfinder, crt.sh, wayback/gau for historical URLs.
3. Active probing: httpx for live hosts (status, tech, headers, titles).
4. Port/service scan on in-scope IPs (nmap, rate-limited).
5. Content discovery: katana crawl + parameter mining on live apps.
6. Tech fingerprint → map likely vuln classes per stack.
7. Record every asset as a finding with metadata.'),
('web-testing-playbook', 'Web App Testing Playbook', 'OWASP-style web application testing order', E'# Web App Testing Playbook
Priority order (by impact):
1. Auth flaws: default creds, password reset logic, session fixation, JWT alg/none.
2. Access control: IDOR on every object reference, forced browsing, privilege paths.
3. Injection: SQLi on every param (error + blind), command injection, SSTI.
4. SSRF: any url/host/proxy param → OOB callback test.
5. XSS: stored > reflected > DOM; check sinks in JS files.
6. Business logic: race conditions on money/limits, workflow skipping.
Always: safe payloads only, one request at a time on fragile endpoints, capture evidence.'),
('report-template', 'Bug Report Template', 'Professional bounty report structure', E'# Bug Report Template
Title: [VulnClass] in <endpoint> allows <impact>
Severity: map to CVSS 3.1 vector; justify each factor.
Description: 2-3 sentences, no fluff.
Steps to Reproduce: numbered, exact requests (curl/HTTP), include minimal PoC.
Impact: what an attacker gains; realistic worst case within scope.
Evidence: response snippets, OOB callback logs, screenshots.
Remediation: concrete fix + defense-in-depth note.')
ON CONFLICT (key) DO NOTHING;

-- ── Register sandbox tool server (shell/fs/web tools) ──
INSERT INTO tool_servers (name, url, kind) VALUES
    ('sandbox', 'http://localhost:8004', 'mcp-http')
ON CONFLICT (name) DO NOTHING;
