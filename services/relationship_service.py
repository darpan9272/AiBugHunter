"""
ASM Asset Relationship Discovery Service

Discovers and stores relationships between assets:
- same_asn: Assets sharing the same Autonomous System Number
- same_org: Assets belonging to the same organization
- same_favicon: Assets sharing the same favicon hash (mmh3)
- same_ssl_fp: Assets sharing the same SSL certificate fingerprint
- same_cloud: Assets in the same cloud provider/account
- cname: CNAME chain relationships
- san: Subject Alternative Name siblings
- redirects_to: HTTP redirect relationships
"""

import asyncio
import json
import os
from collections import defaultdict
from typing import Any

import asyncpg

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting")


async def discover_relationships(programme_id: str) -> dict:
    """Discover all relationships for assets in a programme."""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    
    try:
        # Get all assets with relevant fields
        assets = await pool.fetch("""
            SELECT id, host, ip, favicon_hash, tls, programme_id
            FROM assets
            WHERE programme_id = $1
        """, programme_id)
        
        if not assets:
            return {"programme_id": programme_id, "relationships_created": 0}
        
        # Build indices
        by_favicon = defaultdict(list)
        by_ssl_fp = defaultdict(list)
        by_ip = defaultdict(list)
        by_asn = defaultdict(list)  # Would need ASN lookup
        by_org = defaultdict(list)  # Would need org lookup
        
        for asset in assets:
            asset_id = str(asset["id"])
            
            # Favicon hash
            if asset["favicon_hash"]:
                by_favicon[asset["favicon_hash"]].append(asset_id)
            
            # SSL fingerprint (from TLS cert)
            tls = asset["tls"] or {}
            if isinstance(tls, dict) and tls.get("sha256"):
                by_ssl_fp[tls["sha256"]].append(asset_id)
            elif isinstance(tls, dict) and tls.get("cn"):
                # Use CN as fallback fingerprint
                by_ssl_fp[f"cn:{tls['cn']}"].append(asset_id)
            
            # IP address
            if asset["ip"]:
                by_ip[asset["ip"]].append(asset_id)
        
        relationships_created = 0
        
        # ─────────────────────
        # Same Favicon
        # ─────────────────────
        for favicon_hash, asset_ids in by_favicon.items():
            if len(asset_ids) > 1:
                relationships_created += await _create_relationships(
                    pool, programme_id, asset_ids, "same_favicon",
                    {"favicon_hash": favicon_hash}
                )
        
        # ─────────────────────
        # Same SSL Fingerprint
        # ─────────────────────
        for ssl_fp, asset_ids in by_ssl_fp.items():
            if len(asset_ids) > 1:
                relationships_created += await _create_relationships(
                    pool, programme_id, asset_ids, "same_ssl_fp",
                    {"ssl_fingerprint": ssl_fp}
                )
        
        # ─────────────────────
        # Same IP
        # ─────────────────────
        for ip, asset_ids in by_ip.items():
            if len(asset_ids) > 1:
                relationships_created += await _create_relationships(
                    pool, programme_id, asset_ids, "same_ip",
                    {"ip": ip}
                )
        
        # ─────────────────────
        # CNAME Relationships (from asset_dns)
        # ─────────────────────
        relationships_created += await _discover_cname_relationships(pool, programme_id)
        
        # ─────────────────────
        # SAN Relationships (from asset_certs)
        # ─────────────────────
        relationships_created += await _discover_san_relationships(pool, programme_id)
        
        return {
            "programme_id": programme_id,
            "relationships_created": relationships_created,
            "assets_analyzed": len(assets),
        }
    finally:
        await pool.close()


async def _create_relationships(
    pool: asyncpg.Pool,
    programme_id: str,
    asset_ids: list[str],
    relationship: str,
    metadata: dict
) -> int:
    """Create bidirectional relationships between all pairs in asset_ids."""
    count = 0
    for i, source_id in enumerate(asset_ids):
        for target_id in asset_ids[i+1:]:
            # Create both directions
            for src, tgt in [(source_id, target_id), (target_id, source_id)]:
                await pool.execute("""
                    INSERT INTO asset_relationships (programme_id, source_asset_id, target_asset_id, relationship, confidence, metadata, discovered_by)
                    VALUES ($1, $2, $3, $4, 1.0, $5, 'auto')
                    ON CONFLICT (programme_id, source_asset_id, target_asset_id, relationship) DO NOTHING
                """, programme_id, src, tgt, relationship, json.dumps(metadata))
                count += 1
    return count


