"""
sandbox — isolated workspace tools for interactive pentest sessions.

Tools exposed (HTTP bridge on :8004, same pattern as the MCP servers):
  - run_shell    Execute a shell command inside the sandbox (approval-gated upstream)
  - fs_read      Read a file from the workspace
  - fs_write     Write a file into the workspace
  - fs_search    grep/glob search across the workspace
  - web_fetch    Perform an HTTP request (scope-checked when programme given)

Everything is confined to /workspace inside the container. The container is
disposable: no host mounts, no privileged mode.
"""

import asyncio
import fnmatch
import json
import os
import re
import subprocess
from pathlib import Path

WORKSPACE = Path(os.getenv("WORKSPACE", "/workspace"))
WORKSPACE.mkdir(parents=True, exist_ok=True)
MAX_OUTPUT = 20000


# ─────────────────────────────────────────────
# Scope checking (same semantics as recon/exploit servers)
# ─────────────────────────────────────────────
def load_scope(programme: str) -> dict:
    targets_dir = Path(os.getenv("TARGETS_DIR", "/app/targets"))
    config_path = targets_dir / "programs" / f"{programme}.yaml"
    if not config_path.exists():
        return {"in_scope": [], "out_of_scope": []}
    import yaml
    with open(config_path) as f:
        return yaml.safe_load(f) or {}


def _compile_pattern(pattern: str) -> re.Pattern:
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error:
        return re.compile(re.escape(pattern).replace(r"\*", ".*"), re.IGNORECASE)


def is_in_scope(target: str, programme: str) -> tuple[bool, str]:
    if not programme:
        return True, "No programme bound (operator responsibility)"
    scope = load_scope(programme)
    for pattern in scope.get("out_of_scope", []):
        if _compile_pattern(pattern).search(target):
            return False, f"Out of scope: matches {pattern}"
    if not scope.get("in_scope"):
        return True, "No restrictions configured"
    for pattern in scope.get("in_scope", []):
        if _compile_pattern(pattern).search(target):
            return True, "In scope"
    return False, "Not in any in-scope pattern"


def _safe_path(rel: str) -> Path:
    """Resolve a workspace-relative path, refusing escapes."""
    p = (WORKSPACE / rel.lstrip("/")).resolve()
    if not str(p).startswith(str(WORKSPACE.resolve())):
        raise ValueError(f"Path escapes workspace: {rel}")
    return p


