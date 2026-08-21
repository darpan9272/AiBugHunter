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