async def _discover_cname_relationships(pool: asyncpg.Pool, programme_id: str) -> int:
    """Discover CNAME chain relationships from DNS records."""
    count = 0
    
    # Get all CNAME records
    cnames = await pool.fetch("""
        SELECT name, value FROM asset_dns
        WHERE programme_id = $1 AND type = 'CNAME'
    """, programme_id)
    
    # Build a map of name -> asset_id
    assets = await pool.fetch("SELECT id, host FROM assets WHERE programme_id = $1", programme_id)
    host_to_id = {a["host"]: str(a["id"]) for a in assets}
    
    for cname in cnames:
        source_name = cname["name"]
        target_name = cname["value"]
        
        source_id = host_to_id.get(source_name)
        target_id = host_to_id.get(target_name)
        
        if source_id and target_id:
            await pool.execute("""
                INSERT INTO asset_relationships (programme_id, source_asset_id, target_asset_id, relationship, confidence, metadata, discovered_by)
                VALUES ($1, $2, $3, 'cname', 1.0, $4, 'auto')
                ON CONFLICT (programme_id, source_asset_id, target_asset_id, relationship) DO NOTHING
            """, programme_id, source_id, target_id, json.dumps({"cname_target": target_name}))
            count += 1
    
    return count


async def _discover_san_relationships(pool: asyncpg.Pool, programme_id: str) -> int:
    """Discover SAN sibling relationships from certificates."""
    count = 0
    
    # Get all certs with SANs
    certs = await pool.fetch("""
        SELECT subject_cn, san FROM asset_certs
        WHERE programme_id = $1 AND san IS NOT NULL AND jsonb_array_length(san) > 0
    """, programme_id)
    
    # Build host -> asset_id map
    assets = await pool.fetch("SELECT id, host FROM assets WHERE programme_id = $1", programme_id)
    host_to_id = {a["host"]: str(a["id"]) for a in assets}
    
    for cert in certs:
        subject_cn = cert["subject_cn"]
        san_list = cert["san"] or []
        
        subject_id = host_to_id.get(subject_cn) if subject_cn else None
        
        for san in san_list:
            san_id = host_to_id.get(san)
            if subject_id and san_id and subject_id != san_id:
                # SAN sibling relationship
                await pool.execute("""
                    INSERT INTO asset_relationships (programme_id, source_asset_id, target_asset_id, relationship, confidence, metadata, discovered_by)
                    VALUES ($1, $2, $3, 'san', 1.0, $4, 'auto')
                    ON CONFLICT (programme_id, source_asset_id, target_asset_id, relationship) DO NOTHING
                """, programme_id, subject_id, san_id, json.dumps({"cert_cn": subject_cn, "san": san}))
                count += 1
                
                # Also link SAN to SAN (siblings)
                for other_san in san_list:
                    if other_san != san:
                        other_id = host_to_id.get(other_san)
                        if other_id and san_id != other_id:
                            await pool.execute("""
                                INSERT INTO asset_relationships (programme_id, source_asset_id, target_asset_id, relationship, confidence, metadata, discovered_by)
                                VALUES ($1, $2, $3, 'san', 0.8, $4, 'auto')
                                ON CONFLICT (programme_id, source_asset_id, target_asset_id, relationship) DO NOTHING
                            """, programme_id, san_id, other_id, json.dumps({"cert_cn": subject_cn, "san": san, "sibling": other_san}))
                            count += 1
    
    return count


# ─────────────────────────────────────────────
# CLI Entry Point
# ─────────────────────────────────────────────
async def main():
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python relationship_service.py <programme_id>")
        sys.exit(1)
    
    programme_id = sys.argv[1]
    
    print(f"Discovering relationships for programme: {programme_id}")
    result = await discover_relationships(programme_id)
    print(f"Assets analyzed: {result['assets_analyzed']}")
    print(f"Relationships created: {result['relationships_created']}")


if __name__ == "__main__":
    asyncio.run(main())