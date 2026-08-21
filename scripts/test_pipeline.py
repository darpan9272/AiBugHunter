#!/usr/bin/env python3
"""
Quick test harness — verifies the full pipeline is wired up correctly.
Run this after `docker-compose up -d` to confirm everything is healthy.

Usage:
  python scripts/test_pipeline.py
"""

import json
import os
import sys
import time

import httpx
import psycopg2

POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting")
CHROMA_URL = os.getenv("CHROMA_URL", "http://localhost:8000")
RECON_MCP_URL = os.getenv("RECON_MCP_URL", "http://localhost:8001")
EXPLOIT_MCP_URL = os.getenv("EXPLOIT_MCP_URL", "http://localhost:8002")
REPORT_MCP_URL = os.getenv("REPORT_MCP_URL", "http://localhost:8003")

OK = "\033[92m✅\033[0m"
FAIL = "\033[91m❌\033[0m"
WARN = "\033[93m⚠️\033[0m"


def check(name: str, fn) -> bool:
    try:
        fn()
        print(f"  {OK} {name}")
        return True
    except Exception as e:
        print(f"  {FAIL} {name}: {e}")
        return False


def main():
    print("\n🔍 Bug Hunting Pipeline — Health Check\n")
    results = []

    # 1. Postgres
    print("[ Database ]")
    def test_postgres():
        conn = psycopg2.connect(POSTGRES_URL, connect_timeout=5)
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM programmes")
            cur.fetchone()
        conn.close()
    results.append(check("PostgreSQL connection", test_postgres))

    def test_schema():
        conn = psycopg2.connect(POSTGRES_URL)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public'
            """)
            tables = {row[0] for row in cur.fetchall()}
            required = {"programmes", "findings", "exploit_attempts", "bug_reports", "outcome_log", "strategy_versions"}
            missing = required - tables
            if missing:
                raise Exception(f"Missing tables: {missing}")
        conn.close()
    results.append(check("Schema tables present", test_schema))

    # 2. Chroma
    print("\n[ Vector Store ]")
    def test_chroma():
        import chromadb
        from chromadb.config import Settings
        
        token = os.getenv("CHROMA_AUTH_TOKEN", "changeme_chroma")
        
        # Determine host and port
        host = CHROMA_URL.split("://")[-1].split(":")[0]
        port = CHROMA_URL.split(":")[-1] if ":" in CHROMA_URL.split("://")[-1] else 8000
        
        client = chromadb.HttpClient(
            host=host,
            port=port,
            headers={"X-Chroma-Token": token}
        )
        client.heartbeat()
    results.append(check("Chroma connection", test_chroma))

    def test_chroma_collections():
        import chromadb
        from chromadb.config import Settings
        
        token = os.getenv("CHROMA_AUTH_TOKEN", "changeme_chroma")
        host = CHROMA_URL.split("://")[-1].split(":")[0]
        port = CHROMA_URL.split(":")[-1] if ":" in CHROMA_URL.split("://")[-1] else 8000
        
        client = chromadb.HttpClient(
            host=host,
            port=port,
            headers={"X-Chroma-Token": token}
        )
        client.list_collections()
    results.append(check("Chroma API responsive", test_chroma_collections))

    # MCP Servers (stdio based, verify containers are running instead of HTTP get)
    print("\n[ MCP Servers ]")
    import subprocess
    for name in ["bughunting_recon_mcp", "bughunting_exploit_mcp", "bughunting_report_mcp"]:
        def make_check(container_name):
            def fn():
                result = subprocess.run(["docker", "inspect", "-f", "{{.State.Running}}", container_name], capture_output=True, text=True)
                if result.stdout.strip() != "true":
                    raise Exception(f"Container {container_name} is not running")
            return fn
        results.append(check(f"{name} running", make_check(name)))

    # 4. Scope check test
    print("\n[ Scope Enforcement ]")
    def test_scope_config():
        import yaml
        from pathlib import Path
        config_file = Path("targets/programs/example_program.yaml")
        if not config_file.exists():
            raise Exception("example_program.yaml not found")
        with open(config_file) as f:
            cfg = yaml.safe_load(f)
        assert "in_scope" in cfg, "No in_scope defined"
        assert "out_of_scope" in cfg, "No out_of_scope defined"
    results.append(check("Programme config readable", test_scope_config))

    # Summary
    passed = sum(results)
    total = len(results)
    print(f"\n{'='*40}")
    print(f"Results: {passed}/{total} checks passed")
    if passed == total:
        print(f"{OK} All systems operational. Pipeline ready.\n")
        sys.exit(0)
    else:
        print(f"{FAIL} {total - passed} check(s) failed. Fix before running agents.\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
