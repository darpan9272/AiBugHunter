"""
asm-mcp — Attack Surface Management MCP Server

Tools exposed for AI agents to query and manage attack surface data:
- search_assets: Unified search across hosts, DNS, certs, WHOIS
- get_asset_graph: Pivot graph around a seed (subdomains, IPs, certs, ASN, org, cloud)
- get_asset_timeline: Historical changes for a specific asset
- create_watch_rule: Set up continuous monitoring with alerts
- run_enrichment: Trigger enrichment from external sources (Censys, Fofa, Shodan, etc.)
- get_risk_scores: Attack surface risk scoring for assets
- get_cloud_assets: Cloud resource inventory (AWS, Azure, GCP)
- search_certificates: Certificate Transparency log search
- get_asset_relationships: Direct relationship queries
"""

import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import asyncpg
import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting")
RATE_LIMIT_RPS = float(os.getenv("RATE_LIMIT_RPS", "10"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/app/output"))
TARGETS_DIR = Path(os.getenv("TARGETS_DIR", "/app/targets"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# External API keys
CENSYS_API_ID = os.getenv("CENSYS_API_ID", "")
CENSYS_API_SECRET = os.getenv("CENSYS_API_SECRET", "")
FOFA_EMAIL = os.getenv("FOFA_EMAIL", "")
FOFA_KEY = os.getenv("FOFA_KEY", "")
BINARYEDGE_API_KEY = os.getenv("BINARYEDGE_API_KEY", "")
SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")

_last_request_time: dict[str, float] = {}
_pool: Optional[asyncpg.Pool] = None

# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool


def rate_limit(tool_name: str) -> None:
    """Simple per-tool token bucket rate limiter."""
    now = time.monotonic()
    elapsed = now - _last_request_time.get(tool_name, 0)
    min_interval = 1.0 / RATE_LIMIT_RPS
    if elapsed < min_interval:
        time.sleep(min_interval - elapsed)
    _last_request_time[tool_name] = time.monotonic()


def load_programme_scope(programme: str) -> dict:
    """Load the in-scope/out-of-scope config for a programme."""
    config_path = TARGETS_DIR / "programs" / f"{programme}.yaml"
    if not config_path.exists():
        return {"in_scope": [], "out_of_scope": []}
    import yaml
    with open(config_path) as f:
        return yaml.safe_load(f)


def _compile_pattern(pattern: str) -> re.Pattern:
    """Compile a scope pattern; fall back to glob-style handling for *.domain.com."""
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error:
        glob = re.escape(pattern).replace(r"\*", ".*")
        return re.compile(glob, re.IGNORECASE)


def is_in_scope(target: str, programme: str) -> tuple[bool, str]:
    """Check if a target falls within the programme's scope."""
    scope = load_programme_scope(programme)
    in_scope_patterns = scope.get("in_scope", [])
    out_of_scope_patterns = scope.get("out_of_scope", [])

    for pattern in out_of_scope_patterns:
        if _compile_pattern(pattern).search(target):
            return False, f"Target '{target}' matches out-of-scope pattern: {pattern}"

    if not in_scope_patterns:
        return True, "No scope restrictions configured (allow all)"

    for pattern in in_scope_patterns:
        if _compile_pattern(pattern).search(target):
            return True, "In scope"

    return False, f"Target '{target}' does not match any in-scope patterns"


# ─────────────────────────────────────────────
# MCP Server Setup
# ─────────────────────────────────────────────
server = Server("asm-mcp")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="search_assets",
            description=(
                "Unified search across attack surface inventory (hosts, DNS, certificates, WHOIS). "
                "Supports Profundis-style field syntax: host:example.com port:443 tech:nginx "
                "cert.issuer:\"Let's Encrypt\" dns.type:MX whois.registrar:MarkMonitor"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query with field syntax"},
                    "asset_type": {"type": "string", "enum": ["hosts", "dns", "certs", "whois", "all"], "default": "hosts", "description": "Asset type to search"},
                    "programme": {"type": "string", "description": "Programme name for scope filtering"},
                    "limit": {"type": "integer", "default": 50, "description": "Max results"},
                    "offset": {"type": "integer", "default": 0, "description": "Pagination offset"},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="get_asset_graph",
            description=(
                "Get pivot graph around a seed domain/IP. Shows relationships: "
                "subdomain→apex, host→IP, host→cert (TLS), CNAME chains, SAN siblings, "
                "same ASN, same organization, same favicon hash, same SSL fingerprint, cloud provider."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "seed": {"type": "string", "description": "Seed domain, IP, or hostname"},
                    "programme": {"type": "string", "description": "Programme name for scope filtering"},
                    "depth": {"type": "integer", "default": 2, "description": "Graph traversal depth"},
                    "max_nodes": {"type": "integer", "default": 500, "description": "Maximum nodes to return"},
                    "include": {"type": "array", "items": {"type": "string"}, "default": ["subdomain", "ip", "cert", "cname", "san", "asn", "org", "favicon", "ssl_fp", "cloud"], "description": "Relationship types to include"},
                },
                "required": ["seed"],
            },
        ),
        Tool(
            name="get_asset_timeline",
            description=(
                "Get historical timeline of changes for a specific asset. "
                "Shows field-level changes with timestamps, old/new values, and source."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "host": {"type": "string", "description": "Hostname or IP to get timeline for"},
                    "programme": {"type": "string", "description": "Programme name"},
                    "limit": {"type": "integer", "default": 100, "description": "Max changes to return"},
                    "fields": {"type": "array", "items": {"type": "string"}, "description": "Filter by specific fields (e.g., ['ip', 'ports', 'tech', 'tls'])"},
                },
                "required": ["host"],
            },
        ),
        Tool(
            name="create_watch_rule",
            description=(
                "Create a continuous monitoring rule that alerts when new assets match a query. "
                "Supports multiple notification channels (email, Slack, Discord, PagerDuty, etc.)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Human-readable name for the rule"},
                    "query": {"type": "string", "description": "Search query to monitor"},
                    "asset_type": {"type": "string", "enum": ["hosts", "dns", "certs", "whois"], "default": "hosts"},
                    "programme": {"type": "string", "description": "Programme name"},
                    "channels": {"type": "array", "items": {"type": "string"}, "description": "Alert channel names (email, slack, etc.)"},
                    "schedule": {"type": "string", "default": "0 */6 * * *", "description": "Cron schedule for checks"},
                },
                "required": ["name", "query"],
            },
        ),
        Tool(
            name="run_enrichment",
            description=(
                "Trigger enrichment of attack surface data from external sources. "
                "Sources: censys, fofa, binaryedge, shodan, zoomeye, github, ct, cloud."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {"type": "string", "description": "Domain, IP, organization, or ASN to enrich"},
                    "target_type": {"type": "string", "enum": ["domain", "ip", "org", "asn"], "default": "domain"},
                    "sources": {"type": "array", "items": {"type": "string"}, "default": ["censys", "shodan"], "description": "Enrichment sources to use"},
                    "programme": {"type": "string", "description": "Programme name"},
                    "params": {"type": "object", "description": "Source-specific parameters"},
                },
                "required": ["target", "programme"],
            },
        ),
        Tool(
            name="get_risk_scores",
            description=(
                "Get attack surface risk scores for assets. Scores: exposure (internet-facing), "
                "attractiveness (tech/auth/params), exploitability (CVEs/exploits), composite risk."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "programme": {"type": "string", "description": "Programme name"},
                    "min_risk": {"type": "number", "default": 0, "description": "Minimum risk score (0-100)"},
                    "tier": {"type": "string", "enum": ["critical", "high", "medium", "low", "info", "all"], "default": "all"},
                    "limit": {"type": "integer", "default": 100, "description": "Max results"},
                    "offset": {"type": "integer", "default": 0},
                },
                "required": ["programme"],
            },
        ),
        Tool(
            name="get_cloud_assets",
            description=(
                "Get discovered cloud assets for a programme. Supports AWS, Azure, GCP, and others. "
                "Shows resource type, region, public exposure, and metadata."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "programme": {"type": "string", "description": "Programme name"},
                    "provider": {"type": "string", "enum": ["aws", "azure", "gcp", "digitalocean", "linode", "vultr", "all"], "default": "all"},
                    "resource_type": {"type": "string", "description": "Filter by resource type (e.g., s3, ec2, storage)"},
                    "public_only": {"type": "boolean", "default": False, "description": "Only show internet-exposed resources"},
                    "limit": {"type": "integer", "default": 200},
                },
                "required": ["programme"],
            },
        ),
        Tool(
            name="search_certificates",
            description=(
                "Search Certificate Transparency logs for certificates matching criteria. "
                "Find new certs for domains, track expirations, detect lookalikes."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "Domain to search certificates for (supports wildcards)"},
                    "programme": {"type": "string", "description": "Programme name"},
                    "issuer": {"type": "string", "description": "Filter by issuer organization"},
                    "expiring_days": {"type": "integer", "description": "Only certs expiring within N days"},
                    "include_expired": {"type": "boolean", "default": False},
                    "limit": {"type": "integer", "default": 100},
                },
                "required": ["domain"],
            },
        ),
        Tool(
            name="get_asset_relationships",
            description=(
                "Query direct relationships for an asset. Relationship types: "
                "same_asn, same_org, same_favicon, same_ssl_fp, same_cloud, cname, san, redirects_to."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "Asset UUID"},
                    "relationship": {"type": "string", "description": "Filter by relationship type"},
                    "programme": {"type": "string", "description": "Programme name"},
                    "limit": {"type": "integer", "default": 50},
                },
                "required": ["asset_id"],
            },
        ),
    ]


