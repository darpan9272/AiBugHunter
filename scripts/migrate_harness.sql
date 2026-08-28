-- ═══════════════════════════════════════════════════════════════
-- Harness Platform Migration
-- Turns the system into a self-learning, fully customizable,
-- local-first AI harness:
--   1. ai_providers      — plug in any API (DeepSeek-style connector)
--   2. provider_models   — auto-discovered models, role-assignable
--   3. tool_servers      — pluggable tool endpoints (MCP-over-HTTP)
--   4. prompt_templates  — every prompt editable by the user
--   5. harness_config    — customizable pipeline phases
--   6. learning_runs     — self-learning cycle history
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Provider connections ──
CREATE TABLE IF NOT EXISTS ai_providers (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL DEFAULT 'openai-compatible', -- openai-compatible | ollama | anthropic | google
    base_url    TEXT,
    api_key     TEXT NOT NULL DEFAULT '',
    is_local    BOOLEAN NOT NULL DEFAULT FALSE,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    meta        JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. Discovered models per provider ──
CREATE TABLE IF NOT EXISTS provider_models (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,
    model_id    TEXT NOT NULL,
    enabled     BOOLEAN NOT NULL DEFAULT FALSE,
    role        TEXT NOT NULL DEFAULT 'general',  -- recon | triage | exploit | report | meta | general
    nickname    TEXT,
    UNIQUE (provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);

-- ── 3. Tool server registry ──
CREATE TABLE IF NOT EXISTS tool_servers (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL UNIQUE,
    url          TEXT NOT NULL,
    kind         TEXT NOT NULL DEFAULT 'mcp-http',
    enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    tools_cache  JSONB NOT NULL DEFAULT '[]',
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Editable prompt templates ──
CREATE TABLE IF NOT EXISTS prompt_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    content     TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Harness pipeline configuration ──
CREATE TABLE IF NOT EXISTS harness_config (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version     INT NOT NULL,
    phases      JSONB NOT NULL,
    settings    JSONB NOT NULL DEFAULT '{}',
    active      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Learning cycle history ──
CREATE TABLE IF NOT EXISTS learning_runs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id  UUID REFERENCES ai_providers(id) ON DELETE SET NULL,
    status       TEXT NOT NULL DEFAULT 'running', -- running | done | failed
    outcomes_seen INT DEFAULT 0,
    new_version  INT,
    log          TEXT DEFAULT '',
    started_at   TIMESTAMPTZ DEFAULT NOW(),
    finished_at  TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════
-- Seeds
-- ═══════════════════════════════════════════════════════════════

-- Default tool servers (the three MCP containers, now HTTP-reachable)
INSERT INTO tool_servers (name, url, kind) VALUES
    ('recon-mcp',   'http://localhost:8001', 'mcp-http'),
    ('exploit-mcp', 'http://localhost:8002', 'mcp-http'),
    ('report-mcp',  'http://localhost:8003', 'mcp-http')
ON CONFLICT (name) DO NOTHING;

-- Default prompt templates (editable in the UI)
INSERT INTO prompt_templates (key, name, content) VALUES
('recon', 'Recon Phase Prompt', E'You are a Reconnaissance Agent inside an authorized security-testing harness.\n\nTARGET SCOPE (you must only touch these):\n{{scope}}\n\nPROGRAMME: {{programme}}\n\n{{tool_hint}}\n\nIdentify subdomains, endpoints, parameters and services. When you need real data, call tools.\nOutput your FINAL answer as a JSON array of objects with keys:\n  type (subdomain/endpoint/param/service), target (string), metadata (object).'),
('triage', 'Triage Phase Prompt', E'You are a Vulnerability Triage Agent inside an authorized security-testing harness.\n\nAnalyze these discovered assets:\n{{findings}}\n\n{{tool_hint}}\n\nScore each asset 0.0-1.0 for likelihood of containing an exploitable vulnerability.\nOutput your FINAL answer as a JSON array of objects with keys:\n  id (finding id), score (float), reason (string).'),
('exploit', 'Exploit Phase Prompt', E'You are an Exploitation Agent inside an authorized security-testing harness.\n\nValidate these high-priority findings with SAFE, non-destructive tests only:\n{{findings}}\n\n{{tool_hint}}\n\nOutput your FINAL answer as a JSON array of objects with keys:\n  id (finding id), success (boolean), vulnerability_type (string),\n  evidence (object with real tool output), confidence (float 0-1).'),
('report', 'Report Writer Prompt', E'You are a Bug Report Writer. Turn this validated finding into a professional bug bounty report:\n{{finding}}\n\nEvidence:\n{{evidence}}\n\nOutput markdown with: Title, Severity + CVSS estimate, Description, Steps to Reproduce, Impact, Remediation.'),
('meta', 'Meta-Agent Learning Prompt', E'You are the Meta-Agent of a self-learning security harness.\nAnalyse the outcomes below and output ONLY a JSON strategy config with keys:\ntriage_weights (static/embedding/llm summing to 1.0), exploit_priority (array),\ntarget_type_hints (object), payload_boost_patterns (array), fp_suppression_threshold (float),\nmin_triage_score (float).\n\nOUTCOMES:\n{{outcomes}}\n\nSUCCESS RATES BY VULN TYPE:\n{{success_rates}}\n\nCURRENT STRATEGY:\n{{current_strategy}}')
ON CONFLICT (key) DO NOTHING;

-- Default harness pipeline (v1)
INSERT INTO harness_config (version, phases, settings, active)
SELECT 1,
'[
  {"key":"recon","name":"Reconnaissance","template_key":"recon","role":"recon","enabled":true,
   "default_tools":["run_subfinder","run_httpx_probe","fetch_wayback_urls","crawl_with_katana"],
   "output":"findings"},
  {"key":"triage","name":"Triage & Scoring","template_key":"triage","role":"triage","enabled":true,
   "default_tools":["run_nuclei_info","query_shodan"],
   "output":"scores"},
  {"key":"exploit","name":"Exploitation","template_key":"exploit","role":"exploit","enabled":true,
   "default_tools":["run_sqlmap","run_dalfox","run_nuclei_exploit","test_ssrf","run_ffuf","test_jwt"],
   "output":"exploit_attempts","min_score":0.4}
]',
'{
  "max_tool_rounds": 6,
  "max_findings_per_phase": 20,
  "json_extract_mode": "auto",
  "scope_enforced": true,
  "temperature": 0.3,
  "max_tokens": 4096
}',
TRUE
WHERE NOT EXISTS (SELECT 1 FROM harness_config);
