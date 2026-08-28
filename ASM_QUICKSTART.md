# ASM Platform — Quick Start Guide

## Overview

This platform now includes a full Attack Surface Management (ASM) module matching **profundis.io** capabilities:

### ✅ Implemented Features

| Feature | Description | Location |
|---------|-------------|----------|
| **Unified Search** | Field-syntax search across hosts, DNS, certs, WHOIS | `/explore` |
| **Pivot Graph** | Interactive graph with 10+ relationship types | `/asm/graph` |
| **Asset Timeline** | Field-level change history with diffs | `/asm/timeline` |
| **Risk Scoring** | Exposure, Attractiveness, Exploitability scores | `/asm/scoring` |
| **Cloud Inventory** | AWS/Azure/GCP asset discovery | `/asm/cloud` |
| **Watch Rules** | Continuous monitoring with multi-channel alerts | `/asm/watch` |
| **Enrichment Pipeline** | Censys, Fofa, Shodan, BinaryEdge, CT, Cloud | `/asm/enrichment` |
| **AI Integration** | `asm-mcp` server for native AI agent access | `mcp-servers/asm-mcp/` |

---

## Quick Start

### 1. Add Environment Variables

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
# Edit .env with your keys:
# - CENSYS_API_ID, CENSYS_API_SECRET
# - FOFA_EMAIL, FOFA_KEY
# - BINARYEDGE_API_KEY
# - SHODAN_API_KEY
# - ZOOMEYE_API_KEY
# - GITHUB_TOKEN
# - AWS/Azure/GCP credentials
# - SMTP, PagerDuty, OpsGenie, Teams webhooks
```

### 2. Start the Stack

```bash
docker compose up -d --build
```

This starts:
- PostgreSQL (port 5433) — with new ASM tables
- Redis (port 6379)
- ChromaDB (port 8000)
- **recon-mcp** (port 8001) — reconFTW tools
- **exploit-mcp** (port 8002) — exploitation tools
- **report-mcp** (port 8003) — reporting tools
- **sandbox** (port 8004) — code execution
- **asm-mcp** (port 8005) — **NEW** ASM tools for AI agents

### 3. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

### 4. Access ASM Features

Navigate to the new **Attack Surface** section in the sidebar:
- **Attack Surface** — Dashboard overview
- **Pivot Graph** — Interactive relationship explorer
- **Timeline** — Asset change history
- **Risk Scoring** — Prioritized asset list
- **Cloud Assets** — Multi-cloud inventory
- **Watch Rules** — Alerting configuration
- **Enrichment** — External data pipeline

---

## Using the ASM MCP Server

The `asm-mcp` server exposes these tools to AI agents (Claude, GPT, local models):

```python
# Available tools for AI agents:
- search_assets(query, asset_type, programme, limit)
- get_asset_graph(seed, depth, max_nodes, include)
- get_asset_timeline(host, programme, limit, fields)
- create_watch_rule(name, query, asset_type, programme, channels)
- run_enrichment(target, target_type, sources, programme, params)
- get_risk_scores(programme, min_risk, tier, limit)
- get_cloud_assets(programme, provider, resource_type, public_only)
- search_certificates(domain, programme, issuer, expiring_days)
- get_asset_relationships(asset_id, relationship, programme)
```

### Example: Using with Claude

```bash
# The MCP server runs on port 8005
# Configure your AI agent to connect to http://localhost:8005
```

---

## Running Background Services

### Risk Scoring Calculation

```bash
# Score all assets in a programme
python services/scoring_service.py <programme_id>

