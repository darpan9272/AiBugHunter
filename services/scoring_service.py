"""
ASM Risk Scoring Service

Calculates attack surface risk scores for assets based on:
- Exposure Score (0-100): Internet-facing services, open ports, public endpoints
- Attractiveness Score (0-100): Technology stack, auth endpoints, parameters, admin panels
- Exploitability Score (0-100): Known CVEs, public exploits, weaponized vulnerabilities
- Composite Risk Score: Weighted combination of the above
"""

import asyncio
import json
import os
import re
from typing import Any

import asyncpg

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting")

# ─────────────────────────────────────────────
# Scoring Weights
# ─────────────────────────────────────────────
WEIGHTS = {
    "exposure": 0.4,
    "attractiveness": 0.3,
    "exploitability": 0.3,
}

TIER_THRESHOLDS = {
    "critical": 80,
    "high": 60,
    "medium": 40,
    "low": 20,
    "info": 0,
}

# ─────────────────────────────────────────────
# Known Exploitable Technologies / Patterns
# ─────────────────────────────────────────────
HIGH_VALUE_TECH = {
    # Web frameworks with known issues
    "wordpress": 30, "drupal": 25, "joomla": 25, "magento": 20,
    # Admin panels
    "phpmyadmin": 35, "adminer": 30, "cpanel": 25, "plesk": 20,
    # APIs
    "graphql": 15, "swagger": 10, "openapi": 10,
    # Auth
    "oauth": 10, "sso": 10, "ldap": 15, "saml": 10,
    # Dangerous tech
    "jenkins": 25, "gitlab": 20, "jira": 15, "confluence": 20,
    "kibana": 15, "grafana": 10, "prometheus": 10,
    # Cloud metadata
    "aws": 10, "azure": 10, "gcp": 10,
}

HIGH_RISK_PORTS = {
    21: 15,    # FTP
    22: 10,    # SSH
    23: 20,    # Telnet
    25: 10,    # SMTP
    53: 5,     # DNS
    80: 5,     # HTTP
    110: 10,   # POP3
    135: 15,   # RPC
    139: 15,   # NetBIOS
    143: 10,   # IMAP
    443: 5,    # HTTPS
    445: 20,   # SMB
    993: 10,   # IMAPS
    995: 10,   # POP3S
    1433: 20,  # MSSQL
    1521: 20,  # Oracle
    3306: 15,  # MySQL
    3389: 25,  # RDP
    5432: 15,  # PostgreSQL
    5900: 20,  # VNC
    6379: 15,  # Redis
    8080: 10,  # HTTP Alt
    8443: 10,  # HTTPS Alt
    9200: 15,  # Elasticsearch
    27017: 20, # MongoDB
}

ADMIN_PATH_PATTERNS = [
    r"/admin", r"/administrator", r"/wp-admin", r"/phpmyadmin",
    r"/manager", r"/console", r"/dashboard", r"/controlpanel",
    r"/cpanel", r"/plesk", r"/webmin", r"/usermin",
    r"/api/admin", r"/api/v1/admin", r"/graphql",
    r"/swagger", r"/openapi", r"/docs", r"/redoc",
]

