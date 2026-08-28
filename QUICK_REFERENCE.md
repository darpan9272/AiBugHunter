# 📋 AI Swarm Bug Hunting - Quick Reference

## 🚀 Quick Start (Free-Only)

```bash
# 1. Setup
cp .env.example.production .env
# Edit .env: Set POSTGRES_PASSWORD & CHROMA_AUTH_TOKEN, leave API keys empty
# Set USE_LOCAL_LLM=true for free AI

# 2. Install Ollama (for free AI)
# https://ollama.com/download
ollama pull llama3.1:8b

# 3. Start Services
docker compose up -d

# 4. Validate
python scripts/test_free_setup.py

# 5. Start Dashboard
cd frontend && npm run dev
# Visit http://localhost:3000
```

## 🔑 Environment Variables

### REQUIRED
- `POSTGRES_PASSWORD` - Database password (change from default!)
- `CHROMA_AUTH_TOKEN` - ChromaDB auth token (change from default!)

### OPTIONAL (Free Tiers)
- `GOOGLE_API_KEY` - Google Gemini (60 queries/min free)
- `ANTHROPIC_API_KEY` - Claude (free trial credits)
- `SHODAN_API_KEY` - Shodan (50 queries/month free)
- `CENSYS_API_ID/SECRET` - Censys (limited free)
- `NVD_API_KEY` - NVD (higher rate limits with key)

### FREE AI ALTERNATIVE
- `USE_LOCAL_LLM=true` - Use Ollama instead of APIs
- `LOCAL_LLM_URL=http://localhost:11434` - Default Ollama URL
- `LOCAL_LLM_MODEL=llama3.1:8b` - Recommended model

## 🛠️ Essential Free Tools (Install for Enhanced Capabilities)

```bash
# Ubuntu/Debian
sudo apt-get install nmap masscan gobuster ffuf sqlmap dalfox \
                     nuclei httpx subfinder gau katana \
                     bandit semgrep safety npm trivy checkov gitleaks

# macOS (Homebrew)
brew install nmap masscan gobuster ffuf sqlmap dalfox \
             nuclei httpx subfinder gau katana \
             bandit semgrep safety npm trivy checkov gitleaks
```

## 🐛 Common Commands

### Check System Status
```bash
docker compose ps                    # See all containers
docker compose logs -f               # Follow logs
docker compose logs -f frontend      # Frontend logs only
python scripts/test_pipeline.py      # Full health check
python scripts/test_free_setup.py    # Free setup validation
```

### Manage Containers
```bash
docker compose up -d                 # Start all services
docker compose down                  # Stop all services
docker compose restart               # Restart all services
docker compose pull                  # Update images
```

### Update Security Databases
```bash
# Update nuclei templates (run weekly)
docker compose exec bughunting-exploit-mcp nuclei -update-templates

# Update other tools as needed
# (Most tools update themselves or use system packages)
```

## 📊 Free Operation Modes

### Mode 1: Zero Cost ($0/month)
```
USE_LOCAL_LLM=true
GOOGLE_API_KEY=
ANTHROPIC_API_KEY=
SHODAN_API_KEY=
CENSYS_API_ID=
CENSYS_API_SECRET=
NVD_API_KEY=
```

### Mode 2: Enhanced Free (<$5/month)
```
USE_LOCAL_LLM=false
GOOGLE_API_KEY=your_google_key    # Free tier
ANTHROPIC_API_KEY=                # Optional
SHODAN_API_KEY=your_shodan_key    # Free tier (50/mo)
CENSYS_API_ID=your_censys_id      # Free tier
CENSYS_API_SECRET=your_censys_secret
NVD_API_KEY=                      # Optional for higher limits
```

## 🆘 Troubleshooting

### Containers Not Starting
```bash
docker compose logs [container-name]
# Check .env for correct POSTGRES_PASSWORD and CHROMA_AUTH_TOKEN
```

### Frontend Not Accessible
```bash
# Check if frontend container is running
docker compose ps | grep frontend
# Check logs
docker compose logs frontend
# Try rebuilding
cd frontend && npm run build
```

### Scan Tools Not Working
```bash
# Verify tools are installed in containers
docker compose exec bughunting-recon-mcp which nmap
docker compose exec bughunting-exploit-mcp which nuclei
# Rebuild if needed
docker compose build [service-name]
```

## 🔒 Security Best Practices

1. **Never commit .env** - Add to .gitignore
2. **Change default passwords** - POSTGRES_PASSWORD and CHROMA_AUTH_TOKEN
3. **Restrict network access** - Use Docker networks or firewalls
4. **Regular updates** - docker compose pull + weekly nuclei updates
5. **Monitor logs** - Watch for authentication errors or tool failures
6. **Backup data** - pg_dump for Postgreستان, backup chroma directory

## 📞 Need Help?

- Check logs: `docker compose logs`
- Read documentation: `PRODUCTION_READY.md`
- Validate setup: `python scripts/test_free_setup.py`
- Full health check: `python scripts/test_pipeline.py`

---
*Keep hacking ethically and responsibly!*