# ─────────────────────────────────────────────
# Tool Implementations
# ─────────────────────────────────────────────
@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    programme = arguments.get("programme", "")
    
    # Scope check for tools that need it
    if name in ["search_assets", "get_asset_graph", "get_asset_timeline", "create_watch_rule", "run_enrichment", "get_risk_scores", "get_cloud_assets", "search_certificates", "get_asset_relationships"]:
        if programme:
            # For domain/IP targets, check scope
            target = arguments.get("seed") or arguments.get("host") or arguments.get("target") or arguments.get("domain") or ""
            if target:
                in_scope, reason = is_in_scope(target, programme)
                if not in_scope:
                    return [TextContent(type="text", text=json.dumps({"error": f"Scope check failed: {reason}"}))]

    try:
        if name == "search_assets":
            return await _search_assets(arguments)
        elif name == "get_asset_graph":
            return await _get_asset_graph(arguments)
        elif name == "get_asset_timeline":
            return await _get_asset_timeline(arguments)
        elif name == "create_watch_rule":
            return await _create_watch_rule(arguments)
        elif name == "run_enrichment":
            return await _run_enrichment(arguments)
        elif name == "get_risk_scores":
            return await _get_risk_scores(arguments)
        elif name == "get_cloud_assets":
            return await _get_cloud_assets(arguments)
        elif name == "search_certificates":
            return await _search_certificates(arguments)
        elif name == "get_asset_relationships":
            return await _get_asset_relationships(arguments)
        else:
            return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": f"Tool execution failed: {str(e)}"}))]


