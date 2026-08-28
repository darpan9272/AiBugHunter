# Attack Surface Management Platform — Profundis.io Parity Specification

## Executive Summary

Transform the existing AI Swarm Bug Hunting System into a full-featured Attack Surface Management (ASM) platform matching profundis.io capabilities. The platform already has ~70% of required features. This spec covers the remaining 30%.

---

## Current State Analysis

### ✅ Already Implemented (Profundis Parity)

| Feature | Status | Location |
|---------|--------|----------|
| **Unified Search** | ✅ Complete | `/explore` page, `lib/explore.ts`, `api/explore` |
| **Field-syntax Query** | ✅ Complete | `parseQuery()` with AND/OR/NOT, wildcards |
| **Multi-asset Search** | ✅ Complete | hosts, DNS, certs, WHOIS tabs |
| **Faceted Filters** | ✅ Complete | Tech, ports, status, issuers, record types |
| **Portfolio Stats** | ✅ Complete | Asset counts, expiring certs, top tech |
| **Pivot/Graph** | ✅ Basic | `/api/explore/graph` — subdomain→apex, host→IP, TLS, CNAME |
| **Domain Ingestion** | ✅ Complete | `/api/explore/ingest` — httpx, dnsx, crtsh, whois |
| **Real-time Alerting** | ✅ Basic | `/api/watch` — webhook alerts on new matches |
| **MCP Servers** | ✅ Complete | recon-mcp, exploit-mcp, report-mcp, sandbox |
| **AI Agent Hub** | ✅ Complete | Multi-provider, role assignment, live monitoring |

### ⚠️ Partial / Needs Enhancement

| Feature | Current | Target (Profundis) |
|---------|---------|-------------------|
| Graph relationships | 4 edge types | 12+ (ASN, org, favicon, SSL, cloud, etc.) |
| Alert channels | Webhook only | Email, Slack, Discord, PagerDuty, OpsGenie |
| Data sources | reconFTW tools | + Censys, Fofa, BinaryEdge, Shodan, ZoomEye |
| Historical diffing | None | Asset change timeline, diff views |
| AI MCP Server | Generic recon | Dedicated "asm-mcp" for attack surface queries |
| Enrichment pipeline | Manual ingest | Automated continuous enrichment |
| API for integrations | Internal only | Public REST API with auth |

### ❌ Missing Entirely

- **Asset Timeline / Change History** — Track every change to every asset
- **Attack Surface Scoring** — Risk scoring per asset (exposure, severity, exploitability)
- **Cloud Asset Mapping** — AWS/Azure/GCP resource discovery
- **Certificate Transparency Monitoring** — Continuous CT log monitoring
- **Subdomain Takeover Detection** — Automated CNAME fingerprinting + validation
- **Technology Fingerprint Clustering** — Group assets by tech stack
- **Exposed Secrets Detection** — GitHub, Pastebin, S3 bucket scanning
- **Shadow IT Discovery** — Assets outside known scope
- **Compliance Reporting** — PCI-DSS, SOC2, GDPR asset inventories

---

## Implementation Roadmap

### Phase 1: Core ASM Enhancements (Week 1-2)
**Priority: HIGH — Direct profundis parity**

1. **Enhanced Pivot Graph** (`mcp-servers/asm-mcp`, `api/explore/graph`)
   - Add ASN, Organization, Cloud Provider, Favicon hash, SSL fingerprint nodes
   - Edge types: `same-asn`, `same-org`, `same-favicon`, `same-ssl-fp`, `same-cloud`, `cert-transparency`
   - Graph clustering & community detection

2. **ASM MCP Server** (`mcp-servers/asm-mcp/`)
   - Tools: `search_assets`, `get_asset_graph`, `get_asset_timeline`, `create_watch_rule`, `run_enrichment`
   - Native AI agent integration (Claude, GPT, local models)

3. **Asset Timeline & Diffing** (DB + API + UI)
   - `asset_changes` table — every field change with timestamp
   - `/api/explore/timeline?host=` endpoint
   - UI: Timeline view in explore results

### Phase 2: Alerting & Enrichment (Week 2-3)
**Priority: HIGH — Operational necessity**

