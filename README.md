# 🕷️ AI Swarm Bug Hunting System — Self-Learning Harness Platform

This is an open-source, multi-agent AI system designed for autonomous security research and bug hunting. It orchestrates a "swarm" of specialised AI agents alongside the Model Context Protocol (MCP) to perform reconnaissance, triage findings, exploit vulnerabilities, generate reports, and **self-learn over time**.

## 🧩 The Harness Platform

The system is built as a **customizable harness** — every layer is pluggable:

| Layer | Where | What you can do |
|---|---|---|
| **AI Providers** | `/connect` page | Plug in **any** API (DeepSeek, OpenAI, OpenRouter, Groq, Mistral…) or run **fully local** (Ollama, LM Studio, vLLM — no key needed). One click discovers all models; assign roles per model. |
| **Pipeline** | `/harness` page | Enable/disable phases, change which tools each phase uses, set exploit thresholds. Versioned config. |
| **Prompts** | `/harness` page | Every agent prompt is an editable template (`{{scope}}`, `{{findings}}`, `{{tool_hint}}` variables). |
| **Tools** | MCP-over-HTTP | `recon-mcp` :8001, `exploit-mcp` :8002, `report-mcp` :8003 expose real tools (subfinder, httpx, katana, nuclei, sqlmap, dalfox, ffuf…) over HTTP. Agents call them in a real tool loop; register your own servers in the DB. |
| **Self-Learning** | `/harness` page | Trigger the Meta-Agent on any connected model (incl. local). It rewrites triage weights, exploit priority and FP suppression from your outcomes. |

### How a scan runs (harness engine)

