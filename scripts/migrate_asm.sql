-- ═══════════════════════════════════════════════════════════════
-- ASM Platform Migration — Profundis.io Parity Features
--   1. Asset Change History (Timeline)
--   2. Alert Channels & Multi-channel Notifications
--   3. Enrichment Job Tracking
--   4. Attack Surface Scoring
--   5. Cloud Asset Inventory
--   6. Watch Rule → Channel Mapping
-- ═══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────
-- 1. Asset Change History (Timeline)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_changes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id        UUID REFERENCES assets(id) ON DELETE CASCADE,
    field_name      TEXT NOT NULL,
    old_value       JSONB,
    new_value       JSONB,
    change_type     TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'deleted')),
    source          TEXT,               -- ingest, scan, manual, enrichment, censys, fofa, shodan, ct
    meta            JSONB DEFAULT '{}', -- additional context (tool, scan_id, etc.)
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_changes_asset ON asset_changes(asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_changes_field ON asset_changes(field_name);
CREATE INDEX IF NOT EXISTS idx_asset_changes_source ON asset_changes(source);
CREATE INDEX IF NOT EXISTS idx_asset_changes_created ON asset_changes(created_at DESC);

-- ─────────────────────────────────────────────
-- 2. Alert Channels
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_channels (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    type            TEXT NOT NULL CHECK (type IN ('email', 'slack', 'discord', 'pagerduty', 'opsgenie', 'teams', 'webhook')),
    config          JSONB NOT NULL,       -- {recipients, template, webhook_url, api_key, service_key, etc.}
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    description     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 3. Watch Rule → Channel Mapping
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watch_channels (
    watch_rule_id   UUID REFERENCES watch_rules(id) ON DELETE CASCADE,
    channel_id      UUID REFERENCES alert_channels(id) ON DELETE CASCADE,
    PRIMARY KEY (watch_rule_id, channel_id)
);

-- ─────────────────────────────────────────────
-- 4. Enrichment Jobs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrichment_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id    UUID REFERENCES programmes(id) ON DELETE CASCADE,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed', 'partial')),
    source          TEXT NOT NULL,        -- censys, fofa, binaryedge, shodan, zoomeye, ct, github, cloud
    target          TEXT NOT NULL,        -- domain, ip, org, asn
    target_type     TEXT NOT NULL,        -- domain, ip, org, asn
    params          JSONB DEFAULT '{}',   -- source-specific parameters
    result          JSONB,                -- summary of findings
    changes_count   INT DEFAULT 0,        -- number of asset_changes created
    new_assets      INT DEFAULT 0,        -- number of new assets discovered
    error           TEXT,
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_programme ON enrichment_jobs(programme_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_source ON enrichment_jobs(source);

-- ─────────────────────────────────────────────
-- 5. Attack Surface Scoring
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_scores (
    asset_id                UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    exposure_score          FLOAT NOT NULL DEFAULT 0,       -- 0-100: internet-facing, open ports, services
    attractiveness_score    FLOAT NOT NULL DEFAULT 0,       -- 0-100: tech stack, auth, params, endpoints
    exploitability_score    FLOAT NOT NULL DEFAULT 0,       -- 0-100: known vulns, public exploits, CVEs
    risk_score              FLOAT NOT NULL DEFAULT 0,       -- 0-100: weighted composite
    factors                 JSONB NOT NULL DEFAULT '{}',    -- detailed breakdown per factor
    tier                    TEXT NOT NULL DEFAULT 'info' CHECK (tier IN ('critical', 'high', 'medium', 'low', 'info')),
    calculated_at           TIMESTAMPTZ DEFAULT NOW(),
    calculated_by           TEXT DEFAULT 'auto'             -- auto, manual, asm-mcp
);

CREATE INDEX IF NOT EXISTS idx_asset_scores_risk ON asset_scores(risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_asset_scores_tier ON asset_scores(tier);

-- ─────────────────────────────────────────────
-- 6. Cloud Asset Inventory
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cloud_assets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id    UUID REFERENCES programmes(id) ON DELETE CASCADE,
    provider        TEXT NOT NULL CHECK (provider IN ('aws', 'azure', 'gcp', 'digitalocean', 'linode', 'vultr')),
    resource_type   TEXT NOT NULL,        -- s3, ec2, rds, elb, cloudfront, route53, storage, vm, disk, lb, cdn, dns, etc.
    resource_id     TEXT NOT NULL,        -- provider's unique identifier
    resource_arn    TEXT,                 -- full ARN if applicable
    region          TEXT,
    name            TEXT,                 -- human-readable name/tag
    metadata        JSONB NOT NULL DEFAULT '{}', -- full provider response
    tags            JSONB DEFAULT '{}',   -- normalized tags
    public_exposure BOOLEAN DEFAULT FALSE, -- internet-accessible?
    first_seen      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (programme_id, provider, resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_assets_programme ON cloud_assets(programme_id);
CREATE INDEX IF NOT EXISTS idx_cloud_assets_provider ON cloud_assets(provider);
CREATE INDEX IF NOT EXISTS idx_cloud_assets_type ON cloud_assets(resource_type);
CREATE INDEX IF NOT EXISTS idx_cloud_assets_public ON cloud_assets(public_exposure);

-- ─────────────────────────────────────────────
-- 7. Certificate Transparency Monitoring
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ct_monitor_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id    UUID REFERENCES programmes(id) ON DELETE CASCADE,
    domain          TEXT NOT NULL,        -- watched domain (e.g., example.com)
    cert_sha256     TEXT NOT NULL,        -- certificate fingerprint
    subject_cn      TEXT,
    san             JSONB DEFAULT '[]',   -- Subject Alternative Names
    issuer_org      TEXT,
    not_before      TIMESTAMPTZ,
    not_after       TIMESTAMPTZ,
    log_id          TEXT,                 -- CT log ID
    entry_timestamp TIMESTAMPTZ,          -- when cert was logged
    detected_at     TIMESTAMPTZ DEFAULT NOW(),
    matched_watch   UUID REFERENCES watch_rules(id) ON DELETE SET NULL,
    UNIQUE (cert_sha256)
);

CREATE INDEX IF NOT EXISTS idx_ct_monitor_domain ON ct_monitor_logs(domain);
CREATE INDEX IF NOT EXISTS idx_ct_monitor_detected ON ct_monitor_logs(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ct_monitor_watch ON ct_monitor_logs(matched_watch);

-- ─────────────────────────────────────────────
-- 8. API Keys for Public REST API
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    key_hash        TEXT NOT NULL,        -- bcrypt hash
    key_prefix      TEXT NOT NULL,        -- first 8 chars for identification
    programme_id    UUID REFERENCES programmes(id) ON DELETE CASCADE,
    scopes          TEXT[] DEFAULT '{}',  -- read:assets, write:assets, read:watch, write:watch, read:enrichment, etc.
    rate_limit      INT DEFAULT 1000,     -- requests per hour
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_programme ON api_keys(programme_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

-- ─────────────────────────────────────────────
-- 9. Asset Relationships (for enhanced graph)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_relationships (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id    UUID REFERENCES programmes(id) ON DELETE CASCADE,
    source_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    target_asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    relationship    TEXT NOT NULL,        -- same_asn, same_org, same_favicon, same_ssl_fp, same_cloud, cname, san, redirects_to, etc.
    confidence      FLOAT DEFAULT 1.0,    -- 0-1
    metadata        JSONB DEFAULT '{}',   -- {asn, org, favicon_hash, ssl_fp, cloud_provider, etc.}
    discovered_at   TIMESTAMPTZ DEFAULT NOW(),
    discovered_by   TEXT DEFAULT 'auto'   -- auto, manual, asm-mcp
);

CREATE INDEX IF NOT EXISTS idx_asset_rels_source ON asset_relationships(source_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_rels_target ON asset_relationships(target_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_rels_type ON asset_relationships(relationship);
CREATE INDEX IF NOT EXISTS idx_asset_rels_programme ON asset_relationships(programme_id);

-- ─────────────────────────────────────────────
-- Helper Functions
-- ─────────────────────────────────────────────

-- Function to record asset changes
CREATE OR REPLACE FUNCTION record_asset_change(
    p_asset_id UUID,
    p_field_name TEXT,
    p_old_value JSONB,
    p_new_value JSONB,
    p_change_type TEXT,
    p_source TEXT DEFAULT 'auto',
    p_meta JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
    INSERT INTO asset_changes (asset_id, field_name, old_value, new_value, change_type, source, meta)
    VALUES (p_asset_id, p_field_name, p_old_value, p_new_value, p_change_type, p_source, p_meta);
END;
$$ LANGUAGE plpgsql;

-- Function to calculate risk tier from score
CREATE OR REPLACE FUNCTION calculate_risk_tier(score FLOAT) RETURNS TEXT AS $$
BEGIN
    IF score >= 80 THEN RETURN 'critical';
    ELSIF score >= 60 THEN RETURN 'high';
    ELSIF score >= 40 THEN RETURN 'medium';
    ELSIF score >= 20 THEN RETURN 'low';
    ELSE RETURN 'info';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on alert_channels
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_alert_channels_updated ON alert_channels;
CREATE TRIGGER trigger_alert_channels_updated
    BEFORE UPDATE ON alert_channels
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────────
-- Default Alert Channel Templates (for reference)
-- ─────────────────────────────────────────────
-- INSERT INTO alert_channels (name, type, config, description) VALUES
-- ('Default Email', 'email', '{"recipients": ["security@example.com"], "template": "default"}', 'Email alerts to security team'),
-- ('Slack #security', 'slack', '{"webhook_url": "https://hooks.slack.com/services/xxx", "template": "slack"}', 'Slack channel for security alerts'),
-- ('PagerDuty', 'pagerduty', '{"service_key": "xxx", "severity": "critical"}', 'PagerDuty for critical alerts');