# 🚀 AI Swarm Bug Hunting System - Production Ready Guide

This guide explains how to deploy and operate the AI Swarm Bug Hunting system in a production environment with minimal cost, leveraging free tiers and open-source alternatives.

## 📊 Production Deployment Overview

The system is designed to run 24/7 with minimal operational overhead. Key production considerations:

| Component | Production Requirement | Free Alternative |
|----------|-----------------------|------------------|
| Database | PostgreSQL (required) | None - core component |
| Vector Store | ChromaDB (required) | None - core component |
| AI Models | APIs or Local LLM | Local LLM (Ollama) |
| Recon APIs | Shodan/Censys/VirusTotal | crt.sh, DNSDumpster, ThreatCrowd (free) |
| Vuln Intel | NVD/Vulners | OSV, Exploit-DB, PacketStorm (free) |
| Alerting | Slack/Discord Webhooks | Email, Matrix, Telegram (free) |
| Scanning | All tools included | All tools are open-source free |

## 🔧 Production Installation Steps

### 1. Infrastructure Setup
```bash
# Clone repository
git clone <repository-url>
cd bughunting

# Copy production environment template
cp .env.example.production .env

# Edit .env with your settings
nano .env

# Minimum required changes:
# - POSTGRES_PASSWORD (strong password)
# - CHROMA_AUTH_TOKEN (strong token)
# - Optionally: GOOGLE_API_KEY or ANTHROPIC_API_KEY for enhanced AI
# - OR set USE_LOCAL_LLM=true for completely free AI
```

### 2. Install Dependencies
```bash
# Docker & Docker Compose (required)
# Follow instructions at: https://docs.docker.com/compose/install/

# Optional: Install additional free scanners for enhanced capabilities
# Ubuntu/Debian:
sudo apt-get update
sudo apt-get install -y nmap masscan gobuster ffuf sqlmap dalfox \
                       nuclei httpx subfinder gau katana \
                       bandit semgrep safety npm trivy checkov gitleaks

# macOS (with Homebrew):
brew install nmap masscan gobuster ffuf sqlmap dalfox \
             nuclei httpx subfinder gau katana \
             bandit semgrep safety npm trivy checkov gitleaks
```

### 3. Configure Local LLM (Optional - for Free AI)
If you want to eliminate API costs entirely:

```bash
# Install Ollama (runs LLMs locally)
# https://ollama.com/download

# Pull recommended models
ollama pull llama3.1:8b      # Main reasoning model
ollama pull codellama:7b     # Code analysis
ollama pull mistral:7b       # General purpose

# Update .env:
USE_LOCAL_LLM=true
LOCAL_LLM_URL=http://localhost:11434
LOCAL_LLM_MODEL=llama3.1:8b
```

### 4. Start the System
```bash
# Start all services
docker compose up -d

# Verify all containers are running
docker compose ps

# Check logs if needed
docker compose logs -f
```

### 5. Initialize the Dashboard
```bash
# Install frontend dependencies
cd frontend
npm install

# Start development server (for testing)
npm run dev

# For production build:
npm run build
npm start  # or use PM2/nginx for production
```

## 🆓 Free-First Operation Guide

### Mode 1: Completely Free Operation ($0/month)
Set in `.env`:
```
USE_LOCAL_LLM=true
GOOGLE_API_KEY=
ANTHROPIC_API_KEY=
SHODAN_API_KEY=
CENSYS_API_ID=
CENSYS_API_SECRET=
NVD_API_KEY=
VIRUSTOTAL_API_KEY=
```

The system will:
- Use Ollama/Llama3 for all AI reasoning
- Use free recon sources: crt.sh, DNSDumpster, Wayback Machine, Google dorks (via httpx)
- Use public NVD API (rate limited but functional)
- Use open-source scanners: nuclei, nmap, httpx, subfinder, etc.
- Alert via console/logs (configure webhooks later if desired)

### Mode 2: Enhanced Free Operation (Recommended)
Set in `.env`:
```
USE_LOCAL_LLM=false
GOOGLE_API_KEY=your_free_google_key  # Free tier: 60 queries/min
ANTHROPIC_API_KEY=                   # Leave empty or use trial
SHODAN_API_KEY=                      # Free tier: 50 queries/month
CENSYS_API_ID=                       # Free tier: limited
NVD_API_KEY=                         # Optional for higher rate limits
```