# Score specific assets
python services/scoring_service.py <programme_id> <asset_id1> <asset_id2>
```

### Relationship Discovery

```bash
# Discover relationships (same favicon, SSL, IP, CNAME, SAN)
python services/relationship_service.py <programme_id>
```

### Enrichment Worker

```bash
# Run continuous enrichment worker
python services/enrichment_worker.py
```

This processes jobs from the `enrichment_jobs` table, calling external APIs and updating assets.

---

## Database Schema (New Tables)

Run `docker compose up` to auto-create these via `scripts/migrate_asm.sql`:

| Table | Purpose |
|-------|---------|
| `asset_changes` | Field-level timeline for every asset |
| `alert_channels` | Email, Slack, Discord, PagerDuty, etc. |
| `watch_channels` | Watch rule → channel mapping |
| `enrichment_jobs` | Background enrichment job queue |
| `asset_scores` | Risk scores (exposure, attractiveness, exploitability) |
| `cloud_assets` | AWS/Azure/GCP resource inventory |
| `ct_monitor_logs` | Certificate Transparency log entries |
| `asset_relationships` | Graph edges (same_asn, same_favicon, etc.) |
| `api_keys` | Public REST API authentication |

---

## API Endpoints (New)

### ASM Dashboard Data
```
GET  /api/asm/exposure-trend?programmeId=xxx&days=30
GET  /api/asm/top-tech?programmeId=xxx&limit=10
GET  /api/asm/expiring-certs?programmeId=xxx&days=30
GET  /api/asm/shadow-it?programmeId=xxx&limit=10
```

### Asset Timeline
```
GET  /api/asm/timeline?host=example.com&programmeId=xxx
GET  /api/asm/timeline/all?programmeId=xxx&days=30
```

### Risk Scoring
```
GET  /api/asm/scores?programmeId=xxx&minRisk=50&tier=high
POST /api/asm/scores — Trigger calculation
```

### Cloud Assets
```
GET  /api/asm/cloud?programmeId=xxx&provider=aws
POST /api/asm/cloud — Trigger discovery
```

### Alert Channels
```
GET    /api/asm/alert-channels
POST   /api/asm/alert-channels — Create
PATCH  /api/asm/alert-channels — Update
DELETE /api/asm/alert-channels?id=xxx
PUT    /api/asm/alert-channels — Test channel
```

### Enrichment
```
GET  /api/asm/enrichment?programmeId=xxx&status=running
POST /api/asm/enrichment — Create job
GET  /api/asm/enrichment/[id] — Job details
```

### Watch Rules (Enhanced)
```
GET  /api/watch — List rules
POST /api/watch — Create rule
PATCH /api/watch — Toggle enabled
DELETE /api/watch — Delete rule
POST /api/watch/check — Run all checks now
```

---

## Profundis.io Feature Parity

| Profundis Feature | Our Implementation | Status |
|-------------------|-------------------|--------|
| Pivot Tool | `/asm/graph` + `asm-mcp.get_asset_graph` | ✅ Complete |
| Real-time Alerting | Watch Rules + Multi-channel | ✅ Complete |
| Unified Search | `/explore` + `asm-mcp.search_assets` | ✅ Complete |
| AI Integration (MCP) | `asm-mcp` server | ✅ Complete |
| Attack Surface Mapping | Assets + Graph + Scoring + Cloud | ✅ Complete |
| Historical Tracking | `asset_changes` + `/asm/timeline` | ✅ Complete |
| Cloud Discovery | `cloud_assets` + `/asm/cloud` | ✅ Complete |
| CT Monitoring | `ct_monitor_logs` + enrichment | ⚠️ Partial |
| Compliance Reports | `/asm/cloud` export + scoring | ⚠️ Partial |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Frontend (Next.js)                         │
│  /asm/* pages  ──▶  /api/asm/*  ──▶  PostgreSQL                │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌───────────┐  ┌───────────┐  ┌───────────┐
        │ recon-mcp │  │asm-mcp    │  │enrichment │
        │ :8001     │  │ :8005     │  │ worker    │
        └───────────┘  └───────────┘  └───────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────────────┐
                    │  External APIs  │
                    │ Censys, Fofa,   │
                    │ Shodan, Cloud   │
                    └─────────────────┘
```

---

## Next Steps

1. **Configure API Keys** in `.env` for full enrichment capability
2. **Create a Programme** in `/programs` with scope
3. **Run Initial Ingestion** via `/explore` → "Ingest domain"
4. **Run Scoring** via `python services/scoring_service.py <programme_id>`
5. **Discover Relationships** via `python services/relationship_service.py <programme_id>`
6. **Set Up Watch Rules** in `/asm/watch` with alert channels
7. **Start Enrichment Worker** for continuous updates

---

## Support

- **Issues**: GitHub Issues
- **Docs**: `/SPEC.md` for full specification
- **API**: OpenAPI spec at `/api/v1/openapi.json` (when implemented)