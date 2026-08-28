"""
report-mcp — MCP server for report generation support.

Tools exposed:
  - lookup_cve          Look up a CVE by ID from NVD
  - search_cve          Search NVD for CVEs matching a keyword/product
  - render_report       Render a bug report markdown file and save to /reports/
  - calculate_cvss      Parse and explain a CVSS vector string
  - submit_to_webhook   POST a report summary to Slack/Discord
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

NVD_API_KEY = os.getenv("NVD_API_KEY", "")
SLACK_WEBHOOK = os.getenv("SLACK_WEBHOOK_URL", "")
DISCORD_WEBHOOK = os.getenv("DISCORD_WEBHOOK_URL", "")
REPORTS_DIR = Path(os.getenv("REPORTS_DIR", "/app/reports"))
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

server = Server("report-mcp")


@server.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="lookup_cve",
            description="Look up a specific CVE by ID from the NVD database. Returns CVSS score, description, affected products, and remediation info.",
            inputSchema={
                "type": "object",
                "properties": {
                    "cve_id": {"type": "string", "description": "CVE ID, e.g. CVE-2024-1234"},
                },
                "required": ["cve_id"],
            },
        ),
        Tool(
            name="search_cve",
            description="Search NVD for CVEs matching a keyword, product name, or vendor.",
            inputSchema={
                "type": "object",
                "properties": {
                    "keyword": {"type": "string"},
                    "severity": {
                        "type": "string",
                        "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW", ""],
                        "default": "",
                    },
                    "max_results": {"type": "integer", "default": 10},
                },
                "required": ["keyword"],
            },
        ),
        Tool(
            name="render_report",
            description="Save a completed bug report markdown string to the reports directory. Returns the file path.",
            inputSchema={
                "type": "object",
                "properties": {
                    "report_markdown": {"type": "string", "description": "Full report in markdown format"},
                    "programme": {"type": "string"},
                    "severity": {"type": "string", "enum": ["critical", "high", "medium", "low", "info"]},
                    "vuln_type": {"type": "string"},
                },
                "required": ["report_markdown", "programme", "severity", "vuln_type"],
            },
        ),
        Tool(
            name="calculate_cvss",
            description="Parse a CVSS v3.1 vector string and return a human-readable breakdown of each metric and the final score.",
            inputSchema={
                "type": "object",
                "properties": {
                    "vector": {"type": "string", "description": "CVSS v3.1 vector, e.g. CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"},
                },
                "required": ["vector"],
            },
        ),
        Tool(
            name="submit_to_webhook",
            description="Send a bug report summary to Slack or Discord via webhook. Use after a confirmed high/critical finding.",
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "severity": {"type": "string"},
                    "cvss_score": {"type": "number"},
                    "programme": {"type": "string"},
                    "report_path": {"type": "string"},
                    "summary": {"type": "string", "description": "1-2 sentence summary of the finding"},
                    "target": {"type": "string", "enum": ["slack", "discord", "both"], "default": "both"},
                },
                "required": ["title", "severity", "programme", "summary"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    if name == "lookup_cve":
        return await _lookup_cve(arguments)
    elif name == "search_cve":
        return await _search_cve(arguments)
    elif name == "render_report":
        return await _render_report(arguments)
    elif name == "calculate_cvss":
        return await _calculate_cvss(arguments)
    elif name == "submit_to_webhook":
        return await _submit_to_webhook(arguments)
    return [TextContent(type="text", text=json.dumps({"error": f"Unknown tool: {name}"}))]


async def _lookup_cve(args: dict) -> list[TextContent]:
    cve_id = args["cve_id"].upper()
    headers = {"apiKey": NVD_API_KEY} if NVD_API_KEY else {}
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://services.nvd.nist.gov/rest/json/cves/2.0",
                params={"cveId": cve_id},
                headers=headers,
                timeout=15,
            )
            data = resp.json()
            vulns = data.get("vulnerabilities", [])
            if not vulns:
                return [TextContent(type="text", text=json.dumps({"error": f"{cve_id} not found in NVD"}))]

            vuln = vulns[0]["cve"]
            descriptions = [d["value"] for d in vuln.get("descriptions", []) if d["lang"] == "en"]
            metrics = vuln.get("metrics", {})
            cvss_data = {}
            if "cvssMetricV31" in metrics:
                m = metrics["cvssMetricV31"][0]["cvssData"]
                cvss_data = {
                    "version": "3.1",
                    "score": m.get("baseScore"),
                    "severity": m.get("baseSeverity"),
                    "vector": m.get("vectorString"),
                }
            elif "cvssMetricV30" in metrics:
                m = metrics["cvssMetricV30"][0]["cvssData"]
                cvss_data = {
                    "version": "3.0",
                    "score": m.get("baseScore"),
                    "severity": m.get("baseSeverity"),
                    "vector": m.get("vectorString"),
                }

            result = {
                "cve_id": cve_id,
                "description": descriptions[0] if descriptions else "No description",
                "cvss": cvss_data,
                "published": vuln.get("published"),
                "references": [r["url"] for r in vuln.get("references", [])[:5]],
            }
        except Exception as e:
            result = {"error": str(e), "cve_id": cve_id}

    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _search_cve(args: dict) -> list[TextContent]:
    keyword = args["keyword"]
    severity = args.get("severity", "")
    max_results = args.get("max_results", 10)
    headers = {"apiKey": NVD_API_KEY} if NVD_API_KEY else {}
    params = {"keywordSearch": keyword, "resultsPerPage": max_results}
    if severity:
        params["cvssV3Severity"] = severity

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://services.nvd.nist.gov/rest/json/cves/2.0",
                params=params,
                headers=headers,
                timeout=15,
            )
            data = resp.json()
            results = []
            for item in data.get("vulnerabilities", []):
                cve = item["cve"]
                desc = next((d["value"] for d in cve.get("descriptions", []) if d["lang"] == "en"), "")
                metrics = cve.get("metrics", {})
                score = None
                if "cvssMetricV31" in metrics:
                    score = metrics["cvssMetricV31"][0]["cvssData"].get("baseScore")
                results.append({
                    "id": cve["id"],
                    "score": score,
                    "description": desc[:200],
                    "published": cve.get("published", "")[:10],
                })
        except Exception as e:
            return [TextContent(type="text", text=json.dumps({"error": str(e)}))]

    return [TextContent(type="text", text=json.dumps({"results": results, "count": len(results)}, indent=2))]


async def _render_report(args: dict) -> list[TextContent]:
    markdown = args["report_markdown"]
    programme = args["programme"]
    severity = args["severity"]
    vuln_type = args["vuln_type"]

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{programme}_{severity}_{vuln_type}_{uuid.uuid4().hex[:6]}.md"
    report_path = REPORTS_DIR / programme
    report_path.mkdir(parents=True, exist_ok=True)
    full_path = report_path / filename
    full_path.write_text(markdown)

    result = {
        "saved": True,
        "path": str(full_path),
        "filename": filename,
        "size_bytes": len(markdown.encode()),
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _calculate_cvss(args: dict) -> list[TextContent]:
    """Parse CVSS v3.1 vector and explain each component."""
    vector = args["vector"]
    # Strip prefix
    vector_clean = vector.replace("CVSS:3.1/", "").replace("CVSS:3.0/", "")
    components = dict(part.split(":") for part in vector_clean.split("/"))

    labels = {
        "AV": {"N": "Network", "A": "Adjacent", "L": "Local", "P": "Physical"},
        "AC": {"L": "Low", "H": "High"},
        "PR": {"N": "None", "L": "Low", "H": "High"},
        "UI": {"N": "None", "R": "Required"},
        "S": {"U": "Unchanged", "C": "Changed"},
        "C": {"N": "None", "L": "Low", "H": "High"},
        "I": {"N": "None", "L": "Low", "H": "High"},
        "A": {"N": "None", "L": "Low", "H": "High"},
    }
    full_names = {
        "AV": "Attack Vector", "AC": "Attack Complexity",
        "PR": "Privileges Required", "UI": "User Interaction",
        "S": "Scope", "C": "Confidentiality", "I": "Integrity", "A": "Availability",
    }

    breakdown = {}
    for key, val in components.items():
        breakdown[full_names.get(key, key)] = {
            "code": val,
            "label": labels.get(key, {}).get(val, val),
        }

    result = {
        "vector": vector,
        "breakdown": breakdown,
        "note": "Use https://www.first.org/cvss/calculator/3.1 for the exact numeric score",
    }
    return [TextContent(type="text", text=json.dumps(result, indent=2))]


async def _submit_to_webhook(args: dict) -> list[TextContent]:
    title = args["title"]
    severity = args["severity"].upper()
    cvss = args.get("cvss_score", "N/A")
    programme = args["programme"]
    summary = args["summary"]
    report_path = args.get("report_path", "N/A")
    target = args.get("target", "both")

    severity_emoji = {"CRITICAL": "🔴", "HIGH": "🟠", "MEDIUM": "🟡", "LOW": "🟢", "INFO": "⚪"}.get(severity, "⚪")

    sent = []
    errors = []

    # Slack
    if target in ("slack", "both") and SLACK_WEBHOOK:
        slack_payload = {
            "blocks": [
                {"type": "header", "text": {"type": "plain_text", "text": f"{severity_emoji} New Bug Found — {severity}"}},
                {"type": "section", "fields": [
                    {"type": "mrkdwn", "text": f"*Title:*\n{title}"},
                    {"type": "mrkdwn", "text": f"*Programme:*\n{programme}"},
                    {"type": "mrkdwn", "text": f"*CVSS Score:*\n{cvss}"},
                    {"type": "mrkdwn", "text": f"*Report:*\n`{report_path}`"},
                ]},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"*Summary:*\n{summary}"}},
            ]
        }
        async with httpx.AsyncClient() as client:
            try:
                r = await client.post(SLACK_WEBHOOK, json=slack_payload, timeout=10)
                sent.append("slack")
            except Exception as e:
                errors.append(f"slack: {e}")

    # Discord
    if target in ("discord", "both") and DISCORD_WEBHOOK:
        discord_payload = {
            "embeds": [{
                "title": f"{severity_emoji} {title}",
                "description": summary,
                "color": {"CRITICAL": 0xFF0000, "HIGH": 0xFF6600, "MEDIUM": 0xFFCC00}.get(severity, 0x00FF00),
                "fields": [
                    {"name": "Programme", "value": programme, "inline": True},
                    {"name": "Severity", "value": severity, "inline": True},
                    {"name": "CVSS", "value": str(cvss), "inline": True},
                ],
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }]
        }
        async with httpx.AsyncClient() as client:
            try:
                r = await client.post(DISCORD_WEBHOOK, json=discord_payload, timeout=10)
                sent.append("discord")
            except Exception as e:
                errors.append(f"discord: {e}")

    return [TextContent(type="text", text=json.dumps({"sent_to": sent, "errors": errors}))]


async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


# ─────────────────────────────────────────────
# HTTP bridge — lets the harness engine call tools over HTTP.
# (stdio MCP mode still available via MCP_STDIO=1)
# ─────────────────────────────────────────────
def _run_http_bridge():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    import uvicorn

    app = FastAPI(title="report-mcp http bridge")

    @app.get("/health")
    async def health():
        return {"status": "ok", "server": "report-mcp"}

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

    port = int(os.getenv("HTTP_PORT", "8003"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    if os.getenv("MCP_STDIO") == "1":
        asyncio.run(main())
    else:
        _run_http_bridge()