This gives you:
- Better AI reasoning with Google Gemini (free tier)
- Some enhanced recon with Shodan/Censys free tiers
- Full open-source scanner capabilities
- Cost: ~$0/month if you stay within free tiers

### Mode 3: Enterprise Operation
Add all available API keys for maximum performance and features.

## 🔒 Production Security Considerations

### 1. Environment Security
- Never commit `.env` to version control
- Use Docker secrets or Kubernetes secrets in production
- Rotate passwords and tokens regularly
- Restrict container network access

### 2. Container Security
```bash
# Run containers as non-root (already configured in Dockerfiles)
# Scan images for vulnerabilities:
docker scout cve bughunting-recon-mcp
trivy image bughunting-recon-mcp

# Implement resource limits (add to docker-compose.yml):
deploy:
  resources:
    limits:
      cpus: "2.0"
      memory: 2G
```

### 3. Network Security
- Run containers on isolated Docker network
- Use reverse proxy (nginx/traefik) for frontend
- Implement rate limiting at network level
- Consider WAF for exposed endpoints

### 4. Data Protection
- Enable PostgreSQL SSL connections
- Encrypt sensitive data at rest
- Regular backups of PostgreSQL and ChromaDB
- Audit logging for all MCP server accesses

## 📈 Monitoring & Maintenance

### Health Checks
```bash
# Basic health check
curl http://localhost:3000/api/health

# Detailed component checks
python scripts/test_pipeline.py  # Verify all services

# Container status
docker compose ps --format "table {{.Name}}\t{{.State}}\t{{.Ports}}"
```

### Log Management
```bash
# View recent logs
docker compose logs --tail=100

# Setup log rotation (example for Loki/Promtail)
# Or use: docker compose logs -f > /var/log/bughunting.log &

# Monitor disk usage
docker system df
```

### Performance Tuning
```bash
# Adjust rate limits based on your API tiers
# Increase concurrency for powerful servers
# Tune nuclei templates:
#   nuclei -update-templates  # Daily
#   nuclei -t cves/ -stats    # View CVE template stats

# Optimize ChromaDB:
#   Periodic collection cleanup
#   Monitor memory usage
```

## 🛡️ Comprehensive Free Security Coverage

The system includes these free security capabilities by default:

### Reconnaissance (Passive)
- Subdomain enumeration: subfinder, crt.sh
- Port scanning: nmap, masscan
- Service detection: nmap, httpx
- Technology detection: httpx, wafw00f
- Historical URLs: Wayback Machine, gau
- Certificate transparency: crt.sh
- DNS enumeration: dnsrecon, massdns
- Search engine reconnaissance: Google dorks (via custom scripts)

### Vulnerability Scanning
- Network vulnerabilities: nmap vuln scripts
- Web vulnerabilities: nuclei (10,000+ templates)
- SQL injection: sqlmap
- XSS: dalfox
- Directory/file brute force: ffuf, gobuster
- SSRF detection: interactsh/OOB
- JWT security testing: custom checks
- Open port/shadow IT: nmap, masscan
- Subdomain takeover: subover (can be added)
- Misconfigurations: nuclei templates
- Exposures: nuclei exposure templates
- Default credentials: nuclei default-login templates

### Application Security Testing (AST)
- Static Analysis (SAST):
  - Python: bandit, semgrep
  - JavaScript/TypeScript: eslint-security-plugin, semgrep
  - PHP: phpcs-security, semgrep
  - Java: spotbugs, semgrep
  - Multi-language: semgrep, sonar-community
- Dependency Scanning:
  - Python: safety, pip-audit
  - JavaScript: npm audit, yarn audit
  - Java: OWASP DependencyCheck
  - .NET: dotnet list package --vulnerable
  - Multi-language: OWASP Dependency-Track
- Container Security:
  - Images: trivy, grype
  - Filesystems: trivy, grype
  - Running containers: falco (can be added)
- Infrastructure as Code:
  - Terraform: checkov, tfsec, kics
  - CloudFormation: cfn-lint, checkov
  - Kubernetes: kube-score, kics
  - Multi-platform: checkov

