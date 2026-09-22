"""
Learning Engine — Outcome Store Interface

Reads and writes to the Postgres outcome_log table.
Used by the Meta-Agent to pull win/loss data for weekly strategy updates.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import psycopg2
import psycopg2.extras

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://bugbot:changeme_in_prod@localhost:5433/bughunting"
)


def _get_conn():
    """Get a database connection. Callers must close it (use as context manager)."""
    return psycopg2.connect(DATABASE_URL, connect_timeout=10)


def log_outcome(
    report_id: str,
    event_type: str,           # accepted, rejected, informative, duplicate
    context: dict,
    meta_notes: Optional[str] = None,
) -> str:
    """Log a report outcome for the learning engine to consume."""
    outcome_id = str(uuid.uuid4())
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO outcome_log (id, report_id, event_type, context, meta_notes)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (outcome_id, report_id, event_type, json.dumps(context), meta_notes),
            )
    return outcome_id


def get_outcomes_since(days: int = 7) -> list[dict]:
    """Pull all outcomes from the last N days for meta-agent analysis."""
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT ol.*, br.title, br.severity, br.cvss_score,
                       br.report_markdown, ea.agent_type, ea.payload,
                       ea.response_snippet, f.type as finding_type,
                       f.target, f.metadata as finding_metadata,
                       p.name as programme_name
                FROM outcome_log ol
                JOIN bug_reports br ON ol.report_id = br.id
                JOIN exploit_attempts ea ON br.exploit_id = ea.id
                JOIN findings f ON ea.finding_id = f.id
                JOIN programmes p ON br.programme_id = p.id
                WHERE ol.logged_at >= NOW() - INTERVAL '%s days'
                ORDER BY ol.logged_at DESC
                """,
                (days,),
            )
            return [dict(row) for row in cur.fetchall()]


def get_success_rates_by_vuln_type() -> list[dict]:
    """Compute success rate per vuln type — used for exploit priority ranking."""
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    ea.agent_type,
                    COUNT(*) as total_attempts,
                    SUM(CASE WHEN ea.success THEN 1 ELSE 0 END) as successes,
                    AVG(ea.confidence) as avg_confidence,
                    ROUND(
                        100.0 * SUM(CASE WHEN ea.success THEN 1 ELSE 0 END) / COUNT(*),
                        2
                    ) as success_rate_pct
                FROM exploit_attempts ea
                GROUP BY ea.agent_type
                ORDER BY success_rate_pct DESC
                """
            )
            return [dict(row) for row in cur.fetchall()]


def get_report_acceptance_rate() -> dict:
    """Overall report acceptance rate — key health metric."""
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT
                    COUNT(*) as total_reports,
                    SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) as accepted,
                    SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
                    SUM(CASE WHEN status = 'informative' THEN 1 ELSE 0 END) as informative,
                    SUM(CASE WHEN status = 'duplicate' THEN 1 ELSE 0 END) as duplicate,
                    SUM(bounty_amount) as total_bounty
                FROM bug_reports
                WHERE submitted_at IS NOT NULL
                """
            )
            return dict(cur.fetchone())


def save_strategy_version(config: dict, reasoning: str) -> int:
    """Persist a new strategy config version written by the meta-agent."""
    with _get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(version) FROM strategy_versions")
            row = cur.fetchone()
            next_version = (row[0] or 0) + 1
            cur.execute(
                """
                INSERT INTO strategy_versions (version, config, meta_reasoning)
                VALUES (%s, %s, %s)
                """,
                (next_version, json.dumps(config), reasoning),
            )
    return next_version


def get_latest_strategy() -> dict:
    """Retrieve the current strategy config."""
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT config, meta_reasoning, version FROM strategy_versions ORDER BY version DESC LIMIT 1"
            )
            row = cur.fetchone()
            if row:
                return {"version": row["version"], "config": row["config"], "reasoning": row["meta_reasoning"]}
            return {"version": 0, "config": {}, "reasoning": "No strategy found"}