# ─────────────────────────────────────────────
# Main Scoring Function
# ─────────────────────────────────────────────
async def calculate_asset_scores(programme_id: str, asset_ids: list[str] = None) -> dict:
    """Calculate risk scores for assets in a programme."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    
    try:
        if asset_ids:
            placeholders = ",".join([f"${i+1}" for i in range(len(asset_ids))])
            query = f"SELECT * FROM assets WHERE id IN ({placeholders})"
            assets = await pool.fetch(query, *asset_ids)
        else:
            query = "SELECT * FROM assets WHERE programme_id = $1"
            assets = await pool.fetch(query, programme_id)
        
        results = []
        for asset in assets:
            score = await _score_asset(pool, asset)
            results.append(score)
            
            # Upsert to asset_scores table
            await _upsert_score(pool, asset["id"], score)
        
        return {"scored": len(results), "results": results}
    finally:
        await pool.close()


async def _score_asset(pool: asyncpg.Pool, asset: dict) -> dict:
    """Calculate all scores for a single asset."""
    host = asset["host"]
    ip = asset["ip"]
    ports = asset["ports"] or []
    tech = asset["tech"] or []
    title = asset["title"] or ""
    status = asset["status"]
    tls = asset["tls"] or {}
    
    # ─────────────────────
    # Exposure Score
    # ─────────────────────
    exposure_factors = {}
    exposure_score = 0
    
    # Base exposure for having any open ports
    if ports:
        exposure_score += 10
        exposure_factors["has_open_ports"] = 10
        
        # Port-based exposure
        for port in ports:
            if port in HIGH_RISK_PORTS:
                exposure_score += HIGH_RISK_PORTS[port]
                exposure_factors[f"port_{port}"] = HIGH_RISK_PORTS[port]
    
    # TLS exposure
    if tls and tls != {}:
        exposure_score += 5
        exposure_factors["has_tls"] = 5
        if tls.get("cn"):
            exposure_score += 3
            exposure_factors["tls_cn"] = 3
    
    # Public IP
    if ip and not _is_private_ip(ip):
        exposure_score += 15
        exposure_factors["public_ip"] = 15
    
    # Favicon hash (indicates web service)
    if asset.get("favicon_hash"):
        exposure_score += 5
        exposure_factors["has_favicon"] = 5
    
    # ─────────────────────
    # Attractiveness Score
    # ─────────────────────
    attractiveness_factors = {}
    attractiveness_score = 0
    
    # Technology stack
    for t in tech:
        t_lower = t.lower()
        if t_lower in HIGH_VALUE_TECH:
            attractiveness_score += HIGH_VALUE_TECH[t_lower]
            attractiveness_factors[f"tech_{t_lower}"] = HIGH_VALUE_TECH[t_lower]
    
    # Title analysis for admin panels, login pages, etc.
    title_lower = title.lower()
    for pattern in ADMIN_PATH_PATTERNS:
        if re.search(pattern, title_lower, re.IGNORECASE):
            attractiveness_score += 15
            attractiveness_factors[f"admin_path_{pattern}"] = 15
            break
    
    # Login/auth keywords in title
    auth_keywords = ["login", "signin", "sign in", "auth", "sso", "oauth", "password", "credential"]
    for kw in auth_keywords:
        if kw in title_lower:
            attractiveness_score += 8
            attractiveness_factors[f"auth_keyword_{kw}"] = 8
            break
    
    # Parameter-rich URLs (would need URL data, using tech as proxy)
    if any(t in tech for t in ["php", "asp.net", "jsp", "node.js", "python", "java"]):
        attractiveness_score += 10
        attractiveness_factors["dynamic_backend"] = 10
    
    # Multiple technologies = more attack surface
    if len(tech) > 3:
        attractiveness_score += min(len(tech) * 2, 20)
        attractiveness_factors["tech_diversity"] = min(len(tech) * 2, 20)
    
    # ─────────────────────
    # Exploitability Score
    # ─────────────────────
    exploitability_factors = {}
    exploitability_score = 0
    
    # Check for known vulnerable technologies
    vuln_tech = {
        "wordpress": 25, "drupal": 20, "joomla": 20,
        "jenkins": 30, "gitlab": 25, "jira": 15, "confluence": 25,
        "kibana": 20, "elasticsearch": 20, "redis": 15,
        "mongodb": 15, "mysql": 10, "postgresql": 10,
        "mssql": 15, "oracle": 20, "apache": 10, "nginx": 5,
    }
    
    for t in tech:
        t_lower = t.lower()
        if t_lower in vuln_tech:
            exploitability_score += vuln_tech[t_lower]
            exploitability_factors[f"vuln_tech_{t_lower}"] = vuln_tech[t_lower]
    
    # High-risk ports with known exploits
    exploit_ports = {21: 15, 22: 10, 23: 25, 135: 20, 139: 20, 445: 30, 1433: 20, 3306: 15, 3389: 30, 5432: 15, 6379: 20, 9200: 20, 27017: 25}
    for port in ports:
        if port in exploit_ports:
            exploitability_score += exploit_ports[port]
            exploitability_factors[f"exploit_port_{port}"] = exploit_ports[port]
    
    # Check for CVEs via nuclei results (if available in findings)
    # This would join with findings/nuclei results
    # For now, use a placeholder
    
    # ─────────────────────
    # Composite Risk Score
    # ─────────────────────
    risk_score = (
        exposure_score * WEIGHTS["exposure"] +
        attractiveness_score * WEIGHTS["attractiveness"] +
        exploitability_score * WEIGHTS["exploitability"]
    )
    
    # Cap at 100
    exposure_score = min(exposure_score, 100)
    attractiveness_score = min(attractiveness_score, 100)
    exploitability_score = min(exploitability_score, 100)
    risk_score = min(risk_score, 100)
    
    # Determine tier
    tier = "info"
    for t, threshold in TIER_THRESHOLDS.items():
        if risk_score >= threshold:
            tier = t
            break
    
    return {
        "asset_id": str(asset["id"]),
        "host": host,
        "exposure_score": round(exposure_score, 1),
        "attractiveness_score": round(attractiveness_score, 1),
        "exploitability_score": round(exploitability_score, 1),
        "risk_score": round(risk_score, 1),
        "tier": tier,
        "factors": {
            "exposure": exposure_factors,
            "attractiveness": attractiveness_factors,
            "exploitability": exploitability_factors,
        },
    }


async def _upsert_score(pool: asyncpg.Pool, asset_id: str, score: dict) -> None:
    """Upsert asset score to database."""
    await pool.execute("""
        INSERT INTO asset_scores (asset_id, exposure_score, attractiveness_score, exploitability_score, risk_score, tier, factors, calculated_at, calculated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), 'auto')
        ON CONFLICT (asset_id) DO UPDATE SET
            exposure_score = EXCLUDED.exposure_score,
            attractiveness_score = EXCLUDED.attractiveness_score,
            exploitability_score = EXCLUDED.exploitability_score,
            risk_score = EXCLUDED.risk_score,
            tier = EXCLUDED.tier,
            factors = EXCLUDED.factors,
            calculated_at = NOW(),
            calculated_by = 'auto'
    """, asset_id, score["exposure_score"], score["attractiveness_score"], 
        score["exploitability_score"], score["risk_score"], score["tier"], json.dumps(score["factors"]))


def _is_private_ip(ip: str) -> bool:
    """Check if IP is private/RFC1918."""
    try:
        parts = list(map(int, ip.split(".")))
        if parts[0] == 10:
            return True
        if parts[0] == 172 and 16 <= parts[1] <= 31:
            return True
        if parts[0] == 192 and parts[1] == 168:
            return True
        if parts[0] == 127:
            return True
        if parts[0] == 169 and parts[1] == 254:
            return True
    except:
        pass
    return False


# ─────────────────────────────────────────────
# CLI Entry Point
# ─────────────────────────────────────────────
async def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python scoring_service.py <programme_id> [asset_id1 asset_id2 ...]")
        sys.exit(1)
    
    programme_id = sys.argv[1]
    asset_ids = sys.argv[2:] if len(sys.argv) > 2 else None
    
    print(f"Calculating risk scores for programme: {programme_id}")
    result = await calculate_asset_scores(programme_id, asset_ids)
    print(f"Scored {result['scored']} assets")
    
    for r in result["results"][:10]:
        print(f"  {r['host']}: Risk={r['risk_score']} ({r['tier']}) Exposure={r['exposure_score']} Attractiveness={r['attractiveness_score']} Exploitability={r['exploitability_score']}")


if __name__ == "__main__":
    asyncio.run(main())