1. Phases load from `harness_config` (recon → triage → exploit)
2. Each phase resolves a model by **role** (recon/triage/exploit/…) from your connected providers
3. The model can call tools by emitting ```` ```tool_call ```` JSON blocks — the engine executes them on the matching tool server (scope is auto-enforced) and feeds results back
4. Final JSON answers are parsed into `findings`, triage scores, and `exploit_attempts`
5. Everything streams into the live activity feed with token usage

> ⚠️ **Authorization**: scope enforcement stays built-in — every tool call is bound to the programme being scanned, and MCP servers reject out-of-scope targets. Only hunt targets you are authorized to test.

It includes a fully-featured **Next.js Dashboard** to coordinate all of your targets, AI agents, and active scans in one place.

## 🔍 reconFTW Capabilities

The `recon-mcp` server now carries the [reconFTW](https://github.com/six2dez/reconftw) module set as agent-callable tools (all scope-enforced + rate-limited):

* **Subdomain enumeration** — `run_subfinder`, `run_amass` (passive/active), `run_crtsh` (certificate transparency)
* **Permutations** — `run_permutations` (altdns-style generation → dnsx resolution)
* **DNS** — `run_dnsx` (A/CNAME/MX/TXT resolution, wildcard handling), `run_domain_info` (full DNS profile)
* **Subdomain takeover** — `run_takeover_check` (CNAME fingerprints for 24 services: Heroku, S3, CloudFront, Azure, GitHub Pages, Fastly…)
* **Ports** — `run_naabu` (fast top-ports) + `run_nmap_scan` (deep fingerprinting)
* **Web probing** — `run_httpx_probe`, `crawl_with_katana`
* **Historical URLs** — `fetch_wayback_urls` (gau) + `run_waybackurls`
* **JS analysis** — `run_js_analyzer` (LinkFinder-style endpoint + secret extraction)
* **Cloud exposure** — `run_cloud_buckets` (S3/GCS/Azure existence + open-listing checks)
* **One-shot pipeline** — `run_reconftw_pipeline(domain)` runs the full chain in a single tool call with **resume support** and structured output files under `reconftw/<domain>/` (add `deep: true` for naabu + nuclei).

## 🌐 Attack Surface Management (ASM) — Profundis.io Parity

The platform now includes a full **Attack Surface Management** module matching [profundis.io](https://profundis.io) capabilities:

| Feature | Description | Access |
|---------|-------------|--------|
| **Unified Search** | Field-syntax search across hosts, DNS, certs, WHOIS | `/explore` |
| **Pivot Graph** | Interactive graph with 10+ relationship types (subdomain, IP, TLS, CNAME, SAN, ASN, Org, Favicon, SSL FP, Cloud) | `/asm/graph` |
| **Asset Timeline** | Field-level change history with diffs and source attribution | `/asm/timeline` |
| **Risk Scoring** | Exposure, Attractiveness, Exploitability → Composite Risk Score (0-100) | `/asm/scoring` |
| **Cloud Inventory** | AWS/Azure/GCP resource discovery with public exposure detection | `/asm/cloud` |
| **Watch Rules** | Continuous monitoring with multi-channel alerts (Email, Slack, Discord, PagerDuty, OpsGenie, Teams, Webhook) | `/asm/watch` |
| **Enrichment Pipeline** | Censys, Fofa, BinaryEdge, Shodan, ZoomEye, GitHub, CT, Cloud | `/asm/enrichment` |
| **AI Integration** | `asm-mcp` server (port 8005) — native AI agent access to all ASM data | MCP |

### ASM MCP Server (`asm-mcp` :8005)

Exposes these tools to AI agents (Claude, GPT, local models via MCP):
- `search_assets` — Unified attack surface search
- `get_asset_graph` — Pivot graph around any seed
- `get_asset_timeline` — Historical changes for an asset
- `create_watch_rule` — Set up continuous monitoring
- `run_enrichment` — Trigger external data enrichment
- `get_risk_scores` — Prioritized asset risk scores
- `get_cloud_assets` — Multi-cloud inventory
- `search_certificates` — Certificate Transparency search
- `get_asset_relationships` — Direct relationship queries

---

## 💻 Engagement Workspace (pentest-harness style)

Beyond batch scans, the platform ships an **interactive pentest session** layer inspired by [pentest-harness](https://github.com/S1N6H/pentest-harness):

* **Durable sessions** (`/sessions`) — every message, tool call and result is persisted as an event log; resume/replay exactly where you left off.
* **Pentest Mode persona** — a professional offensive-security operating standard (methodology first, evidence-based, never fabricate findings).
* **Full agent toolset** — security MCP tools **plus** an isolated `sandbox` server (`run_shell`, `fs_read/write/search`, `web_fetch`) on :8004.
* **Approval stack** — dangerous operations (shell, active exploitation) pause for operator **Approve/Deny** before executing.
* **Context that never dies** — token metering, tool-result pruning (8k→head/tail), and automatic compaction above the token budget.
* **Skills** (`/skills`) — loadable pentest playbooks the agent pulls in via `load_skill()`.
* **Goals** — per-session objective tracking the agent maintains with goal tools.
* **Secure credential store** — API keys live in an owner-only file (`~/.bughunting/credentials.json`, chmod 600) referenced by ID; never inline in the DB, settings, or logs.

## ✨ Features

* **Multi-AI Agent Hub**: Bring your own keys (OpenAI, Anthropic, Google) and mix-and-match models for different phases. Assign Claude to *Exploit Crafting*, GPT-4o to *Recon*, and Gemini to *Triage*.
* **Live Scan Monitoring**: Watch the agents stream their thoughts, tool calls, and discovered vulnerabilities in real-time.
* **Auto-Discovery via `.env`**: Drop your API keys into a `.env` file and the system instantly bootstraps the AI agents for you.
* **Token Usage Tracking**: Granular tracking of prompt and completion tokens for every scan, giving you full visibility into AI costs.
* **Database (PostgreSQL)**: Stores programs, scope, recon findings, exploit attempts, agent activity logs, and generated reports.
* **Vector Store (ChromaDB)**: Stores embeddings of previous findings to calculate similarity for false-positive suppression and smart triage.
* **MCP Servers**: Four Dockerized MCP servers:
  - `recon-mcp` :8001 — reconFTW tools (subfinder, httpx, katana, nuclei, etc.)
  - `exploit-mcp` :8002 — exploitation tools (sqlmap, dalfox, ffuf, nuclei)
  - `report-mcp` :8003 — reporting and CVE lookup
  - **`asm-mcp` :8005 — NEW: Attack Surface Management tools for AI agents**
* **Attack Surface Management (ASM)** — Profundis.io parity:
  - **Unified Search** — Field-syntax across hosts, DNS, certs, WHOIS
  - **Pivot Graph** — 10+ relationship types, interactive exploration
  - **Asset Timeline** — Field-level change history with diffs
  - **Risk Scoring** — Exposure, Attractiveness, Exploitability scores
  - **Cloud Inventory** — AWS/Azure/GCP with exposure detection
  - **Watch Rules** — Multi-channel alerting (Slack, Email, PagerDuty, etc.)
  - **Enrichment Pipeline** — Censys, Fofa, Shodan, BinaryEdge, CT, Cloud

## 📸 Usage Guide

### 1. Programs Dashboard
The central command hub where you can track all of your bug hunting targets, view token usage, and launch scans.
![Programs Dashboard](docs/assets/dashboard.jpg)

### 2. Multi-AI Agent Hub
Manage your AI Swarm. Drop your keys in `.env` and assign specific roles to OpenAI, Anthropic, or Gemini models based on their strengths.
![Agent Hub](docs/assets/agent_hub.jpg)

### 3. Live Scan Monitoring
Watch the AI Swarm work in real-time. Logs stream in directly from the orchestrator showing recon activity, triage scoring, and discovered vulnerabilities.
![Live Scan](docs/assets/live_scan.jpg)

## 🛠️ Prerequisites

1. **Docker & Docker Compose**: Required for running the database, vector store, and MCP containers.
2. **Node.js (v18+)**: For running the Next.js frontend dashboard.
3. **Python 3.10+**: For running the backend test scripts and learning engine natively.
4. **API Keys**: See `.env.example`. 

## 🚀 Setup from Scratch

### 1. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your keys (OpenAI, Anthropic, Gemini, Shodan, etc.).

```bash
cp .env.example .env
nano .env
```
*Note: Any AI provider keys you add to `.env` will automatically appear in your Agent Hub dashboard!*

### 2. Spin up the Infrastructure
Use Docker Compose to build and start the backend stack (PostgreSQL on port `5433`, Redis, ChromaDB, and **four** MCP servers including the new **asm-mcp** on port `8005`).

```bash
docker compose up -d --build
```

This starts:
- **PostgreSQL** (5433) — with ASM tables (asset_changes, asset_scores, cloud_assets, etc.)
- **Redis** (6379) — for caching and job queues
- **ChromaDB** (8000) — vector store for embeddings
- **recon-mcp** (8001) — reconFTW reconnaissance tools
- **exploit-mcp** (8002) — exploitation tools
- **report-mcp** (8003) — reporting and CVE lookup
- **sandbox** (8004) — code execution environment
- **asm-mcp** (8005) — **NEW: Attack Surface Management tools for AI agents**

### 3. Install Python Dependencies (Backend Scripts)
Install the required packages to test the pipeline or run the Meta-Agent locally:

```bash
pip install psycopg2-binary httpx chromadb pyyaml anthropic google-generativeai mcp
```

### 4. Start the Dashboard (Frontend)
Run the Next.js development server to access the GUI:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to access the Bug Hunting Dashboard!

---

## 🧪 Testing the Pipeline

Once the backend containers are running, run the health check script to verify databases are properly initialized and MCP servers are responsive:

```bash
export DATABASE_URL="postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting"
python3 scripts/test_pipeline.py
```

If everything is healthy, you should see: `✅ All systems operational. Pipeline ready.`

## 🧠 The Self-Learning Loop (Meta-Agent)

The system automatically improves itself based on its successes and failures. The **Meta-Agent** analyzes outcomes and updates weights and strategies.

**From the dashboard:** open `/harness` → *Self-learning engine* → pick any connected model (cloud or local) → **Run learning cycle**. Progress and history appear live.

**From the CLI** (works with any model):

```bash
# Any OpenAI-compatible endpoint (DeepSeek, Ollama, LM Studio, vLLM…)
export LEARNING_BASE_URL="https://api.deepseek.com/v1"
export LEARNING_API_KEY="sk-..."
export LEARNING_MODEL="deepseek-chat"
python3 learning-engine/meta_agent.py --days 7

# Or Anthropic
export ANTHROPIC_API_KEY="sk-ant-api..."
python3 learning-engine/meta_agent.py
```
The script reads outcomes from the database, asks the model to identify patterns, writes the new configuration to `strategy_config.json` + Postgres, and updates the agents' system prompts.

## 🤝 Contributing
Contributions are welcome! Whether it's adding a new MCP tool, building a better UI dashboard, or tweaking agent prompts, feel free to open a Pull Request.

## 📄 License
MIT License