4. **Multi-channel Alerting** (`lib/alerts.ts`, `api/watch`)
   - Email (SMTP), Slack, Discord, PagerDuty, OpsGenie, Microsoft Teams
   - Template system with Jinja2/Handlebars
   - Alert deduplication & grouping

5. **Continuous Enrichment Pipeline** (`services/enrichment/`)
   - Background worker (Bull/Redis or cron)
   - Scheduled re-ingestion with diff detection
   - Priority queue: new assets → high-value → stale

6. **Extended Data Sources** (`mcp-servers/recon-mcp/`)
   - Censys API integration
   - Fofa API integration
   - BinaryEdge API integration
   - ZoomEye API integration
   - GitHub code search (secrets)

### Phase 3: Intelligence & Scoring (Week 3-4)
**Priority: MEDIUM — Differentiation**

7. **Attack Surface Scoring** (`lib/scoring.ts`)
   - Exposure score: internet-facing, open ports, known vulns
   - Attractiveness score: tech stack, auth endpoints, parameters
   - Exploitability score: public exploits, CVE mapping
   - Composite risk score per asset

8. **Cloud Asset Discovery** (`mcp-servers/cloud-mcp/`)
   - AWS: S3 buckets, EC2, ALB, CloudFront, Route53
   - Azure: Storage, App Service, Front Door, DNS
   - GCP: Cloud Storage, Cloud Run, Load Balancing, Cloud DNS

9. **Certificate Transparency Monitor** (`services/ct-monitor/`)
   - Real-time CT log streaming (Certstream)
   - New cert detection for watched domains
   - Integration with watch rules

### Phase 4: Platform Polish (Week 4-5)
**Priority: MEDIUM — Production readiness**

10. **Public REST API** (`api/v1/`)
    - OpenAPI/Swagger spec
    - API key management
    - Rate limiting, webhooks

11. **Compliance & Reporting** (`api/reports/asm/`)
    - Asset inventory export (CSV, JSON, Excel)
    - PCI-DSS scope report
    - Shadow IT report
    - Executive dashboard

12. **Advanced UI** (`frontend/src/app/asm/`)
    - Attack surface overview dashboard
    - Risk heatmap
    - Trend charts (assets over time, new exposures)
    - Team collaboration (comments, assignments)

---

## Technical Architecture

### Database Extensions

```sql
-- Asset change history
CREATE TABLE asset_changes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB,
    change_type TEXT NOT NULL, -- created, updated, deleted
    source TEXT,               -- ingest, scan, manual, enrichment
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alert channels
CREATE TABLE alert_channels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    type TEXT NOT NULL, -- email, slack, discord, pagerduty, opsgenie, teams
    config JSONB NOT NULL, -- {webhook_url, api_key, recipients, template}
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Watch rule → channel mapping
CREATE TABLE watch_channels (
    watch_rule_id UUID REFERENCES watch_rules(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES alert_channels(id) ON DELETE CASCADE,
    PRIMARY KEY (watch_rule_id, channel_id)
);

-- Enrichment jobs
CREATE TABLE enrichment_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id),
    status TEXT DEFAULT 'pending', -- pending, running, done, failed
    source TEXT, -- censys, fofa, binaryedge, shodan, ct, github
    target TEXT, -- domain, ip, org
    result JSONB,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

-- Attack surface scores
CREATE TABLE asset_scores (
    asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    exposure_score FLOAT DEFAULT 0,      -- 0-100
    attractiveness_score FLOAT DEFAULT 0, -- 0-100
    exploitability_score FLOAT DEFAULT 0, -- 0-100
    risk_score FLOAT DEFAULT 0,           -- 0-100 (weighted composite)
    factors JSONB DEFAULT '{}',           -- breakdown
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Cloud assets
CREATE TABLE cloud_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    programme_id UUID REFERENCES programmes(id) ON DELETE CASCADE,
    provider TEXT NOT NULL, -- aws, azure, gcp
    resource_type TEXT NOT NULL, -- s3, ec2, alb, storage, etc.
    resource_id TEXT NOT NULL,
    region TEXT,
    name TEXT,
    metadata JSONB DEFAULT '{}',
    first_seen TIMESTAMPTZ DEFAULT NOW(),
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (programme_id, provider, resource_type, resource_id)
);
```

### New MCP Server: `asm-mcp`