### Threat Intelligence
- CVE lookup: NVD API (free), OSV
- Exploit lookup: Exploit-DB, PacketStorm
- Malware scanning: YARA rules (can be integrated)
- Reputation checking: AbuseIPDB (free tier), VirusTotal (free tier)
- Dark web monitoring: Custom scrapers (can be added)

## 🔄 Self-Learning & Improvement

The Meta-Agent continuously improves the system:

### Learning Cycle
1. **Data Collection**: Scan results, exploit attempts, false positives
2. **Analysis**: Claude/Gemini identifies patterns in successful findings
3. **Optimization**: Updates strategy_config.json with:
   - Triage weight adjustments
   - Exploit priority reordering
   - Target-type hint refinement
   - False positive suppression thresholds
   - Payload effectiveness scoring
4. **Deployment**: New strategies automatically used in subsequent scans

### Monitoring Learning Progress
```bash
# Check strategy versions
psql -h localhost -p 5433 -U bugbot -d bughunting -c "SELECT version, created_at, notes FROM strategy_versions ORDER BY created_at DESC;"

# View learning engine logs
docker compose logs -f learning-engine

# Force learning cycle (optional)
export DATABASE_URL="postgresql://bugbot:YOUR_PASSWORD@localhost:5433/bughunting"
python learning-engine/meta_agent.py
```

## 📋 Production Checklist

### Pre-Launch
- [ ] Set strong POSTGRES_PASSWORD and CHROMA_AUTH_TOKEN
- [ ] Configure desired API keys (or set to free-only mode)
- [ ] Test with `scripts/test_pipeline.py`
- [ ] Verify all containers show healthy status
- [ ] Test frontend accessibility at http://localhost:3000
- [ ] Send test alert to webhook (optional)
- [ ] Run initial scan on a test target

### Ongoing Operations
- [ ] Monitor container health weekly
- [ ] Update nuclei templates monthly: `nuclei -update-templates`
- [ ] Update OS packages quarterly for scanners
- [ ] Backup PostgreSQL and ChromaDB monthly
- [ ] Review logs for errors monthly
- [ ] Rotate passwords/tokens quarterly
- [ ] Check disk usage and set up alerts if needed
- [ ] Review learning engine outputs monthly

### Scaling Considerations
For high-volume operations:
- Increase PostgreSQL connection limits
- Add Redis clustering for cache
- Consider ChromaDB scaling options
- Add load balancer for multiple frontend instances
- Split MCP servers across multiple hosts
- Implement queue system for scan jobs (Redis/RabbitMQ)

## 💰 Cost Optimization Tips

### Zero-Cost Operation
1. Use Local LLM (Ollama) instead of APIs
2. Rely on free recon sources (crt.sh, dnsdumpster, etc.)
3. Use public NVD API (accept rate limits)
4. Use open-source scanners only
5. Alert via console or self-hosted solutions

### Minimal Cost (<$5/month)
1. Use Google Gemini free tier (60 queries/min)
2. Use Shodan free tier (50 queries/month)
3. Use Censys free tier
4. Keep Local LLM as backup
5. Use free webhook services (Slack/Discord free tiers)

### When to Invest
Consider paid upgrades when:
- You need >500 recon queries/day
- You need real-time threat intelligence
- You require SLA guarantees
- You need advanced features like ASM (Attack Surface Management)
- You're scanning large IP ranges continuously

## 🤝 Contributing to Production Readiness

Help make this system more production-ready:
1. Add health check endpoints to all MCP servers
2. Implement Prometheus metrics endpoints
3. Add distributed tracing (OpenTelemetry)
4. Improve error handling and retry logic
5. Add configuration validation on startup
6. Implement graceful shutdown handling
7. Add backup/restore scripts
8. Create Helm chart for Kubernetes deployment
9. Add comprehensive monitoring dashboards
10. Create runbook for common operational procedures

## 📞 Support & Community

For production support:
- Check existing issues: <repository-issues-url>
- Review discussions: <repository-discussions-url>
- Consult documentation: docs/ directory
- Community forums: <if applicable>

Remember: This system is designed to be powerful yet accessible. Start small, validate your setup, and gradually enhance as your needs grow. The self-learning capabilities mean the system will improve over time with use!

---
*Last updated: August 2027*
*For the latest updates, check the repository's main branch*