# ─────────────────────────────────────────────
# Tool implementations
# ─────────────────────────────────────────────
async def _run_shell(args: dict) -> dict:
    command = args.get("command", "")
    timeout = min(int(args.get("timeout", 120)), 600)
    if not command:
        return {"error": "command is required"}
    try:
        proc = await asyncio.create_subprocess_shell(
            command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(WORKSPACE),
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return {
            "tool": "shell",
            "command": command,
            "exit_code": proc.returncode,
            "stdout": stdout.decode(errors="replace")[-MAX_OUTPUT:],
            "stderr": stderr.decode(errors="replace")[-4000:],
        }
    except asyncio.TimeoutError:
        return {"tool": "shell", "command": command, "error": f"timeout after {timeout}s"}
    except Exception as e:
        return {"tool": "shell", "command": command, "error": str(e)}


async def _fs_read(args: dict) -> dict:
    try:
        p = _safe_path(args.get("path", ""))
        if not p.exists():
            return {"error": f"not found: {args.get('path')}"}
        if p.stat().st_size > 1_000_000:
            return {"error": "file too large (>1MB); use fs_search to narrow"}
        return {"tool": "fs_read", "path": str(p.relative_to(WORKSPACE)), "content": p.read_text(errors="replace")}
    except ValueError as e:
        return {"error": str(e)}


async def _fs_write(args: dict) -> dict:
    try:
        p = _safe_path(args.get("path", ""))
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(args.get("content", ""))
        return {"tool": "fs_write", "path": str(p.relative_to(WORKSPACE)), "bytes": p.stat().st_size}
    except ValueError as e:
        return {"error": str(e)}


async def _fs_search(args: dict) -> dict:
    pattern = args.get("pattern", "")
    grep = args.get("grep", "")
    results = []
    try:
        if pattern:
            for p in WORKSPACE.rglob("*"):
                if p.is_file() and fnmatch.fnmatch(p.name, pattern):
                    results.append(str(p.relative_to(WORKSPACE)))
                if len(results) >= 200:
                    break
        elif grep:
            proc = subprocess.run(
                ["grep", "-rn", "--max-count=3", "-I", grep, "."],
                capture_output=True, text=True, cwd=str(WORKSPACE), timeout=60,
            )
            results = proc.stdout.splitlines()[:200]
        else:
            return {"error": "provide pattern (glob) or grep (text)"}
        return {"tool": "fs_search", "matches": results, "count": len(results)}
    except subprocess.TimeoutExpired:
        return {"error": "search timed out"}


async def _web_fetch(args: dict) -> dict:
    import httpx

    url = args.get("url", "")
    programme = args.get("programme", "")
    if not url:
        return {"error": "url is required"}

    host = re.sub(r"^https?://", "", url).split("/")[0]
    in_scope, reason = is_in_scope(host, programme)
    if not in_scope:
        return {"error": reason}

    method = args.get("method", "GET").upper()
    headers = args.get("headers", {}) or {}
    body = args.get("body")
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30, verify=False) as client:
            res = await client.request(method, url, headers=headers, content=body)
        return {
            "tool": "web_fetch",
            "url": str(res.url),
            "status": res.status_code,
            "headers": dict(list(res.headers.items())[:30]),
            "body": res.text[:MAX_OUTPUT],
        }
    except Exception as e:
        return {"tool": "web_fetch", "url": url, "error": str(e)}


TOOLS = [
    {
        "name": "run_shell",
        "description": "Execute a shell command inside the isolated sandbox workspace. Returns stdout/stderr/exit_code. DANGEROUS — requires operator approval.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout": {"type": "integer", "default": 120},
            },
            "required": ["command"],
        },
    },
    {
        "name": "fs_read",
        "description": "Read a file from the sandbox workspace (relative path).",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "fs_write",
        "description": "Write a file into the sandbox workspace (relative path). Use for notes, PoC scripts, reports.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "fs_search",
        "description": "Search the workspace by file-name glob (pattern) or text content (grep).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "grep": {"type": "string"},
            },
        },
    },
    {
        "name": "web_fetch",
        "description": "Perform an HTTP request and return status/headers/body. Scope-checked against the programme when provided.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "method": {"type": "string", "default": "GET"},
                "headers": {"type": "object"},
                "body": {"type": "string"},
                "programme": {"type": "string"},
            },
            "required": ["url"],
        },
    },
]

HANDLERS = {
    "run_shell": _run_shell,
    "fs_read": _fs_read,
    "fs_write": _fs_write,
    "fs_search": _fs_search,
    "web_fetch": _web_fetch,
}


# ─────────────────────────────────────────────
# HTTP bridge
# ─────────────────────────────────────────────
def _run_http_bridge():
    from fastapi import FastAPI
    from fastapi.responses import JSONResponse
    import uvicorn

    app = FastAPI(title="sandbox http bridge")

    @app.get("/health")
    async def health():
        return {"status": "ok", "server": "sandbox"}

    @app.get("/tools")
    async def tools():
        return TOOLS

    @app.post("/call")
    async def call(payload: dict):
        name = payload.get("name", "")
        arguments = payload.get("arguments", {}) or {}
        handler = HANDLERS.get(name)
        if not handler:
            return JSONResponse(status_code=404, content={"error": f"Unknown tool: {name}"})
        try:
            def _exec():
                return asyncio.run(handler(arguments))
            result = await asyncio.to_thread(_exec)
            return {"ok": True, "result": json.dumps(result)}
        except Exception as e:
            return JSONResponse(status_code=500, content={"error": str(e)})

    port = int(os.getenv("HTTP_PORT", "8004"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    _run_http_bridge()
