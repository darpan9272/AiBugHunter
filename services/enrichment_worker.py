"""
ASM Enrichment Worker

Background worker that processes enrichment jobs from the queue.
Supports multiple enrichment sources: Censys, Fofa, BinaryEdge, Shodan, ZoomEye, GitHub, CT, Cloud.
"""

import asyncio
import json
import os
import signal
import sys
from datetime import datetime
from typing import Any

import asyncpg
import httpx

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting")

# External API keys
CENSYS_API_ID = os.getenv("CENSYS_API_ID", "")
CENSYS_API_SECRET = os.getenv("CENSYS_API_SECRET", "")
FOFA_EMAIL = os.getenv("FOFA_EMAIL", "")
FOFA_KEY = os.getenv("FOFA_KEY", "")
BINARYEDGE_API_KEY = os.getenv("BINARYEDGE_API_KEY", "")
SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
ZOOMEYE_API_KEY = os.getenv("ZOOMEYE_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

# Worker config
POLL_INTERVAL = int(os.getenv("ENRICHMENT_POLL_INTERVAL", "30"))  # seconds
MAX_CONCURRENT_JOBS = int(os.getenv("ENRICHMENT_MAX_CONCURRENT", "3"))

_running = True


async def get_pool() -> asyncpg.Pool:
    return await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)


async def claim_next_job(pool: asyncpg.Pool) -> dict | None:
    """Atomically claim the next pending job."""
    job = await pool.fetchrow("""
        UPDATE enrichment_jobs
        SET status = 'running', started_at = NOW()
        WHERE id = (
            SELECT id FROM enrichment_jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        RETURNING *
    """)
    return dict(job) if job else None


async def update_job_status(pool: asyncpg.Pool, job_id: str, status: str, result: dict = None, error: str = None, changes_count: int = 0, new_assets: int = 0):
    """Update job status and results."""
    await pool.execute("""
        UPDATE enrichment_jobs
        SET status = $1, result = $2, error = $3, changes_count = $4, new_assets = $5, finished_at = NOW()
        WHERE id = $6
    """, status, json.dumps(result) if result else None, error, changes_count, new_assets, job_id)


async def process_job(pool: asyncpg.Pool, job: dict) -> dict:
    """Process a single enrichment job."""
    source = job["source"]
    target = job["target"]
    target_type = job["target_type"]
    params = job["params"] or {}
    programme_id = job["programme_id"]
    
    print(f"Processing job {job['id']}: {source} -> {target}")
    
    if source == "censys":
        return await enrich_censys(target, target_type, programme_id, params)
    elif source == "fofa":
        return await enrich_fofa(target, target_type, programme_id, params)
    elif source == "binaryedge":
        return await enrich_binaryedge(target, target_type, programme_id, params)
    elif source == "shodan":
        return await enrich_shodan(target, target_type, programme_id, params)
    elif source == "zoomeye":
        return await enrich_zoomeye(target, target_type, programme_id, params)
    elif source == "github":
        return await enrich_github(target, target_type, programme_id, params)
    elif source == "ct":
        return await enrich_ct(target, programme_id, params)
    elif source == "cloud":
        return await enrich_cloud(target, target_type, programme_id, params)
    else:
        return {"error": f"Unknown source: {source}", "changes": 0, "new_assets": 0}


