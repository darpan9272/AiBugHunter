"""
recon-mcp — MCP server exposing recon tools as callable agent tools.

Tools exposed:
  - run_subfinder        Passive subdomain enumeration
  - run_httpx_probe      HTTP probing (status, tech, headers)
  - crawl_with_katana    JS-aware link/endpoint crawling
  - fetch_wayback_urls   Historical URL discovery (gau/waybackurls)
  - run_nmap_scan        Port and service fingerprinting
  - query_shodan         Shodan internet-wide asset search
  - run_nuclei_info      Tech-detection nuclei templates (info severity only)

All tools enforce:
  - Scope check (target must match programme allow-list)
  - Rate limiting (configurable RPS)
  - Timeout enforcement
  - Structured JSON output
"""

import asyncio
import json
import os
import re
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────
SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
RATE_LIMIT_RPS = float(os.getenv("RATE_LIMIT_RPS", "5"))
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "/app/output"))
TARGETS_DIR = Path(os.getenv("TARGETS_DIR", "/app/targets"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_last_request_time: dict[str, float] = {}


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────
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
    import yaml  # lazy import
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


def run_tool(cmd: list[str], timeout: int = 120) -> tuple[str, str, int]:
    """Run a CLI tool and return (stdout, stderr, returncode)."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired:
        return "", f"Tool timed out after {timeout}s", -1
    except FileNotFoundError as e:
        return "", f"Tool not found: {e}", -1


def parse_jsonl(raw: str) -> list[dict]:
    """Parse newline-delimited JSON output (used by httpx, nuclei, etc.)."""
    results = []
    for line in raw.strip().splitlines():
        try:
            results.append(json.loads(line))
        except json.JSONDecodeError:
            if line.strip():
                results.append({"raw": line})
    return results


# ─────────────────────────────────────────────
# MCP Server Setup
# ─────────────────────────────────────────────
server = Server("recon-mcp")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [*RECONFTW_TOOLS, *PROFUNDIS_TOOLS,
        Tool(
            name="run_subfinder",
            description=(
                "Enumerate subdomains for a domain using subfinder (passive sources). "
                "Returns a list of discovered subdomains with their sources."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string", "description": "Root domain to enumerate"},
                    "programme": {"type": "string", "description": "Programme name for scope check"},
                    "timeout": {"type": "integer", "default": 120, "description": "Timeout in seconds"},
                },
                "required": ["domain", "programme"],
            },
        ),
        Tool(
            name="run_httpx_probe",
            description=(
                "Probe a list of hosts/URLs with httpx. Returns status codes, "
                "page titles, tech stack, response times, and server headers."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "targets": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "List of hosts or URLs to probe",
                    },
                    "programme": {"type": "string"},
                    "follow_redirects": {"type": "boolean", "default": True},
                    "timeout": {"type": "integer", "default": 30},
                },
                "required": ["targets", "programme"],
            },
        ),
        Tool(
            name="crawl_with_katana",
            description=(
                "Crawl a URL with katana (JS-aware). Discovers links, endpoints, "
                "forms, and API calls. Good for finding hidden attack surface."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "url": {"type": "string"},
                    "programme": {"type": "string"},
                    "depth": {"type": "integer", "default": 3},
                    "js_crawl": {"type": "boolean", "default": True},
                    "timeout": {"type": "integer", "default": 180},
                },
                "required": ["url", "programme"],
            },
        ),
        Tool(
            name="fetch_wayback_urls",
            description=(
                "Fetch historical URLs for a domain from the Wayback Machine and gau. "
                "Great for finding forgotten endpoints and parameters."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "programme": {"type": "string"},
                    "filter_extensions": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": [".js", ".json", ".php", ".asp", ".aspx"],
                        "description": "Only return URLs with these extensions (empty = all)",
                    },
                },
                "required": ["domain", "programme"],
            },
        ),
        Tool(
            name="run_nmap_scan",
            description=(
                "Run an nmap scan on a target IP or hostname. "
                "Returns open ports and service versions."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "target": {"type": "string"},
                    "programme": {"type": "string"},
                    "scan_type": {
                        "type": "string",
                        "enum": ["quick", "service", "full"],
                        "default": "service",
                        "description": "quick=top 100 ports, service=top 1000+versions, full=all ports",
                    },
                    "timeout": {"type": "integer", "default": 300},
                },
                "required": ["target", "programme"],
            },
        ),
        Tool(
            name="query_shodan",
            description="Query Shodan for internet-facing assets matching a search string.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Shodan search query, e.g. 'hostname:example.com'"},
                    "programme": {"type": "string"},
                    "max_results": {"type": "integer", "default": 50},
                },
                "required": ["query", "programme"],
            },
        ),
        Tool(
            name="run_nuclei_info",
            description=(
                "Run nuclei with INFO/LOW severity templates only (tech detection, "
                "header analysis, no active exploitation). Safe for recon phase."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "targets": {"type": "array", "items": {"type": "string"}},
                    "programme": {"type": "string"},
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "default": ["tech", "info", "exposure", "misconfig"],
                    },
                    "timeout": {"type": "integer", "default": 300},
                },
                "required": ["targets", "programme"],
            },
        ),
    ]


# ─────────────────────────────────────────────
# Tool Implementations
# ─────────────────────────────────────────────
@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    programme = arguments.get("programme", "")

    if name == "run_subfinder":
        return await _run_subfinder(arguments, programme)
    elif name == "run_httpx_probe":
        return await _run_httpx_probe(arguments, programme)
    elif name == "crawl_with_katana":
        return await _crawl_with_katana(arguments, programme)
    elif name == "fetch_wayback_urls":
        return await _fetch_wayback_urls(arguments, programme)
    elif name == "run_nmap_scan":
        return await _run_nmap_scan(arguments, programme)
    elif name == "query_shodan":
        return await _query_shodan(arguments, programme)
    elif name == "run_nuclei_info":
        return await _run_nuclei_info(arguments, programme)
    elif name == "run_amass":
        return await _run_amass(arguments, programme)
    elif name == "run_dnsx":
        return await _run_dnsx(arguments, programme)
    elif name == "run_naabu":
        return await _run_naabu(arguments, programme)
    elif name == "run_waybackurls":
        return await _run_waybackurls(arguments, programme)
    elif name == "run_crtsh":
        return await _run_crtsh(arguments, programme)
    elif name == "run_permutations":
        return await _run_permutations(arguments, programme)
    elif name == "run_takeover_check":
        return await _run_takeover_check(arguments, programme)
    elif name == "run_js_analyzer":
        return await _run_js_analyzer(arguments, programme)
    elif name == "run_cloud_buckets":
        return await _run_cloud_buckets(arguments, programme)
    elif name == "run_domain_info":
        return await _run_domain_info(arguments, programme)
    elif name == "run_reconftw_pipeline":
        return await _run_reconftw_pipeline(arguments, programme)
    elif name == "run_whois":
        return await _run_whois(arguments)
    elif name == "run_favicon_hash":
        return await _run_favicon_hash(arguments)
    elif name == "run_typosquat":
        return await _run_typosquat(arguments, programme)
    else:
        return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def _run_subfinder(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    timeout = args.get("timeout", 120)

    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]

    rate_limit("subfinder")
    cmd = ["subfinder", "-d", domain, "-silent", "-json", "-t", "50"]
    stdout, stderr, rc = run_tool(cmd, timeout=timeout)

    subdomains = parse_jsonl(stdout)
    result = {
        "tool": "subfinder",
        "domain": domain,
        "count": len(subdomains),
        "subdomains": subdomains,
        "stderr": stderr if rc != 0 else None,
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _run_httpx_probe(args: dict, programme: str) -> list[TextContent]:
    targets = args["targets"]
    follow_redirects = args.get("follow_redirects", True)
    timeout = args.get("timeout", 30)

    # Scope-check each target
    safe_targets = []
    rejected = []
    for t in targets:
        in_scope, reason = is_in_scope(t, programme)
        if in_scope:
            safe_targets.append(t)
        else:
            rejected.append({"target": t, "reason": reason})

    if not safe_targets:
        return [TextContent(type="text", text=json.dumps({"error": "All targets rejected by scope check", "rejected": rejected}))]

    # Write targets to temp file
    tmp_file = OUTPUT_DIR / f"httpx_targets_{programme}_{int(time.time())}.txt"
    tmp_file.write_text("\n".join(safe_targets))

    rate_limit("httpx")
    cmd = [
        "httpx", "-l", str(tmp_file),
        "-json", "-silent",
        "-title", "-tech-detect", "-status-code",
        "-response-time", "-server", "-content-length",
        "-timeout", str(timeout),
    ]
    if follow_redirects:
        cmd.append("-follow-redirects")

    stdout, stderr, rc = run_tool(cmd, timeout=timeout * len(safe_targets) + 30)
    tmp_file.unlink(missing_ok=True)

    probed = parse_jsonl(stdout)
    result = {
        "tool": "httpx",
        "probed_count": len(probed),
        "rejected_by_scope": rejected,
        "results": probed,
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _crawl_with_katana(args: dict, programme: str) -> list[TextContent]:
    url = args["url"]
    depth = args.get("depth", 3)
    js_crawl = args.get("js_crawl", True)
    timeout = args.get("timeout", 180)

    in_scope, reason = is_in_scope(url, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]

    rate_limit("katana")
    cmd = [
        "katana", "-u", url,
        "-d", str(depth),
        "-json", "-silent",
        "-timeout", "10",
        "-c", "10",   # concurrency
    ]
    if js_crawl:
        cmd.extend(["-js-crawl", "-headless"])

    stdout, stderr, rc = run_tool(cmd, timeout=timeout)
    endpoints = parse_jsonl(stdout)

    result = {
        "tool": "katana",
        "url": url,
        "depth": depth,
        "endpoint_count": len(endpoints),
        "endpoints": endpoints,
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _fetch_wayback_urls(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    filter_exts = args.get("filter_extensions", [])

    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]

    rate_limit("gau")
    cmd = ["gau", "--subs", domain, "--json"]
    stdout, stderr, rc = run_tool(cmd, timeout=120)
    urls_raw = parse_jsonl(stdout)

    urls = [u.get("url", "") for u in urls_raw if u.get("url")]
    if filter_exts:
        urls = [u for u in urls if any(u.lower().endswith(ext) for ext in filter_exts)]

    result = {
        "tool": "gau",
        "domain": domain,
        "url_count": len(urls),
        "urls": urls,
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _run_nmap_scan(args: dict, programme: str) -> list[TextContent]:
    target = args["target"]
    scan_type = args.get("scan_type", "service")
    timeout = args.get("timeout", 300)

    in_scope, reason = is_in_scope(target, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]

    scan_flags = {
        "quick": ["-F", "--open"],
        "service": ["-sV", "--top-ports", "1000", "--open"],
        "full": ["-sV", "-p-", "--open"],
    }
    flags = scan_flags.get(scan_type, scan_flags["service"])

    rate_limit("nmap")
    cmd = ["nmap", target, "-oN", "-"] + flags
    stdout, stderr, rc = run_tool(cmd, timeout=timeout)

    result = {
        "tool": "nmap",
        "target": target,
        "scan_type": scan_type,
        "raw_output": stdout,
        "returncode": rc,
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _query_shodan(args: dict, programme: str) -> list[TextContent]:
    query = args["query"]
    max_results = args.get("max_results", 50)

    if not SHODAN_API_KEY:
        return [TextContent(type="text", text=json.dumps({"error": "SHODAN_API_KEY not configured"}))]

    rate_limit("shodan")
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://api.shodan.io/shodan/host/search",
                params={"key": SHODAN_API_KEY, "query": query, "minify": True},
                timeout=30,
            )
            data = resp.json()
            matches = data.get("matches", [])[:max_results]
            result = {
                "tool": "shodan",
                "query": query,
                "total_results": data.get("total", 0),
                "returned": len(matches),
                "matches": matches,
            }
        except Exception as e:
            result = {"error": str(e)}

    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _run_nuclei_info(args: dict, programme: str) -> list[TextContent]:
    targets = args["targets"]
    tags = args.get("tags", ["tech", "info", "exposure", "misconfig"])
    timeout = args.get("timeout", 300)

    safe_targets = [t for t in targets if is_in_scope(t, programme)[0]]
    if not safe_targets:
        return [TextContent(type="text", text=json.dumps({"error": "All targets out of scope"}))]

    tmp_file = OUTPUT_DIR / f"nuclei_targets_{programme}_{int(time.time())}.txt"
    tmp_file.write_text("\n".join(safe_targets))

    rate_limit("nuclei")
    tag_str = ",".join(tags)
    cmd = [
        "nuclei",
        "-l", str(tmp_file),
        "-json", "-silent",
        "-s", "info,low",   # info/low severity ONLY in recon phase
        "-tags", tag_str,
        "-c", "10",
        "-timeout", "10",
    ]
    stdout, stderr, rc = run_tool(cmd, timeout=timeout)
    tmp_file.unlink(missing_ok=True)

    findings = parse_jsonl(stdout)
    result = {
        "tool": "nuclei",
        "phase": "recon_info_only",
        "target_count": len(safe_targets),
        "finding_count": len(findings),
        "findings": findings,
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


# ─────────────────────────────────────────────
# Entry Point
# ─────────────────────────────────────────────
async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())



# ─────────────────────────────────────────────
# reconFTW capabilities — full recon module set
# ─────────────────────────────────────────────

TAKEOVER_FINGERPRINTS = [
    ("herokuapp.com", "No such app", "Heroku"),
    ("herokudns.com", "No such app", "Heroku"),
    ("github.io", "There isn't a GitHub Pages site here", "GitHub Pages"),
    ("amazonaws.com", "NoSuchBucket", "AWS S3"),
    ("cloudfront.net", "The request could not be satisfied", "CloudFront"),
    ("azurewebsites.net", "404 Web Site not found", "Azure App Service"),
    ("azureedge.net", None, "Azure CDN"),
    ("azure-api.net", None, "Azure API Management"),
    ("trafficmanager.net", None, "Azure Traffic Manager"),
    ("cloudapp.net", None, "Azure CloudApp"),
    ("unbouncepages.com", "The requested URL was not found", "Unbounce"),
    ("tumblr.com", "Whatever you were looking for doesn't currently exist", "Tumblr"),
    ("fastly.net", "Fastly error: unknown domain", "Fastly"),
    ("zendesk.com", "Help Center Closed", "Zendesk"),
    ("myshopify.com", "Sorry, this shop is currently unavailable", "Shopify"),
    ("pantheonsite.io", "404 error unknown site", "Pantheon"),
    ("surge.sh", "project not found", "Surge"),
    ("bitbucket.io", "Repository not found", "Bitbucket"),
    ("ghost.io", "The thing you were looking for is no longer here", "Ghost"),
    ("readme.io", "The project you were looking for could not be found", "Readme"),
    ("smugmug.com", "Page Not Found", "Smugmug"),
    ("webflow.io", "doesn't exist or has been moved", "Webflow"),
    ("helpscoutdocs.com", "No settings were found for this company", "HelpScout"),
    ("helpjuice.com", "We could not find what you're looking for", "Helpjuice"),
]

_PERMUTATION_WORDS = (
    "dev stage staging stg test uat qa preprod prod beta alpha demo sandbox internal int admin portal "
    "backup old new api api2 api3 v1 v2 v3 app apps web m mobile secure vpn mail cdn static assets img "
    "media docs help support status monitor jenkins ci build git grafana k8s db data auth oauth sso login "
    "dashboard panel console mgmt files upload download share repo registry artifacts cache queue worker "
    "logs metrics proxy gateway edge eu us west east emea amer apac canary green blue"
).split()

SECRET_PATTERNS = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("gcp_api_key", re.compile(r"AIza[0-9A-Za-z\-_]{35}")),
    ("openai_key", re.compile(r"sk-[a-zA-Z0-9]{20,}")),
    ("jwt", re.compile(r"eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}")),
    ("generic_secret", re.compile(r"""(?:api[_-]?key|apikey|secret|token|passwd|password)["'\s:=]{1,4}["']?([A-Za-z0-9_\-]{10,})""", re.I)),
]

RECONFTW_TOOLS = [
    Tool(name="run_amass", description="Amass passive/active subdomain enumeration (deep discovery, complements subfinder).",
         inputSchema={"type": "object", "properties": {
             "domain": {"type": "string"}, "programme": {"type": "string"},
             "active": {"type": "boolean", "default": False},
             "timeout": {"type": "integer", "default": 180}}, "required": ["domain", "programme"]}),
    Tool(name="run_dnsx", description="Resolve DNS records (A/CNAME/MX/TXT) for a list of hostnames, drop non-resolving.",
         inputSchema={"type": "object", "properties": {
             "domains": {"type": "array", "items": {"type": "string"}},
             "domain": {"type": "string"}, "programme": {"type": "string"},
             "timeout": {"type": "integer", "default": 300}}, "required": ["programme"]}),
    Tool(name="run_naabu", description="Fast port scan (top ports) on in-scope hosts. Use run_nmap_scan for deep service fingerprinting.",
         inputSchema={"type": "object", "properties": {
             "targets": {"type": "array", "items": {"type": "string"}},
             "top_ports": {"type": "integer", "default": 100}, "programme": {"type": "string"},
             "timeout": {"type": "integer", "default": 300}}, "required": ["targets", "programme"]}),
    Tool(name="run_waybackurls", description="Fetch historical URLs from the Wayback Machine for a domain (passive).",
         inputSchema={"type": "object", "properties": {
             "domain": {"type": "string"}, "programme": {"type": "string"},
             "timeout": {"type": "integer", "default": 120}}, "required": ["domain", "programme"]}),
    Tool(name="run_crtsh", description="Certificate Transparency log search (crt.sh) — passive subdomain discovery.",
         inputSchema={"type": "object", "properties": {
             "domain": {"type": "string"}, "programme": {"type": "string"},
             "timeout": {"type": "integer", "default": 90}}, "required": ["domain", "programme"]}),
    Tool(name="run_permutations", description="Generate subdomain permutations (altdns-style) from known subdomains and resolve them with dnsx.",
         inputSchema={"type": "object", "properties": {
             "domains": {"type": "array", "items": {"type": "string"}, "description": "known subdomains/apexes"},
             "programme": {"type": "string"},
             "resolve": {"type": "boolean", "default": True},
             "max_generated": {"type": "integer", "default": 15000},
             "timeout": {"type": "integer", "default": 300}}, "required": ["domains", "programme"]}),
    Tool(name="run_takeover_check", description="Subdomain takeover detection — CNAME fingerprinting against 20+ vulnerable services.",
         inputSchema={"type": "object", "properties": {
             "domains": {"type": "array", "items": {"type": "string"}},
             "programme": {"type": "string"},
             "max_checks": {"type": "integer", "default": 60},
             "timeout": {"type": "integer", "default": 240}}, "required": ["domains", "programme"]}),
    Tool(name="run_js_analyzer", description="Fetch JS files from a host and extract endpoints, API paths and leaked secrets (LinkFinder-style).",
         inputSchema={"type": "object", "properties": {
             "url": {"type": "string", "description": "page URL to mine JS from"},
             "js_urls": {"type": "array", "items": {"type": "string"}, "description": "explicit JS file URLs"},
             "programme": {"type": "string"},
             "max_js": {"type": "integer", "default": 10},
             "timeout": {"type": "integer", "default": 180}}, "required": ["programme"]}),
    Tool(name="run_cloud_buckets", description="Cloud storage exposure check — S3/GCS/Azure bucket existence and open listing for target keywords (passive HTTP).",
         inputSchema={"type": "object", "properties": {
             "keywords": {"type": "array", "items": {"type": "string"}},
             "domain": {"type": "string", "description": "derive keywords from domain if keywords not given"},
             "programme": {"type": "string"},
             "timeout": {"type": "integer", "default": 180}}, "required": ["programme"]}),
    Tool(name="run_domain_info", description="DNS profile of a domain: A/AAAA/MX/NS/TXT/SOA records + wildcard detection.",
         inputSchema={"type": "object", "properties": {
             "domain": {"type": "string"}, "programme": {"type": "string"}}, "required": ["domain", "programme"]}),
    Tool(name="run_reconftw_pipeline", description="Full reconFTW-style chain in one call: passive subs (subfinder+crt.sh+amass) → permutations → dnsx resolve → takeover check → httpx probe → wayback/gau URLs. Resume-aware, writes structured output files. Use deep=true to add naabu ports + nuclei.",
         inputSchema={"type": "object", "properties": {
             "domain": {"type": "string"}, "programme": {"type": "string"},
             "deep": {"type": "boolean", "default": False},
             "budget_seconds": {"type": "integer", "default": 240},
             "timeout": {"type": "integer", "default": 600}}, "required": ["domain", "programme"]}),
]


def _write_list(path: Path, items) -> None:
    path.write_text("\n".join(sorted(set(i.strip() for i in items if i.strip()))) + "\n")


def _read_list(path: Path) -> list[str]:
    return [l.strip() for l in path.read_text().splitlines() if l.strip()] if path.exists() else []


async def _run_amass(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]
    rate_limit("amass")
    mode = "-active" if args.get("active") else "-passive"
    cmd = ["amass", "enum", mode, "-d", domain, "-silent"]
    stdout, stderr, rc = run_tool(cmd, timeout=args.get("timeout", 180))
    subs = sorted(set(l.strip() for l in stdout.splitlines() if l.strip() and domain in l))
    return [TextContent(type="text", text=json.dumps({
        "tool": "amass", "mode": mode, "domain": domain,
        "count": len(subs), "subdomains": subs[:2000],
    }, indent=2))]


async def _run_dnsx(args: dict, programme: str) -> list[TextContent]:
    domains = args.get("domains") or ([args["domain"]] if args.get("domain") else [])
    safe = [d for d in domains if is_in_scope(d, programme)[0]][:5000]
    if not safe:
        return [TextContent(type="text", text=json.dumps({"error": "No in-scope domains supplied"}))]
    tmp = OUTPUT_DIR / f"dnsx_{uuid.uuid4().hex[:8]}.txt"
    _write_list(tmp, safe)
    rate_limit("dnsx")
    cmd = ["dnsx", "-l", str(tmp), "-silent", "-json", "-a", "-cname"]
    stdout, stderr, rc = run_tool(cmd, timeout=args.get("timeout", 300))
    tmp.unlink(missing_ok=True)
    results = parse_jsonl(stdout)
    resolving = [r.get("host") for r in results if r.get("host")]
    return [TextContent(type="text", text=json.dumps({
        "tool": "dnsx", "queried": len(safe), "resolving": len(resolving),
        "hosts": resolving[:3000], "records": results[:500],
    }, indent=2))]


async def _run_naabu(args: dict, programme: str) -> list[TextContent]:
    targets = [t for t in (args.get("targets") or []) if is_in_scope(t, programme)[0]][:1000]
    if not targets:
        return [TextContent(type="text", text=json.dumps({"error": "All targets out of scope"}))]
    tmp = OUTPUT_DIR / f"naabu_{uuid.uuid4().hex[:8]}.txt"
    _write_list(tmp, targets)
    rate_limit("naabu")
    top = int(args.get("top_ports", 100))
    cmd = ["naabu", "-l", str(tmp), "-top-ports", str(top), "-silent", "-json"]
    stdout, stderr, rc = run_tool(cmd, timeout=args.get("timeout", 300))
    tmp.unlink(missing_ok=True)
    results = parse_jsonl(stdout)
    open_ports = sorted(set(f"{r.get('host')}:{r.get('port')}" for r in results if r.get("port")))
    return [TextContent(type="text", text=json.dumps({
        "tool": "naabu", "targets": len(targets), "open_ports": open_ports[:2000],
        "count": len(open_ports),
    }, indent=2))]


async def _run_waybackurls(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]
    rate_limit("waybackurls")
    stdout, stderr, rc = run_tool(["waybackurls", domain], timeout=args.get("timeout", 120))
    urls = sorted(set(l.strip() for l in stdout.splitlines() if l.strip()))
    return [TextContent(type="text", text=json.dumps({
        "tool": "waybackurls", "domain": domain, "count": len(urls), "urls": urls[:3000],
    }, indent=2))]


async def _run_crtsh(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]
    rate_limit("crtsh")
    try:
        entries = None
        async with httpx.AsyncClient(timeout=args.get("timeout", 90)) as client:
            for attempt in range(3):
                res = await client.get(f"https://crt.sh/?q=%25.{domain}&output=json")
                if res.status_code == 200 and res.headers.get("content-type", "").startswith("application/json"):
                    entries = res.json()
                    break
                await asyncio.sleep(2 + attempt * 3)
        if entries is None:
            return [TextContent(type="text", text=json.dumps({
                "error": f"crt.sh unavailable (HTTP {res.status_code} after 3 attempts) — use run_subfinder/run_amass instead"}))]
        if args.get("raw"):
            certs = {}
            for e in entries[:5000]:
                key = (e.get("common_name") or "", e.get("issuer_name") or "", e.get("not_before") or "")
                sans = set()
                for n in e.get("name_value", "").split("\n"):
                    n = n.strip().lower()
                    if n:
                        sans.add(n)
                if key in certs:
                    certs[key]["san"] = sorted(set(certs[key]["san"]) | sans)[:200]
                else:
                    import re as _re
                    m = _re.search(r"O=([^,]+)", e.get("issuer_name") or "")
                    certs[key] = {
                        "common_name": key[0], "issuer_org": m.group(1).strip() if m else (e.get("issuer_name") or ""),
                        "not_before": e.get("not_before"), "not_after": e.get("not_after"),
                        "sha256": f"crtsh-{e.get('id')}", "san": sorted(sans)[:200],
                    }
            return [TextContent(type="text", text=json.dumps({
                "tool": "crt.sh", "domain": domain, "count": len(certs),
                "certificates": list(certs.values())[:1000],
            }, indent=2))]
        names = set()
        for e in entries:
            for n in e.get("name_value", "").split("\n"):
                n = n.strip().lower()
                if n and not n.startswith("*") and n.endswith(domain):
                    names.add(n)
        return [TextContent(type="text", text=json.dumps({
            "tool": "crt.sh", "domain": domain, "count": len(names), "subdomains": sorted(names)[:5000],
        }, indent=2))]
    except Exception as e:
        return [TextContent(type="text", text=json.dumps({"error": f"crt.sh failed: {e}"}))]



def _wildcard_ips(apexes: list[str]) -> set[str]:
    """Detect wildcard DNS IPs by resolving random canary subdomains."""
    import random, string
    ips: set[str] = set()
    for apex in apexes:
        canary = "wfcanary-" + "".join(random.choices(string.ascii_lowercase, k=10)) + "." + apex
        out, _, _ = run_tool(["dig", "+short", "A", canary], timeout=15)
        for line in out.splitlines():
            line = line.strip().rstrip(".")
            if re.match(r"^\d+\.\d+\.\d+\.\d+$", line):
                ips.add(line)
    return ips


def _apex_of(host: str) -> str:
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host

def _generate_permutations(subs: list[str], cap: int) -> list[str]:
    out = set()
    for sub in subs:
        parts = sub.split(".")
        if len(parts) < 3:
            first, rest = "", sub
        else:
            first, rest = parts[0], ".".join(parts[1:])
        base = rest if not first else f"{first}.{rest}"
        for w in _PERMUTATION_WORDS:
            if first:
                out.add(f"{w}-{first}.{rest}")
                out.add(f"{first}-{w}.{rest}")
            out.add(f"{w}.{base}")
            if len(out) >= cap:
                return sorted(out)
    return sorted(out)


async def _run_permutations(args: dict, programme: str) -> list[TextContent]:
    subs = [d.lower() for d in (args.get("domains") or [])][:200]
    if not subs:
        return [TextContent(type="text", text=json.dumps({"error": "domains list required"}))]
    cap = int(args.get("max_generated", 15000))
    generated = _generate_permutations(subs, cap)
    known = set(subs)
    if not args.get("resolve", True):
        return [TextContent(type="text", text=json.dumps({
            "tool": "permutations", "generated": len(generated), "candidates": generated[:cap],
        }, indent=2))]
    tmp = OUTPUT_DIR / f"perm_{uuid.uuid4().hex[:8]}.txt"
    _write_list(tmp, generated)
    rate_limit("permutations")
    wildcards = _wildcard_ips(sorted({_apex_of(s) for s in subs}))
    cmd = ["dnsx", "-l", str(tmp), "-silent", "-json", "-a"]
    stdout, stderr, rc = run_tool(cmd, timeout=args.get("timeout", 300))
    tmp.unlink(missing_ok=True)
    resolving: set[str] = set()
    for rec in parse_jsonl(stdout):
        host = rec.get("host")
        ips = set(rec.get("a") or [])
        if host and (not wildcards or not ips.issubset(wildcards)):
            resolving.add(host)
    resolving -= known
    return [TextContent(type="text", text=json.dumps({
        "tool": "permutations", "generated": len(generated),
        "wildcard_ips": sorted(wildcards),
        "new_resolving": len(resolving), "subdomains": sorted(resolving)[:3000],
    }, indent=2))]


async def _takeover_one(client: httpx.AsyncClient, sem: asyncio.Semaphore, domain: str) -> dict | None:
    async with sem:
        try:
            proc = await asyncio.create_subprocess_exec(
                "dig", "+short", "CNAME", domain,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            cname = out.decode().strip().rstrip(".").lower()
            if not cname:
                return None
            for pattern, fingerprint, service in TAKEOVER_FINGERPRINTS:
                if pattern in cname:
                    try:
                        res = await client.get(f"http://{domain}", timeout=8)
                        body = res.text[:100000]
                    except Exception:
                        body, res = "", None
                    if fingerprint and fingerprint.lower() in body.lower():
                        return {"domain": domain, "service": service, "cname": cname,
                                "evidence": f"fingerprint matched, HTTP {res.status_code if res else 'n/a'}",
                                "severity": "high"}
                    if fingerprint is None and res is not None and res.status_code in (400, 404, 410):
                        return {"domain": domain, "service": service, "cname": cname,
                                "evidence": f"CNAME to {pattern}, HTTP {res.status_code} — manual verification needed",
                                "severity": "medium"}
                    return None
            return None
        except Exception:
            return None


async def _run_takeover_check(args: dict, programme: str) -> list[TextContent]:
    domains = [d for d in (args.get("domains") or []) if is_in_scope(d, programme)[0]][:int(args.get("max_checks", 60))]
    if not domains:
        return [TextContent(type="text", text=json.dumps({"error": "No in-scope domains supplied"}))]
    rate_limit("takeover")
    sem = asyncio.Semaphore(10)
    async with httpx.AsyncClient(follow_redirects=False, timeout=8) as client:
        results = await asyncio.gather(*[_takeover_one(client, sem, d) for d in domains])
    candidates = [r for r in results if r]
    return [TextContent(type="text", text=json.dumps({
        "tool": "takeover_check", "checked": len(domains),
        "candidates": candidates, "count": len(candidates),
    }, indent=2))]


_ENDPOINT_RE = re.compile(r"""["'](/(?:api|v[0-9]+|graphql|auth|user|admin|internal|rest|svc|service|gateway)[a-zA-Z0-9_\-/\.\{\}:]*)["']""")


async def _run_js_analyzer(args: dict, programme: str) -> list[TextContent]:
    js_urls = list(args.get("js_urls") or [])
    page_url = args.get("url")
    if page_url:
        host = re.sub(r"^https?://", "", page_url).split("/")[0]
        in_scope, reason = is_in_scope(host, programme)
        if not in_scope:
            return [TextContent(type="text", text=json.dumps({"error": reason}))]
        try:
            async with httpx.AsyncClient(follow_redirects=True, timeout=30, verify=False) as client:
                html = (await client.get(page_url)).text
            from urllib.parse import urljoin
            js_urls += [urljoin(page_url, s) for s in re.findall(r'<script[^>]+src=["\']([^"\']+\.js[^"\']*)', html)]
        except Exception as e:
            return [TextContent(type="text", text=json.dumps({"error": f"page fetch failed: {e}"}))]
    js_urls = list(dict.fromkeys(js_urls))[: int(args.get("max_js", 10))]
    if not js_urls:
        return [TextContent(type="text", text=json.dumps({"error": "no JS files found/provided"}))]

    endpoints: set[str] = set()
    secrets: list[dict] = []
    analyzed = 0
    async with httpx.AsyncClient(follow_redirects=True, timeout=30, verify=False) as client:
        for u in js_urls:
            try:
                body = (await client.get(u)).text[:500_000]
                analyzed += 1
            except Exception:
                continue
            endpoints.update(m.group(1) for m in _ENDPOINT_RE.finditer(body))
            for stype, rx in SECRET_PATTERNS:
                for m in rx.finditer(body):
                    val = m.group(1) if stype == "generic_secret" else m.group(0)
                    secrets.append({"type": stype, "match": val[:8] + "…" + val[-4:], "js_file": u})
    return [TextContent(type="text", text=json.dumps({
        "tool": "js_analyzer", "js_files_analyzed": analyzed,
        "endpoints": sorted(endpoints)[:200],
        "secrets": secrets[:50], "secret_count": len(secrets),
    }, indent=2))]


async def _run_cloud_buckets(args: dict, programme: str) -> list[TextContent]:
    keywords = list(args.get("keywords") or [])
    if not keywords and args.get("domain"):
        apex = args["domain"].split(".")[0]
        keywords = [apex, f"{apex}-backup", f"{apex}-dev", f"{apex}-prod", f"{apex}-data", f"{apex}-assets"]
    keywords = [re.sub(r"[^a-z0-9\-]", "", k.lower()) for k in keywords if k][:20]
    if not keywords:
        return [TextContent(type="text", text=json.dumps({"error": "no keywords"}))]

    async def probe(client, provider, url):
        try:
            res = await client.get(url, timeout=8)
            status = res.status_code
            if status == 404:
                return None
            open_listing = status == 200 and ("<ListBucketResult" in res.text or "<EnumerationResults" in res.text)
            return {"provider": provider, "url": url, "status": status, "open_listing": open_listing}
        except Exception:
            return None

    sem = asyncio.Semaphore(10)
    results = []
    async with httpx.AsyncClient(follow_redirects=False, timeout=8) as client:
        tasks = []
        for kw in keywords:
            tasks += [
                probe(client, "aws-s3", f"https://{kw}.s3.amazonaws.com"),
                probe(client, "gcp-storage", f"https://storage.googleapis.com/{kw}"),
                probe(client, "azure-blob", f"https://{kw}.blob.core.windows.net"),
            ]
        async def guarded(t):
            async with sem:
                return await t
        results = [r for r in await asyncio.gather(*[guarded(t) for t in tasks]) if r]
    return [TextContent(type="text", text=json.dumps({
        "tool": "cloud_buckets", "checked": len(keywords) * 3,
        "found": results, "open": [r for r in results if r["open_listing"]],
    }, indent=2))]


async def _run_domain_info(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]
    rate_limit("domain_info")
    records = {}
    for rtype in ["A", "AAAA", "MX", "NS", "TXT", "SOA"]:
        stdout, _, _ = run_tool(["dig", "+short", rtype, domain], timeout=20)
        records[rtype] = [l for l in stdout.splitlines() if l.strip()][:20]
    import random, string
    canary = "nonexistent-" + "".join(random.choices(string.ascii_lowercase, k=8)) + "." + domain
    stdout, _, _ = run_tool(["dig", "+short", "A", canary], timeout=20)
    records["wildcard_dns"] = bool(stdout.strip())
    return [TextContent(type="text", text=json.dumps({
        "tool": "domain_info", "domain": domain, "records": records,
    }, indent=2))]


async def _run_reconftw_pipeline(args: dict, programme: str) -> list[TextContent]:
    domain = args["domain"]
    in_scope, reason = is_in_scope(domain, programme)
    if not in_scope:
        return [TextContent(type="text", text=json.dumps({"error": reason}))]

    deep = bool(args.get("deep"))
    budget = int(args.get("budget_seconds", 240))
    t0 = time.monotonic()
    outdir = OUTPUT_DIR / "reconftw" / re.sub(r"[^a-zA-Z0-9\.\-]", "_", domain)
    outdir.mkdir(parents=True, exist_ok=True)

    summary: dict = {"tool": "reconftw_pipeline", "domain": domain, "deep": deep,
                     "output_dir": str(outdir), "steps": {}}

    def budget_ok() -> bool:
        return (time.monotonic() - t0) < budget

    # 1 — passive subdomain enum: subfinder + crt.sh + amass
    f_subs = outdir / "subdomains_passive.txt"
    if f_subs.exists():
        subs = _read_list(f_subs)
        summary["steps"]["passive_enum"] = {"status": "resumed", "count": len(subs)}
    else:
        rate_limit("pipeline_subfinder")
        stdout, _, _ = run_tool(["subfinder", "-d", domain, "-silent"], timeout=120)
        subs = set(l.strip() for l in stdout.splitlines() if l.strip())
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                entries = (await client.get(f"https://crt.sh/?q=%25.{domain}&output=json")).json()
            for e in entries:
                for n in e.get("name_value", "").split("\n"):
                    n = n.strip().lower()
                    if n and not n.startswith("*") and n.endswith(domain):
                        subs.add(n)
        except Exception:
            pass
        if budget_ok():
            stdout2, _, _ = run_tool(["amass", "enum", "-passive", "-d", domain, "-silent"], timeout=120)
            subs.update(l.strip() for l in stdout2.splitlines() if l.strip() and domain in l)
        subs = sorted(subs)
        _write_list(f_subs, subs)
        summary["steps"]["passive_enum"] = {"status": "done", "count": len(subs)}

    # 2 — permutations
    f_perm = outdir / "subdomains_permutations.txt"
    if f_perm.exists():
        summary["steps"]["permutations"] = {"status": "resumed", "count": len(_read_list(f_perm))}
    else:
        _write_list(f_perm, _generate_permutations(subs, 15000))
        summary["steps"]["permutations"] = {"status": "done", "count": len(_read_list(f_perm))}

    # 3 — dnsx resolution of everything
    f_res = outdir / "resolved.txt"
    if f_res.exists():
        resolved = _read_list(f_res)
        summary["steps"]["resolve"] = {"status": "resumed", "count": len(resolved)}
    else:
        allsubs = OUTPUT_DIR / f"allsubs_{uuid.uuid4().hex[:8]}.txt"
        _write_list(allsubs, subs + _read_list(f_perm))
        wildcards = _wildcard_ips([domain])
        stdout, _, _ = run_tool(["dnsx", "-l", str(allsubs), "-silent", "-json", "-a"], timeout=300)
        allsubs.unlink(missing_ok=True)
        passive_set = set(subs)
        resolved_set: set[str] = set()
        for rec in parse_jsonl(stdout):
            host = rec.get("host")
            ips = set(rec.get("a") or [])
            is_wildcard_noise = bool(wildcards) and ips and ips.issubset(wildcards) and host not in passive_set
            if host and not is_wildcard_noise:
                resolved_set.add(host)
        resolved = sorted(resolved_set)
        _write_list(f_res, resolved)
        summary["steps"]["resolve"] = {"status": "done", "count": len(resolved),
                                       "wildcard_ips": sorted(wildcards)}

    # 4 — takeover check (first 60 resolving subs)
    f_to = outdir / "takeover.json"
    if f_to.exists():
        summary["steps"]["takeover"] = {"status": "resumed", **json.loads(f_to.read_text())}
    elif budget_ok():
        r = await _run_takeover_check({"domains": resolved[:60]}, programme)
        data = json.loads(r[0].text)
        f_to.write_text(json.dumps(data))
        summary["steps"]["takeover"] = {"status": "done", "candidates": data.get("count", 0)}
        summary["takeover_candidates"] = data.get("candidates", [])
    else:
        summary["steps"]["takeover"] = {"status": "skipped_budget"}

    # 5 — httpx web probe on resolved subs
    f_httpx = outdir / "httpx.json"
    if f_httpx.exists():
        probe = parse_jsonl(f_httpx.read_text())
        summary["steps"]["web_probe"] = {"status": "resumed", "count": len(probe)}
    elif budget_ok():
        tmp = OUTPUT_DIR / f"httpx_in_{uuid.uuid4().hex[:8]}.txt"
        _write_list(tmp, resolved[:500])
        stdout, _, _ = run_tool(
            ["httpx", "-l", str(tmp), "-json", "-silent", "-tech-detect", "-status-code", "-title"],
            timeout=240)
        tmp.unlink(missing_ok=True)
        f_httpx.write_text(stdout)
        probe = parse_jsonl(stdout)
        summary["steps"]["web_probe"] = {"status": "done", "count": len(probe)}
    else:
        probe = []
        summary["steps"]["web_probe"] = {"status": "skipped_budget"}
    summary["live_hosts"] = [p.get("url") for p in probe if p.get("url")][:100]

    # 6 — historical URLs (gau + waybackurls)
    f_urls = outdir / "urls.txt"
    if f_urls.exists():
        summary["steps"]["urls"] = {"status": "resumed", "count": len(_read_list(f_urls))}
    elif budget_ok():
        urls = set()
        for cmd in (["gau", "--subs", domain], ["waybackurls", domain]):
            stdout, _, _ = run_tool(cmd, timeout=90)
            urls.update(l.strip() for l in stdout.splitlines() if l.strip() and l.startswith("http"))
        _write_list(f_urls, sorted(urls))
        summary["steps"]["urls"] = {"status": "done", "count": len(urls)}
    else:
        summary["steps"]["urls"] = {"status": "skipped_budget"}

    # 7+8 — deep mode: naabu ports + nuclei info on live hosts
    if deep and budget_ok():
        live_hosts = [re.sub(r"^https?://", "", u).split("/")[0] for u in summary.get("live_hosts", [])]
        if live_hosts:
            tmp = OUTPUT_DIR / f"naabu_in_{uuid.uuid4().hex[:8]}.txt"
            _write_list(tmp, live_hosts[:200])
            stdout, _, _ = run_tool(["naabu", "-l", str(tmp), "-top-ports", "100", "-silent", "-json"], timeout=300)
            tmp.unlink(missing_ok=True)
            (outdir / "ports.json").write_text(stdout)
            ports = parse_jsonl(stdout)
            summary["steps"]["ports"] = {"status": "done", "open": len(ports)}
        if summary.get("live_hosts"):
            r = await _run_nuclei_info({"targets": summary["live_hosts"][:50]}, programme)
            data = json.loads(r[0].text)
            (outdir / "nuclei_info.json").write_text(r[0].text)
            summary["steps"]["nuclei_info"] = {"status": "done", "findings": data.get("finding_count", 0)}
            summary["nuclei_findings"] = data.get("findings", [])[:20]
    elif deep:
        summary["steps"]["deep"] = {"status": "skipped_budget"}

    summary["elapsed_seconds"] = round(time.monotonic() - t0, 1)
    return [TextContent(type="text", text=json.dumps(summary, indent=2))]




# ─────────────────────────────────────────────
# Profundis-style tools: WHOIS, favicon hash, typosquatting
# ─────────────────────────────────────────────

def _mmh3_32(data: bytes, seed: int = 0) -> int:
    """MurmurHash3 x86_32 (pure python) — Shodan-compatible favicon hashing."""
    def rotl(x, r):
        return ((x << r) | (x >> (32 - r))) & 0xFFFFFFFF

    def fmix(h):
        h ^= h >> 16
        h = (h * 0x85EBCA6B) & 0xFFFFFFFF
        h ^= h >> 13
        h = (h * 0xC2B2AE35) & 0xFFFFFFFF
        h ^= h >> 16
        return h

    c1, c2 = 0xCC9E2D51, 0x1B873593
    h = seed & 0xFFFFFFFF
    nblocks = len(data) // 4
    for i in range(nblocks):
        k = int.from_bytes(data[i * 4:(i + 1) * 4], "little")
        k = (k * c1) & 0xFFFFFFFF
        k = rotl(k, 15)
        k = (k * c2) & 0xFFFFFFFF
        h ^= k
        h = rotl(h, 13)
        h = (h * 5 + 0xE6546B64) & 0xFFFFFFFF
    tail = data[nblocks * 4:]
    k = 0
    for j, b in enumerate(tail):
        k |= b << (8 * j)
    if tail:
        k = (k * c1) & 0xFFFFFFFF
        k = rotl(k, 15)
        k = (k * c2) & 0xFFFFFFFF
        h ^= k
    h ^= len(data)
    h = fmix(h)
    return h - 0x100000000 if h >= 0x80000000 else h


async def _run_favicon_hash(args: dict) -> list[TextContent]:
    host = args.get("host", "").replace("https://", "").replace("http://", "").split("/")[0]
    if not host:
        return [TextContent(type="text", text=json.dumps({"error": "host required"}))]
    for scheme in ("https", "http"):
        try:
            async with httpx.AsyncClient(timeout=15, verify=False, follow_redirects=True) as client:
                res = await client.get(f"{scheme}://{host}/favicon.ico")
            if res.status_code == 200 and res.content:
                import codecs
                h = _mmh3_32(codecs.encode(res.content))
                return [TextContent(type="text", text=json.dumps({
                    "tool": "favicon_hash", "host": host, "favicon_hash": str(h),
                    "bytes": len(res.content), "url": f"{scheme}://{host}/favicon.ico",
                }, indent=2))]
        except Exception:
            continue
    return [TextContent(type="text", text=json.dumps({"host": host, "favicon_hash": None, "note": "no favicon"}))]


async def _run_whois(args: dict) -> list[TextContent]:
    domain = args.get("domain", "")
    if not domain:
        return [TextContent(type="text", text=json.dumps({"error": "domain required"}))]
    rate_limit("whois")
    stdout, stderr, rc = run_tool(["whois", domain], timeout=45)
    if not stdout.strip():
        return [TextContent(type="text", text=json.dumps({"error": f"whois returned nothing: {stderr[:200]}"}))]

    fields: dict[str, str | list[str]] = {}
    emails: set[str] = set()
    keymap = {
        "registrar": ["Registrar:", "registrar:", "Registrar Name:"],
        "created": ["Creation Date:", "Created:", "created:", "Registration Date:", "registered on:"],
        "updated": ["Updated Date:", "Updated:", "Last updated:", "last updated:"],
        "expires": ["Registry Expiry Date:", "Expiry Date:", "Expiration Date:", "expires:", "Expiry date:"],
        "org": ["Registrant Organization:", "Registrant:", "registrant:", "Registrant Name:"],
        "country": ["Registrant Country:", "Registrant Country/Area:"],
    }
    for line in stdout.splitlines():
        if ":" not in line:
            continue
        k, _, v = line.partition(":")
        v = v.strip()
        if "@" in v and " " not in v:
            emails.add(v.lower())
        for out_key, variants in keymap.items():
            if f"{k.strip()}:" in variants and v:
                fields[out_key] = v
        if k.strip().lower() in ("name server", "nserver") and v:
            fields.setdefault("name_servers", [])
            (fields["name_servers"] if isinstance(fields["name_servers"], list) else []).append(v.lower())
    fields["emails"] = sorted(emails)[:10]
    fields["raw_lines"] = len(stdout.splitlines())
    return [TextContent(type="text", text=json.dumps({"tool": "whois", "domain": domain, **fields}, indent=2, default=str))]


_TYPO_HOMOGLYPHS = {"o": "0", "l": "1", "i": "1", "e": "3", "a": "4", "s": "5", "t": "7", "b": "8", "g": "9", "rn": "m"}
_TYPO_TLDS = ["com", "net", "org", "io", "co", "app", "dev", "info", "biz", "cc"]


def _typosquat_candidates(domain: str, cap: int = 2000) -> list[str]:
    name, _, tld = domain.rpartition(".")
    if not tld:
        return []
    cands: set[str] = set()
    # omission — drop each char
    for i in range(len(name)):
        cands.add(name[:i] + name[i + 1:])
    # doubling removal
    for i in range(len(name) - 1):
        if name[i] == name[i + 1]:
            cands.add(name[:i] + name[i + 1:])
    # adjacent swap
    for i in range(len(name) - 1):
        cands.add(name[:i] + name[i + 1] + name[i] + name[i + 2:])
    # duplication of each char
    for i in range(len(name)):
        cands.add(name[:i] + name[i] + name[i:])
    # homoglyph substitution
    for i, ch in enumerate(name):
        if ch in _TYPO_HOMOGLYPHS:
            cands.add(name[:i] + _TYPO_HOMOGLYPHS[ch] + name[i + 1:])
    # "rn" → "m" and reverse
    if "rn" in name:
        cands.add(name.replace("rn", "m", 1))
    if "m" in name:
        cands.add(name.replace("m", "rn", 1))
    # hyphen insertion/removal
    cands.add(name.replace("-", ""))
    for i in range(1, len(name)):
        cands.add(name[:i] + "-" + name[i:])
    # common affixes
    for pre in ("www", "secure", "login", "my", "account", "support", "help", "mail"):
        cands.add(f"{pre}{name}")
        cands.add(f"{pre}-{name}")
    cands.discard(name)
    cands = {c for c in cands if c and not c.startswith("-") and not c.endswith("-")}
    out = {f"{c}.{tld}" for c in cands}
    # TLD variants of the exact name
    for t in _TYPO_TLDS:
        if t != tld:
            out.add(f"{name}.{t}")
    return sorted(out)[:cap]


async def _run_typosquat(args: dict, programme: str) -> list[TextContent]:
    domain = args.get("domain", "")
    if not domain:
        return [TextContent(type="text", text=json.dumps({"error": "domain required"}))]
    cap = int(args.get("max_generated", 1500))
    candidates = _typosquat_candidates(domain, cap)
    tmp = OUTPUT_DIR / f"typo_{uuid.uuid4().hex[:8]}.txt"
    _write_list(tmp, candidates)
    rate_limit("typosquat")
    cmd = ["dnsx", "-l", str(tmp), "-silent", "-json", "-a"]
    stdout, stderr, rc = run_tool(cmd, timeout=args.get("timeout", 300))
    tmp.unlink(missing_ok=True)
    registered = []
    for rec in parse_jsonl(stdout):
        if rec.get("host"):
            registered.append({"domain": rec["host"], "ips": rec.get("a") or []})
    return [TextContent(type="text", text=json.dumps({
        "tool": "typosquat", "domain": domain, "generated": len(candidates),
        "registered_count": len(registered), "registered": registered[:300],
        "note": "Registered typo-domains may indicate squatting/phishing infrastructure — investigate.",
    }, indent=2))]


PROFUNDIS_TOOLS = [
    Tool(name="run_whois", description="WHOIS lookup for a domain — registrar, creation/expiry dates, name servers, contact emails.",
         inputSchema={"type": "object", "properties": {"domain": {"type": "string"}},
                      "required": ["domain"]}),
    Tool(name="run_favicon_hash", description="Compute the Shodan-style mmh3 favicon hash for a host — enables favicon:hash asset pivoting.",
         inputSchema={"type": "object", "properties": {"host": {"type": "string"}},
                      "required": ["host"]}),
    Tool(name="run_typosquat", description="Typosquatting detection — generate domain permutations (omission, swap, homoglyph, hyphen, TLD variants) and find registered ones via dnsx.",
         inputSchema={"type": "object", "properties": {
             "domain": {"type": "string"}, "programme": {"type": "string"},
             "max_generated": {"type": "integer", "default": 1500},
             "timeout": {"type": "integer", "default": 300}}, "required": ["domain", "programme"]}),
]


# ─────────────────────────────────────────────
# HTTP bridge — lets the harness engine call tools over HTTP.
# (stdio MCP mode still available via MCP_STDIO=1)
# ─────────────────────────────────────────────
def _run_http_bridge():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    import uvicorn

    app = FastAPI(title="recon-mcp http bridge")

    @app.get("/health")
    async def health():
        return {"status": "ok", "server": "recon-mcp"}

    @app.get("/tools")
    async def tools():
        return await list_tools()

    @app.post("/call")
    async def call(payload: dict):
        tool_name = payload.get("name", "")
        arguments = payload.get("arguments", {}) or {}
        try:
            # run in a worker thread so long tools don't block the HTTP loop
            def _exec():
                return asyncio.run(call_tool(tool_name, arguments))
            result = await asyncio.to_thread(_exec)
            text = result[0].text if result else ""
            return {"ok": True, "result": text}
        except KeyError as e:
            return JSONResponse(status_code=400, content={"error": f"Missing argument: {e}"})
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    port = int(os.getenv("HTTP_PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    if os.getenv("MCP_STDIO") == "1":
        asyncio.run(main())
    else:
        _run_http_bridge()