# ─────────────────────────────────────────────
# Search Assets
# ─────────────────────────────────────────────
async def _search_assets(args: dict) -> list[TextContent]:
    rate_limit("search_assets")
    
    query = args["query"]
    asset_type = args.get("asset_type", "hosts")
    programme = args.get("programme", "")
    limit = min(args.get("limit", 50), 200)
    offset = args.get("offset", 0)
    
    pool = await get_pool()
    
    # Build query based on asset type
    if asset_type == "all":
        # Search across all types
        results = {}
        for at in ["hosts", "dns", "certs", "whois"]:
            res = await _search_single_type(pool, query, at, programme, limit // 4, offset)
            results[at] = res
        return [TextContent(type="text", text=json.dumps({"results": results, "query": query, "asset_type": "all"}))]
    else:
        res = await _search_single_type(pool, query, asset_type, programme, limit, offset)
        return [TextContent(type="text", text=json.dumps(res))]


async def _search_single_type(pool: asyncpg.Pool, query: str, asset_type: str, programme: str, limit: int, offset: int) -> dict:
    """Search a single asset type using the explore query parser logic."""
    from urllib.parse import quote
    
    # Simple field-based search for MCP (the full parser is in frontend/lib/explore.ts)
    # We'll implement a simplified version here
    where_clauses = []
    params = []
    param_idx = 0
    
    # Parse simple field:value queries
    terms = query.split()
    for term in terms:
        if ":" in term:
            field, value = term.split(":", 1)
            param_idx += 1
            if asset_type == "hosts":
                if field in ["host", "domain"]:
                    where_clauses.append(f"host ILIKE ${param_idx}")
                    params.append(f"%{value}%")
                elif field == "ip":
                    where_clauses.append(f"ip ILIKE ${param_idx}")
                    params.append(f"%{value}%")
                elif field == "port":
                    where_clauses.append(f"${param_idx} = ANY(ports)")
                    params.append(int(value) if value.isdigit() else 0)
                elif field == "tech":
                    where_clauses.append(f"EXISTS (SELECT 1 FROM jsonb_array_elements_text(tech) t WHERE t ILIKE ${param_idx})")
                    params.append(f"%{value}%")
                elif field == "status":
                    where_clauses.append(f"status = ${param_idx}")
                    params.append(int(value) if value.isdigit() else 0)
            elif asset_type == "dns":
                if field in ["name", "host"]:
                    where_clauses.append(f"name ILIKE ${param_idx}")
                    params.append(f"%{value}%")
                elif field == "type":
                    where_clauses.append(f"type = ${param_idx}")
                    params.append(value.upper())
                elif field == "value":
                    where_clauses.append(f"value ILIKE ${param_idx}")
                    params.append(f"%{value}%")
            elif asset_type == "certs":
                if field in ["cn", "subject"]:
                    where_clauses.append(f"subject_cn ILIKE ${param_idx}")
                    params.append(f"%{value}%")
                elif field == "issuer":
                    where_clauses.append(f"issuer_org ILIKE ${param_idx}")
                    params.append(f"%{value}%")
                elif field == "san":
                    where_clauses.append(f"EXISTS (SELECT 1 FROM jsonb_array_elements_text(san) s WHERE s ILIKE ${param_idx})")
                    params.append(f"%{value}%")
            elif asset_type == "whois":
                if field == "registrar":
                    where_clauses.append(f"whois->>'registrar' ILIKE ${param_idx}")
                    params.append(f"%{value}%")
    
    if programme:
        param_idx += 1
        where_clauses.append(f"programme_id = ${param_idx}")
        params.append(programme)
    
    table_map = {"hosts": "assets", "dns": "asset_dns", "certs": "asset_certs", "whois": "assets"}
    table = table_map.get(asset_type, "assets")
    
    where_sql = " AND ".join(where_clauses) if where_clauses else "TRUE"
    
    # Count total
    count_query = f"SELECT COUNT(*) FROM {table} WHERE {where_sql}"
    total = await pool.fetchval(count_query, *params)
    
    # Fetch results
    param_idx += 1
    limit_param = param_idx
    param_idx += 1
    offset_param = param_idx
    
    select_cols = "*" if asset_type != "whois" else "host, whois, last_seen"
    order = "last_seen DESC" if asset_type == "hosts" else "name ASC" if asset_type == "dns" else "not_after ASC NULLS LAST" if asset_type == "certs" else "last_seen DESC"
    
    query_sql = f"SELECT {select_cols} FROM {table} WHERE {where_sql} ORDER BY {order} LIMIT ${limit_param} OFFSET ${offset_param}"
    rows = await pool.fetch(query_sql, *params, limit, offset)
    
    return {
        "query": query,
        "asset_type": asset_type,
        "total": total,
        "limit": limit,
        "offset": offset,
        "rows": [dict(r) for r in rows],
    }


# ─────────────────────────────────────────────
# Asset Graph (Pivot Tool)
# ─────────────────────────────────────────────
async def _get_asset_graph(args: dict) -> list[TextContent]:
    rate_limit("get_asset_graph")
    
    seed = args["seed"]
    programme = args.get("programme", "")
    depth = min(args.get("depth", 2), 3)
    max_nodes = min(args.get("max_nodes", 500), 1000)
    include = args.get("include", ["subdomain", "ip", "cert", "cname", "san", "asn", "org", "favicon", "ssl_fp", "cloud"])
    
    pool = await get_pool()
    
    nodes = {}
    edges = []
    
    def add_node(node_id: str, kind: str, label: str = None, meta: dict = None):
        if node_id not in nodes and len(nodes) < max_nodes:
            nodes[node_id] = {"id": node_id, "kind": kind, "label": label or node_id, "meta": meta or {}}
    
    def add_edge(source: str, target: str, kind: str, meta: dict = None):
        if source in nodes and target in nodes:
            edges.append({"from": source, "to": target, "kind": kind, "meta": meta or {}})
    
    # Normalize seed
    apex = seed.replace("\\.", ".")
    add_node(apex, "apex", apex)
    
    # Build scope filter
    scope_filter = ""
    scope_params = []
    if programme:
        scope_filter = "AND programme_id = $1"
        scope_params = [programme]
    
    like_pattern = f"%.{apex}"
    
    # 1. Subdomain → Apex (hosts)
    if "subdomain" in include:
        query = f"""
            SELECT host, ip, tech, status, tls, favicon_hash, whois
            FROM assets 
            WHERE (host ILIKE $1 OR host = $2) {scope_filter}
            LIMIT 200
        """
        params = [like_pattern, apex] + scope_params
        assets = await pool.fetch(query, *params)
        
        for a in assets:
            add_node(a["host"], "host", a["host"], {"ip": a["ip"], "tech": a["tech"], "status": a["status"]})
            add_edge(a["host"], apex, "subdomain")
            
            # Host → IP
            if a["ip"] and "ip" in include:
                add_node(a["ip"], "ip", a["ip"])
                add_edge(a["host"], a["ip"], "resolves")
            
            # Host → Cert (TLS)
            if a["tls"] and isinstance(a["tls"], dict) and a["tls"].get("cn") and "cert" in include:
                cn = a["tls"]["cn"]
                add_node(cn, "cert", cn, {"issuer": a["tls"].get("issuer"), "expiry": a["tls"].get("not_after")})
                add_edge(a["host"], cn, "tls")
            
            # Favicon hash
            if a["favicon_hash"] and "favicon" in include:
                fp = f"favicon:{a['favicon_hash']}"
                add_node(fp, "favicon", f"favicon:{a['favicon_hash'][:16]}...")
                add_edge(a["host"], fp, "favicon")
    
    # 2. DNS Records
    if "cname" in include or "san" in include:
        query = f"""
            SELECT name, type, value FROM asset_dns 
            WHERE name ILIKE $1 {scope_filter}
            LIMIT 300
        """
        params = [like_pattern] + scope_params
        dns_records = await pool.fetch(query, *params)
        
        for d in dns_records:
            add_node(d["name"], "dns", d["name"], {"type": d["type"], "value": d["value"]})
            add_edge(d["name"], apex, "dns")
            
            if d["type"] == "CNAME" and d["value"] and "cname" in include:
                add_node(d["value"], "cname", d["value"])
                add_edge(d["name"], d["value"], "cname")
    
    # 3. Certificates (CT logs + live)
    if "cert" in include or "san" in include:
        query = f"""
            SELECT subject_cn, issuer_org, san, not_after, sha256
            FROM asset_certs 
            WHERE subject_cn ILIKE $1 {scope_filter}
            LIMIT 100
        """
        params = [like_pattern] + scope_params
        certs = await pool.fetch(query, *params)
        
        for c in certs:
            if c["subject_cn"]:
                add_node(c["subject_cn"], "cert", c["subject_cn"], {"issuer": c["issuer_org"], "expiry": c["not_after"]})
                add_edge(c["subject_cn"], apex, "cert")
                
                # SAN siblings
                if c["san"] and "san" in include:
                    for san in (c["san"] or [])[:10]:
                        if san.endswith(apex):
                            add_node(san, "host", san)
                            add_edge(san, c["subject_cn"], "san")
    
    # 4. ASN / Organization relationships (from asset_relationships table)
    if any(x in include for x in ["asn", "org", "cloud"]):
        # Get asset IDs for hosts we've found
        host_ids_query = f"""
            SELECT id, host FROM assets 
            WHERE (host ILIKE $1 OR host = $2) {scope_filter}
        """
        host_rows = await pool.fetch(host_ids_query, like_pattern, apex, *scope_params)
        host_ids = [str(r["id"]) for r in host_rows]
        
        if host_ids:
            placeholders = ",".join([f"${i+1+len(scope_params)}" for i in range(len(host_ids))])
            rel_query = f"""
                SELECT ar.*, a1.host as source_host, a2.host as target_host
                FROM asset_relationships ar
                JOIN assets a1 ON a1.id = ar.source_asset_id
                JOIN assets a2 ON a2.id = ar.target_asset_id
                WHERE ar.source_asset_id IN ({placeholders}) OR ar.target_asset_id IN ({placeholders})
                AND ar.programme_id = $1
            """
            # This is complex, skip for now - would need proper parameter binding
            pass
    
    return [TextContent(type="text", text=json.dumps({
        "seed": seed,
        "nodes": list(nodes.values())[:max_nodes],
        "edges": edges[:max_nodes * 2],
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "included_types": include,
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Asset Timeline
# ─────────────────────────────────────────────
async def _get_asset_timeline(args: dict) -> list[TextContent]:
    rate_limit("get_asset_timeline")
    
    host = args["host"]
    programme = args.get("programme", "")
    limit = min(args.get("limit", 100), 500)
    fields = args.get("fields", [])
    
    pool = await get_pool()
    
    # Find asset ID
    asset_query = "SELECT id FROM assets WHERE host = $1"
    params = [host]
    if programme:
        asset_query += " AND programme_id = $2"
        params.append(programme)
    
    asset = await pool.fetchrow(asset_query, *params)
    if not asset:
        return [TextContent(type="text", text=json.dumps({"error": f"Asset not found: {host}"}))]

    asset_id = asset["id"]
    
    # Get changes
    changes_query = """
        SELECT field_name, old_value, new_value, change_type, source, meta, created_at
        FROM asset_changes
        WHERE asset_id = $1
    """
    change_params = [asset_id]
    
    if fields:
        placeholders = ",".join([f"${i+2}" for i in range(len(fields))])
        changes_query += f" AND field_name IN ({placeholders})"
        change_params.extend(fields)
    
    changes_query += " ORDER BY created_at DESC LIMIT $%d" % (len(change_params) + 1)
    change_params.append(limit)
    
    changes = await pool.fetch(changes_query, *change_params)
    
    return [TextContent(type="text", text=json.dumps({
        "host": host,
        "asset_id": str(asset_id),
        "changes": [dict(c) for c in changes],
        "count": len(changes),
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Create Watch Rule
# ─────────────────────────────────────────────
async def _create_watch_rule(args: dict) -> list[TextContent]:
    rate_limit("create_watch_rule")
    
    name = args["name"]
    query = args["query"]
    asset_type = args.get("asset_type", "hosts")
    programme = args.get("programme", "")
    channels = args.get("channels", [])
    schedule = args.get("schedule", "0 */6 * * *")
    
    pool = await get_pool()
    
    # Create watch rule
    rule = await pool.fetchrow("""
        INSERT INTO watch_rules (name, query, asset_type, programme_id, enabled)
        VALUES ($1, $2, $3, $4, TRUE)
        RETURNING *
    """, name, query, asset_type, programme if programme else None)
    
    rule_id = rule["id"]
    
    # Link channels if provided
    if channels:
        for ch_name in channels:
            ch = await pool.fetchrow("SELECT id FROM alert_channels WHERE name = $1 AND enabled = TRUE", ch_name)
            if ch:
                await pool.execute("""
                    INSERT INTO watch_channels (watch_rule_id, channel_id)
                    VALUES ($1, $2) ON CONFLICT DO NOTHING
                """, rule_id, ch["id"])
    
    return [TextContent(type="text", text=json.dumps({
        "success": True,
        "rule": dict(rule),
        "channels_linked": len(channels),
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Run Enrichment
# ─────────────────────────────────────────────
async def _run_enrichment(args: dict) -> list[TextContent]:
    rate_limit("run_enrichment")
    
    target = args["target"]
    target_type = args.get("target_type", "domain")
    sources = args.get("sources", ["censys", "shodan"])
    programme = args["programme"]
    params = args.get("params", {})
    
    pool = await get_pool()
    
    # Create enrichment job
    job = await pool.fetchrow("""
        INSERT INTO enrichment_jobs (programme_id, source, target, target_type, params, status, started_at)
        VALUES ($1, $2, $3, $4, $5, 'running', NOW())
        RETURNING id
    """, programme, sources[0] if sources else "multi", target, target_type, json.dumps(params))
    
    job_id = job["id"]
    
    # Run enrichment for each source (async)
    results = {}
    total_changes = 0
    total_new_assets = 0
    
    for source in sources:
        try:
            if source == "censys":
                res = await _enrich_censys(target, target_type, programme, params)
            elif source == "fofa":
                res = await _enrich_fofa(target, target_type, programme, params)
            elif source == "binaryedge":
                res = await _enrich_binaryedge(target, target_type, programme, params)
            elif source == "shodan":
                res = await _enrich_shodan(target, target_type, programme, params)
            elif source == "ct":
                res = await _enrich_ct(target, programme, params)
            else:
                res = {"changes": 0, "new_assets": 0, "error": f"Unknown source: {source}"}
            
            results[source] = res
            total_changes += res.get("changes", 0)
            total_new_assets += res.get("new_assets", 0)
        except Exception as e:
            results[source] = {"error": str(e)}
    
    # Update job
    await pool.execute("""
        UPDATE enrichment_jobs 
        SET status = $1, result = $2, changes_count = $3, new_assets = $4, finished_at = NOW()
        WHERE id = $5
    """, "done" if not any("error" in r for r in results.values()) else "partial", 
       json.dumps(results), total_changes, total_new_assets, job_id)
    
    return [TextContent(type="text", text=json.dumps({
        "job_id": str(job_id),
        "status": "completed",
        "target": target,
        "sources": sources,
        "summary": {"total_changes": total_changes, "total_new_assets": total_new_assets},
        "results": results,
    }, indent=2, default=str))]


async def _enrich_censys(target: str, target_type: str, programme: str, params: dict) -> dict:
    """Enrich using Censys API."""
    if not CENSYS_API_ID or not CENSYS_API_SECRET:
        return {"error": "Censys credentials not configured", "changes": 0, "new_assets": 0}
    
    # This is a placeholder - actual Censys integration would go here
    # For now, return mock structure
    return {"changes": 0, "new_assets": 0, "note": "Censys enrichment not fully implemented"}


async def _enrich_fofa(target: str, target_type: str, programme: str, params: dict) -> dict:
    """Enrich using Fofa API."""
    if not FOFA_EMAIL or not FOFA_KEY:
        return {"error": "Fofa credentials not configured", "changes": 0, "new_assets": 0}
    
    return {"changes": 0, "new_assets": 0, "note": "Fofa enrichment not fully implemented"}


async def _enrich_binaryedge(target: str, target_type: str, programme: str, params: dict) -> dict:
    """Enrich using BinaryEdge API."""
    if not BINARYEDGE_API_KEY:
        return {"error": "BinaryEdge credentials not configured", "changes": 0, "new_assets": 0}
    
    return {"changes": 0, "new_assets": 0, "note": "BinaryEdge enrichment not fully implemented"}


async def _enrich_shodan(target: str, target_type: str, programme: str, params: dict) -> dict:
    """Enrich using Shodan API."""
    if not SHODAN_API_KEY:
        return {"error": "Shodan credentials not configured", "changes": 0, "new_assets": 0}
    
    return {"changes": 0, "new_assets": 0, "note": "Shodan enrichment not fully implemented"}


async def _enrich_ct(target: str, programme: str, params: dict) -> dict:
    """Enrich using Certificate Transparency logs."""
    return {"changes": 0, "new_assets": 0, "note": "CT enrichment not fully implemented"}


# ─────────────────────────────────────────────
# Risk Scores
# ─────────────────────────────────────────────
async def _get_risk_scores(args: dict) -> list[TextContent]:
    rate_limit("get_risk_scores")
    
    programme = args["programme"]
    min_risk = args.get("min_risk", 0)
    tier = args.get("tier", "all")
    limit = min(args.get("limit", 100), 500)
    offset = args.get("offset", 0)
    
    pool = await get_pool()
    
    where = "WHERE a.programme_id = $1 AND s.risk_score >= $2"
    params = [programme, min_risk]
    param_idx = 2
    
    if tier != "all":
        param_idx += 1
        where += f" AND s.tier = ${param_idx}"
        params.append(tier)
    
    query = f"""
        SELECT a.host, a.ip, a.ports, a.tech, a.title, a.status, a.tls,
               s.exposure_score, s.attractiveness_score, s.exploitability_score, 
               s.risk_score, s.tier, s.factors, s.calculated_at
        FROM assets a
        JOIN asset_scores s ON s.asset_id = a.id
        {where}
        ORDER BY s.risk_score DESC
        LIMIT ${param_idx + 1} OFFSET ${param_idx + 2}
    """
    params.extend([limit, offset])
    
    rows = await pool.fetch(query, *params)
    
    count_query = f"SELECT COUNT(*) FROM assets a JOIN asset_scores s ON s.asset_id = a.id {where}"
    total = await pool.fetchval(count_query, *params[:-2])
    
    return [TextContent(type="text", text=json.dumps({
        "programme": programme,
        "total": total,
        "limit": limit,
        "offset": offset,
        "assets": [dict(r) for r in rows],
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Cloud Assets
# ─────────────────────────────────────────────
async def _get_cloud_assets(args: dict) -> list[TextContent]:
    rate_limit("get_cloud_assets")
    
    programme = args["programme"]
    provider = args.get("provider", "all")
    resource_type = args.get("resource_type", "")
    public_only = args.get("public_only", False)
    limit = min(args.get("limit", 200), 500)
    
    pool = await get_pool()
    
    where = "WHERE programme_id = $1"
    params = [programme]
    param_idx = 1
    
    if provider != "all":
        param_idx += 1
        where += f" AND provider = ${param_idx}"
        params.append(provider)
    
    if resource_type:
        param_idx += 1
        where += f" AND resource_type ILIKE ${param_idx}"
        params.append(f"%{resource_type}%")
    
    if public_only:
        where += " AND public_exposure = TRUE"
    
    query = f"""
        SELECT provider, resource_type, resource_id, resource_arn, region, name, 
               metadata, tags, public_exposure, first_seen, last_seen
        FROM cloud_assets
        {where}
        ORDER BY last_seen DESC
        LIMIT ${param_idx + 1}
    """
    params.append(limit)
    
    rows = await pool.fetch(query, *params)
    
    return [TextContent(type="text", text=json.dumps({
        "programme": programme,
        "count": len(rows),
        "assets": [dict(r) for r in rows],
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Search Certificates (CT Logs)
# ─────────────────────────────────────────────
async def _search_certificates(args: dict) -> list[TextContent]:
    rate_limit("search_certificates")
    
    domain = args["domain"]
    programme = args.get("programme", "")
    issuer = args.get("issuer", "")
    expiring_days = args.get("expiring_days")
    include_expired = args.get("include_expired", False)
    limit = min(args.get("limit", 100), 500)
    
    pool = await get_pool()
    
    where = "WHERE subject_cn ILIKE $1"
    params = [f"%{domain}%"]
    param_idx = 1
    
    if programme:
        param_idx += 1
        where += f" AND programme_id = ${param_idx}"
        params.append(programme)
    
    if issuer:
        param_idx += 1
        where += f" AND issuer_org ILIKE ${param_idx}"
        params.append(f"%{issuer}%")
    
    if expiring_days:
        param_idx += 1
        where += f" AND not_after < NOW() + INTERVAL '1 day' * ${param_idx}"
        params.append(expiring_days)
    
    if not include_expired:
        where += " AND not_after > NOW()"
    
    query = f"""
        SELECT subject_cn, san, issuer_org, not_before, not_after, sha256, detected_at
        FROM asset_certs
        {where}
        ORDER BY not_after ASC NULLS LAST
        LIMIT ${param_idx + 1}
    """
    params.append(limit)
    
    rows = await pool.fetch(query, *params)
    
    return [TextContent(type="text", text=json.dumps({
        "domain": domain,
        "count": len(rows),
        "certificates": [dict(r) for r in rows],
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Asset Relationships
# ─────────────────────────────────────────────
async def _get_asset_relationships(args: dict) -> list[TextContent]:
    rate_limit("get_asset_relationships")
    
    asset_id = args["asset_id"]
    relationship = args.get("relationship", "")
    programme = args.get("programme", "")
    limit = min(args.get("limit", 50), 200)
    
    pool = await get_pool()
    
    where = "WHERE (source_asset_id = $1 OR target_asset_id = $1)"
    params = [asset_id]
    param_idx = 1
    
    if programme:
        param_idx += 1
        where += f" AND programme_id = ${param_idx}"
        params.append(programme)
    
    if relationship:
        param_idx += 1
        where += f" AND relationship = ${param_idx}"
        params.append(relationship)
    
    query = f"""
        SELECT ar.*, 
               a1.host as source_host, a2.host as target_host
        FROM asset_relationships ar
        LEFT JOIN assets a1 ON a1.id = ar.source_asset_id
        LEFT JOIN assets a2 ON a2.id = ar.target_asset_id
        {where}
        ORDER BY discovered_at DESC
        LIMIT ${param_idx + 1}
    """
    params.append(limit)
    
    rows = await pool.fetch(query, *params)
    
    return [TextContent(type="text", text=json.dumps({
        "asset_id": asset_id,
        "relationships": [dict(r) for r in rows],
        "count": len(rows),
    }, indent=2, default=str))]


# ─────────────────────────────────────────────
# Main Entry Point
# ─────────────────────────────────────────────
async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


def _run_http_bridge():
    """HTTP bridge on :8005 (same pattern as the other MCP servers)."""
    import uvicorn
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse

    app = FastAPI(title="asm-mcp")

    @app.get("/tools")
    async def tools():
        return await list_tools()

    @app.post("/call")
    async def call(payload: dict):
        tool_name = payload.get("name", "")
        arguments = payload.get("arguments", {}) or {}
        try:
            result = await call_tool(tool_name, arguments)
            text = result[0].text if result else ""
            return {"ok": True, "result": text}
        except KeyError as e:
            return JSONResponse(status_code=400, content={"error": f"Missing argument: {e}"})
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    port = int(os.getenv("HTTP_PORT", "8005"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    if os.getenv("MCP_STDIO") == "1":
        asyncio.run(main())
    else:
        _run_http_bridge()