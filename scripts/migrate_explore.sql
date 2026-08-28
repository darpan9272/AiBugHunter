-- ═══════════════════════════════════════════════════════════════
-- Explore Migration — Profundis-style attack-surface search engine
--   1. assets       — live hosts with ports/tech/title/favicon/tls/whois
--   2. asset_dns    — DNS records inventory
--   3. asset_certs  — TLS certificate inventory (CT logs + live)
--   4. watch_rules  — change alerting ("know when it changes")
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS assets (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE,
    host         TEXT NOT NULL,                 -- fqdn or ip
    ip           TEXT,
    ports        JSONB NOT NULL DEFAULT '[]',   -- [80, 443]
    tech         JSONB NOT NULL DEFAULT '[]',   -- ["nginx","React"]
    title        TEXT,
    status       INT,
    favicon_hash TEXT,                          -- mmh3 (Shodan-style)
    tls          JSONB NOT NULL DEFAULT '{}',   -- {issuer, cn, expiry}
    whois        JSONB NOT NULL DEFAULT '{}',   -- {registrar, created, expires, emails}
    first_seen   TIMESTAMPTZ DEFAULT NOW(),
    last_seen    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (programme_id, host)
);

CREATE INDEX IF NOT EXISTS idx_assets_prog ON assets(programme_id);
CREATE INDEX IF NOT EXISTS idx_assets_host ON assets(host);
CREATE INDEX IF NOT EXISTS idx_assets_ip ON assets(ip);
CREATE INDEX IF NOT EXISTS idx_assets_favicon ON assets(favicon_hash);

CREATE TABLE IF NOT EXISTS asset_dns (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    type         TEXT NOT NULL,               -- A, AAAA, CNAME, MX, NS, TXT
    value        TEXT NOT NULL DEFAULT '',
    first_seen   TIMESTAMPTZ DEFAULT NOW(),
    last_seen    TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (programme_id, name, type, value)
);

CREATE INDEX IF NOT EXISTS idx_asset_dns_name ON asset_dns(name);

CREATE TABLE IF NOT EXISTS asset_certs (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE,
    sha256       TEXT,
    subject_cn   TEXT,
    san          JSONB NOT NULL DEFAULT '[]',
    issuer_org   TEXT,
    not_before   TIMESTAMPTZ,
    not_after    TIMESTAMPTZ,
    first_seen   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (programme_id, sha256)
);

CREATE INDEX IF NOT EXISTS idx_asset_certs_cn ON asset_certs(subject_cn);

CREATE TABLE IF NOT EXISTS watch_rules (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          TEXT NOT NULL,
    query         TEXT NOT NULL,              -- explore query string
    asset_type    TEXT NOT NULL DEFAULT 'hosts',
    programme_id  UUID REFERENCES programmes(id) ON DELETE CASCADE,
    webhook       TEXT,                       -- slack/discord webhook url (optional)
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    seen_keys     JSONB NOT NULL DEFAULT '[]',-- last matched keys (diff detection)
    last_match_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
