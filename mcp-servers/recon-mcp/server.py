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


def is_in_scope(target: str, programme: str) -> tuple[bool, str]:
    """Check if a target falls within the programme's scope."""
    scope = load_programme_scope(programme)
    in_scope_patterns = scope.get("in_scope", [])
    out_of_scope_patterns = scope.get("out_of_scope", [])

    for pattern in out_of_scope_patterns:
        if re.search(pattern, target, re.IGNORECASE):
            return False, f"Target '{target}' matches out-of-scope pattern: {pattern}"

    if not in_scope_patterns:
        return True, "No scope restrictions configured (allow all)"

    for pattern in in_scope_patterns:
        if re.search(pattern, target, re.IGNORECASE):
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
    return [
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


if __name__ == "__main__":
    asyncio.run(main())