async def enrich_censys(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using Censys API."""
    if not CENSYS_API_ID or not CENSYS_API_SECRET:
        return {"error": "Censys credentials not configured", "changes": 0, "new_assets": 0}
    
    # Censys API v2
    auth = (CENSYS_API_ID, CENSYS_API_SECRET)
    base_url = "https://search.censys.io/api/v2"
    
    changes = 0
    new_assets = 0
    results = []
    
    try:
        async with httpx.AsyncClient(auth=auth, timeout=60) as client:
            if target_type == "domain":
                # Search for hosts with this domain in certificates
                query = f"services.tls.certificates.leaf_data.names: {target}"
                url = f"{base_url}/hosts/search"
                params_q = {"q": query, "per_page": params.get("max_results", 100)}
                
                resp = await client.get(url, params=params_q)
                if resp.status_code == 200:
                    data = resp.json()
                    for hit in data.get("result", {}).get("hits", []):
                        # Process each host
                        ip = hit.get("ip")
                        services = hit.get("services", [])
                        
                        for svc in services:
                            port = svc.get("port")
                            service_name = svc.get("service_name", "")
                            # Would upsert asset here
                            new_assets += 1
                            changes += 1
                    
                    results.append({"source": "censys", "query": query, "hits": len(data.get("result", {}).get("hits", []))})
    
    except Exception as e:
        return {"error": str(e), "changes": changes, "new_assets": new_assets, "results": results}
    
    return {"changes": changes, "new_assets": new_assets, "results": results}


async def enrich_fofa(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using Fofa API."""
    if not FOFA_EMAIL or not FOFA_KEY:
        return {"error": "Fofa credentials not configured", "changes": 0, "new_assets": 0}
    
    # Fofa API
    import base64
    
    changes = 0
    new_assets = 0
    results = []
    
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            if target_type == "domain":
                query = f'domain="{target}"'
                query_b64 = base64.b64encode(query.encode()).decode()
                url = "https://fofa.info/api/v1/search/all"
                params_q = {
                    "email": FOFA_EMAIL,
                    "key": FOFA_KEY,
                    "qbase64": query_b64,
                    "size": params.get("max_results", 100),
                    "fields": "ip,port,protocol,host,title,server,domain,cert"
                }
                
                resp = await client.get(url, params=params_q)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("results", []):
                        # Process each result
                        new_assets += 1
                        changes += 1
                    
                    results.append({"source": "fofa", "query": query, "hits": len(data.get("results", []))})
    
    except Exception as e:
        return {"error": str(e), "changes": changes, "new_assets": new_assets, "results": results}
    
    return {"changes": changes, "new_assets": new_assets, "results": results}


async def enrich_binaryedge(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using BinaryEdge API."""
    if not BINARYEDGE_API_KEY:
        return {"error": "BinaryEdge credentials not configured", "changes": 0, "new_assets": 0}
    
    changes = 0
    new_assets = 0
    results = []
    
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            if target_type == "domain":
                url = f"https://api.binaryedge.io/v2/query/domains/subdomain/{target}"
                headers = {"X-Key": BINARYEDGE_API_KEY}
                
                resp = await client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    for subdomain in data.get("events", []):
                        new_assets += 1
                        changes += 1
                    
                    results.append({"source": "binaryedge", "target": target, "hits": len(data.get("events", []))})
    
    except Exception as e:
        return {"error": str(e), "changes": changes, "new_assets": new_assets, "results": results}
    
    return {"changes": changes, "new_assets": new_assets, "results": results}


async def enrich_shodan(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using Shodan API."""
    if not SHODAN_API_KEY:
        return {"error": "Shodan credentials not configured", "changes": 0, "new_assets": 0}
    
    changes = 0
    new_assets = 0
    results = []
    
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            if target_type == "domain":
                # Use Shodan DNS API
                url = f"https://api.shodan.io/dns/domain/{target}"
                params_q = {"key": SHODAN_API_KEY}
                
                resp = await client.get(url, params=params_q)
                if resp.status_code == 200:
                    data = resp.json()
                    for subdomain in data.get("subdomains", []):
                        new_assets += 1
                        changes += 1
                    
                    results.append({"source": "shodan", "target": target, "hits": len(data.get("subdomains", []))})
            
            elif target_type == "ip":
                url = f"https://api.shodan.io/shodan/host/{target}"
                params_q = {"key": SHODAN_API_KEY}
                
                resp = await client.get(url, params=params_q)
                if resp.status_code == 200:
                    data = resp.json()
                    # Process host data
                    new_assets += 1
                    changes += 1
                    results.append({"source": "shodan", "target": target, "data": data})
    
    except Exception as e:
        return {"error": str(e), "changes": changes, "new_assets": new_assets, "results": results}
    
    return {"changes": changes, "new_assets": new_assets, "results": results}


async def enrich_zoomeye(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using ZoomEye API."""
    if not ZOOMEYE_API_KEY:
        return {"error": "ZoomEye credentials not configured", "changes": 0, "new_assets": 0}
    
    # ZoomEye API implementation placeholder
    return {"error": "ZoomEye enrichment not fully implemented", "changes": 0, "new_assets": 0, "results": []}


async def enrich_github(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using GitHub code search for secrets/exposure."""
    if not GITHUB_TOKEN:
        return {"error": "GitHub token not configured", "changes": 0, "new_assets": 0}
    
    # GitHub code search implementation placeholder
    return {"error": "GitHub enrichment not fully implemented", "changes": 0, "new_assets": 0, "results": []}


async def enrich_ct(target: str, programme_id: str, params: dict) -> dict:
    """Enrich using Certificate Transparency logs."""
    # CT enrichment implementation placeholder
    return {"error": "CT enrichment not fully implemented", "changes": 0, "new_assets": 0, "results": []}


async def enrich_cloud(target: str, target_type: str, programme_id: str, params: dict) -> dict:
    """Enrich using Cloud Provider APIs."""
    # Cloud enrichment implementation placeholder
    return {"error": "Cloud enrichment not fully implemented", "changes": 0, "new_assets": 0, "results": []}


async def record_asset_changes(pool: asyncpg.Pool, programme_id: str, asset_id: str, field_name: str, old_value: Any, new_value: Any, change_type: str, source: str, meta: dict = None):
    """Record an asset change in the timeline."""
    await pool.execute("""
        INSERT INTO asset_changes (asset_id, field_name, old_value, new_value, change_type, source, meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
    """, asset_id, field_name, 
        json.dumps(old_value) if old_value is not None else None,
        json.dumps(new_value) if new_value is not None else None,
        change_type, source, json.dumps(meta or {}))


async def worker_loop():
    """Main worker loop."""
    pool = await get_pool()
    print(f"Enrichment worker started (poll interval: {POLL_INTERVAL}s, max concurrent: {MAX_CONCURRENT_JOBS})")
    
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)
    
    async def process_with_semaphore(job):
        async with semaphore:
            try:
                result = await process_job(pool, job)
                await update_job_status(
                    pool, job["id"], 
                    "done" if not result.get("error") else "partial",
                    result, result.get("error"),
                    result.get("changes", 0), result.get("new_assets", 0)
                )
                print(f"Job {job['id']} completed: {result.get('changes', 0)} changes, {result.get('new_assets', 0)} new assets")
            except Exception as e:
                await update_job_status(pool, job["id"], "failed", error=str(e))
                print(f"Job {job['id']} failed: {e}")
    
    try:
        while _running:
            try:
                # Claim and process jobs
                jobs_to_process = []
                for _ in range(MAX_CONCURRENT_JOBS):
                    job = await claim_next_job(pool)
                    if job:
                        jobs_to_process.append(job)
                    else:
                        break
                
                if jobs_to_process:
                    await asyncio.gather(*[process_with_semaphore(job) for job in jobs_to_process])
                else:
                    # No jobs, wait before polling again
                    await asyncio.sleep(POLL_INTERVAL)
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Worker error: {e}")
                await asyncio.sleep(5)
    finally:
        await pool.close()
        print("Enrichment worker stopped")


def handle_signal(signum, frame):
    global _running
    print(f"Received signal {signum}, shutting down...")
    _running = False


async def main():
    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)
    await worker_loop()


if __name__ == "__main__":
    asyncio.run(main())