```python
# mcp-servers/asm-mcp/server.py
# Tools exposed to AI agents:
# - search_assets(query, asset_type, programme_id, limit)
# - get_asset_graph(seed, depth, max_nodes)
# - get_asset_timeline(host, programme_id, limit)
# - create_watch_rule(name, query, asset_type, programme_id, channels)
# - run_enrichment(target, sources, programme_id)
# - get_risk_scores(programme_id, min_score)
# - get_cloud_assets(programme_id, provider)
```

### Enrichment Worker Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Scheduler  │────▶│  Job Queue   │────▶│  Enrichment     │
│  (cron/     │     │  (Redis/     │     │  Workers        │
│   interval) │     │   BullMQ)    │     │  (parallel)     │
└─────────────┘     └──────────────┘     └────────┬────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    ▼                              ▼                              ▼
             ┌─────────────┐               ┌─────────────┐               ┌─────────────┐
             │  Censys     │               │  Fofa       │               │  Shodan     │
             │  API        │               │  API        │               │  API        │
             └─────────────┘               └─────────────┘               └─────────────┘
                    │                              │                              │
                    └──────────────────────────────┼──────────────────────────────┘
                                                   ▼
                                          ┌─────────────────┐
                                          │  Diff Engine    │
                                          │  (compare with  │
                                          │   current DB)   │
                                          └────────┬────────┘
                                                   │
                    ┌──────────────────────────────┼──────────────────────────────┐
                    ▼                              ▼                              ▼
             ┌─────────────┐               ┌─────────────┐               ┌─────────────┐
             │  Update     │               │  Create     │               │  Trigger    │
             │  Assets     │               │  Changes    │               │  Alerts     │
             └─────────────┘               └─────────────┘               └─────────────┘
```

---

## API Specification (New Endpoints)

### Asset Graph (Enhanced)
```
GET /api/v1/asm/graph?seed=example.com&depth=2&max_nodes=500&include=asn,org,ssl,favicon,cloud
Response: { nodes: [...], edges: [...], clusters: [...] }
```

### Asset Timeline
```
GET /api/v1/asm/timeline?host=api.example.com&programme_id=xxx&limit=100
Response: { changes: [{ field, old, new, timestamp, source }] }
```

### Asset Search (Public API)
```
POST /api/v1/asm/search
Body: { query: "port:443 tech:nginx", asset_type: "hosts", programme_id: "xxx", limit: 100 }
Response: { results: [...], total: 1234, facets: {...} }
```

### Watch Rules (Enhanced)
```
POST /api/v1/asm/watch
Body: { name, query, asset_type, programme_id, channels: ["slack", "email"], schedule: "0 */6 * * *" }
```

### Enrichment
```
POST /api/v1/asm/enrich
Body: { target: "example.com", sources: ["censys", "fofa", "shodan"], programme_id: "xxx" }
Response: { job_id: "xxx", status: "started" }

GET /api/v1/asm/enrich/{job_id}
Response: { status, result, changes, new_assets }
```

### Risk Scoring
```
GET /api/v1/asm/scores?programme_id=xxx&min_risk=70
Response: { assets: [{ host, risk_score, exposure, attractiveness, exploitability, factors }] }
```

### Cloud Assets
```
GET /api/v1/asm/cloud?programme_id=xxx&provider=aws
Response: { resources: [{ type, id, name, region, metadata }] }
```

---

## UI/UX Specifications

### New Pages

| Route | Purpose |
|-------|---------|
| `/asm` | Attack Surface Overview Dashboard |
| `/asm/graph` | Interactive Pivot Graph (full-screen) |
| `/asm/timeline` | Asset Change Timeline |
| `/asm/scoring` | Risk Score Heatmap & Leaderboard |
| `/asm/cloud` | Cloud Asset Inventory |
| `/asm/watch` | Watch Rule Management (enhanced) |
| `/asm/enrichment` | Enrichment Job Monitor |
| `/asm/reports` | Compliance & Executive Reports |
| `/asm/settings` | Alert Channels, API Keys, Enrichment Config |

### Dashboard Widgets (asm/page.tsx)

1. **Risk Score Distribution** — Histogram of assets by risk score
2. **New Exposures (24h/7d/30d)** — Timeline chart
3. **Top Technologies** — Treemap with risk overlay
4. **Expiring Certificates** — Countdown cards
5. **Shadow IT Candidates** — Assets not in scope but related
6. **Cloud Resource Summary** — By provider/type
7. **Watch Rule Hits** — Recent alerts table
8. **Enrichment Pipeline Status** — Running/queued/completed jobs

---

## Configuration

### Environment Variables (Additions)

```bash
# Alert Channels
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=alerts@example.com
SMTP_PASS=xxx
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxx
PAGERDUTY_API_KEY=xxx
OPSGENIE_API_KEY=xxx
TEAMS_WEBHOOK_URL=xxx

