-- Migration: Multi-AI Agent Hub
-- Run this against the bughunting database to add agent orchestration tables.

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
    summary         JSONB DEFAULT '{}'
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
