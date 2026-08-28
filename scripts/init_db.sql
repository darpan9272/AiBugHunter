-- Bug Hunting System — Database Schema
-- Runs automatically when Postgres container first starts.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- Programmes (bug bounty / private programmes)
-- ─────────────────────────────────────────────
CREATE TABLE programmes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT NOT NULL UNIQUE,
    platform    TEXT,                          -- hackerone, bugcrowd, private
    scope       JSONB NOT NULL DEFAULT '{}',   -- in-scope domains/IPs
    out_of_scope JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Recon Runs
-- ─────────────────────────────────────────────
CREATE TABLE recon_runs (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id),
    started_at  TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status      TEXT DEFAULT 'running',        -- running, done, failed
    summary     JSONB DEFAULT '{}'             -- counts, tool versions used
);

-- ─────────────────────────────────────────────
-- Recon Findings (raw attack surface)
-- ─────────────────────────────────────────────
CREATE TABLE findings (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recon_run_id    UUID REFERENCES recon_runs(id),
    programme_id    UUID REFERENCES programmes(id),
    type            TEXT NOT NULL,             -- subdomain, endpoint, param, service
    target          TEXT NOT NULL,             -- the raw value (url, ip, etc)
    metadata        JSONB DEFAULT '{}',        -- tech stack, headers, status code, etc
    triage_score    FLOAT,                     -- 0.0 – 1.0 after triage pass
    triage_reason   TEXT,                      -- LLM's explanation
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_findings_programme ON findings(programme_id);
CREATE INDEX idx_findings_score ON findings(triage_score DESC);

-- ─────────────────────────────────────────────
-- Exploit Attempts
-- ─────────────────────────────────────────────
CREATE TABLE exploit_attempts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id      UUID REFERENCES findings(id),
    agent_type      TEXT NOT NULL,             -- sqli, xss, idor, ssrf, etc
    payload         TEXT,
    response_snippet TEXT,
    success         BOOLEAN,
    confidence      FLOAT,
    evidence        JSONB DEFAULT '{}',        -- http trace, screenshots, etc
    attempted_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_exploit_finding ON exploit_attempts(finding_id);
CREATE INDEX idx_exploit_success ON exploit_attempts(success, agent_type);

-- ─────────────────────────────────────────────
-- Bug Reports
-- ─────────────────────────────────────────────
CREATE TABLE bug_reports (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    exploit_id      UUID REFERENCES exploit_attempts(id),
    programme_id    UUID REFERENCES programmes(id),
    title           TEXT,
    severity        TEXT,                      -- critical, high, medium, low, info
    cvss_score      FLOAT,
    report_markdown TEXT,
    status          TEXT DEFAULT 'draft',      -- draft, submitted, accepted, rejected, informative
    submitted_at    TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    bounty_amount   NUMERIC(10,2),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Learning Engine — Outcome Log
-- ─────────────────────────────────────────────
CREATE TABLE outcome_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_id       UUID REFERENCES bug_reports(id),
    event_type      TEXT NOT NULL,             -- accepted, rejected, informative, duplicate
    context         JSONB DEFAULT '{}',        -- full context snapshot for learning
    meta_notes      TEXT,                      -- Meta-Agent's analysis
    logged_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Learning Engine — Strategy Config Versions
-- ─────────────────────────────────────────────
CREATE TABLE strategy_versions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version         INT NOT NULL,
    config          JSONB NOT NULL,            -- the full strategy_config.json snapshot
    meta_reasoning  TEXT,                      -- why the meta-agent made these changes
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Seed a default strategy config version
INSERT INTO strategy_versions (version, config, meta_reasoning) VALUES (
    1,
    '{
        "triage_weights": {"static": 0.3, "embedding": 0.4, "llm": 0.3},
        "exploit_priority": ["sqli", "xss", "idor", "ssrf", "auth", "lfi", "api"],
        "target_type_hints": {},
        "payload_boost_patterns": []
    }',
    'Initial default strategy. No learning data yet.'
);

-- ─────────────────────────────────────────────
-- Multi-AI Agent Hub (see scripts/migrate_agents.sql for the
-- standalone version of this migration for existing databases)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_agents (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider    TEXT NOT NULL,
    model       TEXT NOT NULL,
    api_key     TEXT NOT NULL,
    base_url    TEXT,
    role        TEXT DEFAULT 'general',
    status      TEXT DEFAULT 'active',
    nickname    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scan_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id    UUID REFERENCES programmes(id),
    status          TEXT DEFAULT 'running',
    agents_assigned JSONB DEFAULT '[]',
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    summary         JSONB DEFAULT '{}', scan_profile_id    UUID REFERENCES scan_profiles(id)
);

CREATE TABLE IF NOT EXISTS agent_activity (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scan_job_id UUID REFERENCES scan_jobs(id),
    agent_id    UUID REFERENCES ai_agents(id),
    action      TEXT NOT NULL,
    detail      TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_activity_scan ON agent_activity(scan_job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scan_jobs_programme ON scan_jobs(programme_id);

-- ─────────────────────────────────────────────
-- Scan Profiles -- predefined hunting configurations
-- ─────────────────────────────────────────────
CREATE TABLE scan_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    scan_type       TEXT NOT NULL, -- web, network, web-app-specific, etc
    recon_tools     TEXT[] NOT NULL DEFAULT '{}',
    triage_tools    TEXT[] NOT NULL DEFAULT '{}',
    exploit_tools   TEXT[] NOT NULL DEFAULT '{}',
    rate_limit      INTEGER NOT NULL DEFAULT 10,
    timeout         INTEGER NOT NULL DEFAULT 3600, -- seconds
    safe_mode       BOOLEAN NOT NULL DEFAULT TRUE,
    evidence_capture BOOLEAN NOT NULL DEFAULT TRUE,
    config          JSONB DEFAULT '{}', -- tool-specific configs
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX idx_scan_profiles_name ON scan_profiles(name);
CREATE INDEX idx_scan_profiles_type ON scan_profiles(scan_type);

-- Insert default scan profiles
INSERT INTO scan_profiles (name, description, scan_type, recon_tools, triage_tools, exploit_tools, rate_limit, timeout, safe_mode, evidence_capture, config) VALUES
(
    'Quick Reconnaissance',
    'Fast initial reconnaissance for scope validation',
    'recon',
    ARRAY['subfinder', 'httpx', 'nuclei_info'],
    ARRAY['basic_tech_fingerprint', 'open_port_check'],
    ARRAY[], -- No exploitation in quick recon
    50,
    1800,
    TRUE,
    FALSE,
    '{}'::jsonb
),
(
    'Web Application Deep Scan',
    'Comprehensive web application security assessment',
    'web',
    ARRAY['subfinder', 'amass', 'gau', 'waybackurls', 'gospider', 'katana', 'httpx', 'nuclei_info'],
    ARRAY['cve_check', 'tech_fingerprint', 'auth_detection', 'admin_panel_finder', 'parameter_miner', 'javascript_analyzer'],
    ARRAY['nuclei_exploit', 'sqlmap', 'dalfox', 'ssrf_tester', 'lfi_scanner', 'rce_scanner', 'xxe_injector', 'open_redirect_checker'],
    10,
    7200,
    TRUE,
    TRUE,
    '{}'::jsonb
),
(
    'External Network Perimeter Scan',
    'External network discovery and vulnerability assessment',
    'network',
    ARRAY['nmap_discovery', 'masscan', 'zonetransfer', 'dnsrecon', 'shodan', 'censys', 'httpx'],
    ARRAY['service_version_detection', 'cve_check', 'default_credential_check', 'anonymous_access_check', 'ssl_tls_analyzer'],
    ARRAY['nmap_vuln_scripts', 'nikto', 'metasploit_selective', 'smbclient_check', 'rdp_check', 'snmp_enum'],
    5,
    10800,
    TRUE,
    TRUE,
    '{}'::jsonb
),
(
    'WordPress Security Audit',
    'Specialized WordPress vulnerability assessment',
    'web-app-specific',
    ARRAY['wpscan', 'httpx', 'gau', 'waybackurls'],
    ARRAY['wordpress_version_check', 'plugin_enumeration', 'theme_enumeration', 'user_enumeration', 'config_file_check', 'xmlrpc_check'],
    ARRAY['wpscan_exploits', 'sqlmap_wp', 'rce_via_plugin', 'file_upload_vectors', 'admin_takeover_attempts'],
    15,
    5400,
    TRUE,
    TRUE,
    '{"wp_api_token": ""}'::jsonb
);