# Enrichment APIs
CENSYS_API_ID=xxx
CENSYS_API_SECRET=xxx
FOFA_EMAIL=xxx
FOFA_KEY=xxx
BINARYEDGE_API_KEY=xxx
ZOOMEYE_API_KEY=xxx
GITHUB_TOKEN=xxx

# Cloud Provider Credentials
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
AZURE_CLIENT_ID=xxx
AZURE_CLIENT_SECRET=xxx
AZURE_TENANT_ID=xxx
GCP_PROJECT_ID=xxx
GCP_SERVICE_ACCOUNT_KEY=xxx

# CT Monitoring
CERTSTREAM_ENABLED=true

# ASM MCP Server
ASM_MCP_PORT=8005
ASM_MCP_HOST=0.0.0.0
```

---

## Acceptance Criteria

### Phase 1 Complete When:
- [ ] Graph shows 10+ relationship types with clustering
- [ ] `asm-mcp` server runs and exposes 7 tools to AI agents
- [ ] Asset timeline shows field-level changes with source attribution
- [ ] All existing tests pass + new tests for graph/timeline

### Phase 2 Complete When:
- [ ] Alerts deliver to Slack, Discord, Email, PagerDuty
- [ ] Enrichment worker runs continuously, processes 1000+ assets/hour
- [ ] Censys/Fofa/BinaryEdge integrated and queryable
- [ ] Diff detection triggers alerts correctly

### Phase 3 Complete When:
- [ ] Every asset has risk score updated daily
- [ ] Cloud assets discovered for connected accounts
- [ ] CT monitoring detects new certs within 5 minutes
- [ ] Scoring factors explainable (why is this asset high risk?)

### Phase 4 Complete When:
- [ ] Public API documented with OpenAPI spec
- [ ] Compliance reports generate in <30 seconds
- [ ] Dashboard loads in <2 seconds with 10k assets
- [ ] Multi-tenant ready (programme isolation)

---

## Dependencies & Risks

| Dependency | Risk | Mitigation |
|------------|------|------------|
| Censys/Fofa/BinaryEdge APIs | Rate limits, cost | Caching, priority queue, fallback to free sources |
| CT log streaming | High volume | Filter by watched domains only |
| Cloud provider APIs | Permissions scope | Read-only IAM policies, least privilege |
| Graph computation | O(n²) on large datasets | Limit to 500 nodes, use Graphology/WebGL rendering |
| Multi-channel alerts | Delivery failures | Retry with exponential backoff, dead letter queue |

---

## Success Metrics

- **Coverage**: % of known assets enriched with 5+ data sources
- **Freshness**: Median asset age < 24 hours
- **Detection Time**: New asset → alert < 5 minutes
- **False Positive Rate**: Alert precision > 90%
- **API Latency**: P95 < 500ms for search, < 2s for graph
- **AI Agent Success**: % of reconnaissance tasks completed autonomously via asm-mcp

---

## Appendix: Profundis Feature Mapping

| Profundis Feature | Our Implementation | Status |
|-------------------|-------------------|--------|
| Pivot Tool | `/explore` + Graph API + asm-mcp | ✅ Core / ⚠️ Enhanced |
| Real-time Alerting | Watch Rules + Multi-channel | ✅ Core / ⚠️ Enhanced |
| Unified Search | Explore page + Field syntax | ✅ Complete |
| AI Integration (MCP) | recon-mcp + asm-mcp (new) | ✅ Core / 🆕 New |
| Attack Surface Mapping | Assets + Graph + Scoring | ⚠️ Partial / 🆕 New |
| Historical Tracking | Asset Changes table | 🆕 New |
| Cloud Discovery | Cloud MCP (new) | 🆕 New |
| CT Monitoring | CT Monitor service (new) | 🆕 New |