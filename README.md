# 🕷️ AI Swarm Bug Hunting System

This is an open-source, multi-agent AI system designed for autonomous security research and bug hunting. It orchestrates a "swarm" of specialised AI agents (via standard AI providers like OpenAI, Anthropic, Gemini, DeepSeek, etc.) alongside the Model Context Protocol (MCP) to perform reconnaissance, triage findings, exploit vulnerabilities, generate reports, and self-learn over time.

It includes a fully-featured **Next.js Dashboard** to coordinate all of your targets, AI agents, and active scans in one place.

## ✨ Features

* **Multi-AI Agent Hub**: Bring your own keys (OpenAI, Anthropic, Google) and mix-and-match models for different phases. Assign Claude to *Exploit Crafting*, GPT-4o to *Recon*, and Gemini to *Triage*.
* **Live Scan Monitoring**: Watch the agents stream their thoughts, tool calls, and discovered vulnerabilities in real-time.
* **Auto-Discovery via `.env`**: Drop your API keys into a `.env` file and the system instantly bootstraps the AI agents for you.
* **Token Usage Tracking**: Granular tracking of prompt and completion tokens for every scan, giving you full visibility into AI costs.
* **Database (PostgreSQL)**: Stores programs, scope, recon findings, exploit attempts, agent activity logs, and generated reports.
* **Vector Store (ChromaDB)**: Stores embeddings of previous findings to calculate similarity for false-positive suppression and smart triage.
* **MCP Servers**: Three Dockerized MCP servers (`recon-mcp`, `exploit-mcp`, `report-mcp`) wrap standard security tools (e.g., subfinder, httpx, sqlmap, nuclei) exposing them as AI-callable functions.

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
Use Docker Compose to build and start the backend stack (PostgreSQL on port `5433`, Redis, ChromaDB, and the three MCP servers).

```bash
docker compose up -d --build
```

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

The system automatically improves itself based on its successes and failures. The **Meta-Agent** analyzes outcomes and updates weights and strategies. To trigger a manual learning cycle:

```bash
export ANTHROPIC_API_KEY="sk-ant-api..."
python3 learning-engine/meta_agent.py
```
This script will read the outcomes from the database, use Claude to identify patterns, write the new configuration to `strategy_config.json`, and update the agents' system prompts.

## 🤝 Contributing
Contributions are welcome! Whether it's adding a new MCP tool, building a better UI dashboard, or tweaking agent prompts, feel free to open a Pull Request.

## 📄 License
MIT License
