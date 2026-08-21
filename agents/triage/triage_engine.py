"""
Triage Scoring Engine

Three-pass scoring pipeline for every recon finding:

Pass 1 — Static Score (fast, rule-based)
  Based on endpoint type, parameter count, HTTP method, auth level, tech stack.

Pass 2 — Embedding Score (vector similarity to confirmed vulns)
  How similar is this finding to past confirmed vulnerabilities in the DB?

Pass 3 — LLM Score (Claude Sonnet reasons about the full context)
  Asked to rate exploitability and novelty given the full HTTP context.

Final score = weighted average of all three (weights from strategy_config.json).
"""

import json
import os
import re
from dataclasses import dataclass
from typing import Optional

import anthropic

from vector_store import VectorStore, VulnContext

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
STRATEGY_CONFIG_PATH = os.getenv("STRATEGY_CONFIG_PATH", "./strategy_config.json")

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
vector_store = VectorStore()


def _load_weights() -> dict:
    """Load triage weights from strategy config (updated by Meta-Agent weekly)."""
    try:
        with open(STRATEGY_CONFIG_PATH) as f:
            cfg = json.load(f)
            return cfg.get("triage_weights", {"static": 0.3, "embedding": 0.4, "llm": 0.3})
    except FileNotFoundError:
        return {"static": 0.3, "embedding": 0.4, "llm": 0.3}


def _load_min_score() -> float:
    try:
        with open(STRATEGY_CONFIG_PATH) as f:
            return json.load(f).get("min_triage_score", 0.3)
    except FileNotFoundError:
        return 0.3


def _load_fp_threshold() -> float:
    try:
        with open(STRATEGY_CONFIG_PATH) as f:
            return json.load(f).get("fp_suppression_threshold", 0.85)
    except FileNotFoundError:
        return 0.85


@dataclass
class TriageResult:
    finding_id: str
    url: str
    static_score: float
    embedding_score: float
    llm_score: float
    final_score: float
    passed: bool           # True if above min_triage_score
    fp_suppressed: bool    # True if too similar to known FPs
    reason: str            # Human-readable explanation


# ─────────────────────────────────────────────
# Pass 1: Static Scoring
# ─────────────────────────────────────────────
_HIGH_VALUE_PATTERNS = [
    (r"/api/", 0.3, "API endpoint"),
    (r"/admin", 0.35, "Admin panel"),
    (r"/user|/account|/profile", 0.25, "User data endpoint"),
    (r"/upload|/file|/import", 0.3, "File handling endpoint"),
    (r"/redirect|/url|/next|/return", 0.25, "Redirect parameter"),
    (r"/search|/query|/find", 0.2, "Search endpoint"),
    (r"/login|/auth|/oauth|/sso", 0.3, "Auth endpoint"),
    (r"/graphql|/gql", 0.3, "GraphQL endpoint"),
    (r"/v[0-9]+/", 0.15, "Versioned API"),
    (r"\.(php|asp|aspx|jsp)$", 0.2, "Dynamic server-side page"),
]

_INTERESTING_PARAMS = [
    (r"(url|redirect|next|return|goto|dest|target|link)", 0.3, "Redirect param"),
    (r"(id|uid|user_id|account|ref)", 0.25, "IDOR candidate param"),
    (r"(file|path|dir|include|template|view)", 0.3, "File path param"),
    (r"(cmd|exec|command|run|shell|ping)", 0.4, "Command injection param"),
    (r"(sql|query|search|q|keyword)", 0.2, "SQLi candidate param"),
    (r"(callback|jsonp|origin)", 0.2, "CORS/JSONP param"),
    (r"(token|key|secret|api_key|auth)", 0.2, "Auth token param"),
]

_TECH_BOOSTS = {
    "php": 0.15,
    "java": 0.1,
    "django": 0.1,
    "rails": 0.1,
    "wordpress": 0.2,
    "drupal": 0.2,
    "joomla": 0.2,
    "strapi": 0.15,
}


def static_score(url: str, metadata: dict) -> tuple[float, str]:
    """Rule-based static scoring. Returns (score 0-1, reason string)."""
    score = 0.1   # baseline
    reasons = []

    # URL pattern scoring
    for pattern, boost, label in _HIGH_VALUE_PATTERNS:
        if re.search(pattern, url, re.IGNORECASE):
            score += boost
            reasons.append(label)

    # Parameter scoring
    params = metadata.get("params", [])
    if isinstance(params, list):
        for param in params:
            for pattern, boost, label in _INTERESTING_PARAMS:
                if re.search(pattern, param, re.IGNORECASE):
                    score += boost
                    reasons.append(f"{label} ({param})")
    elif isinstance(params, dict):
        for param in params.keys():
            for pattern, boost, label in _INTERESTING_PARAMS:
                if re.search(pattern, param, re.IGNORECASE):
                    score += boost
                    reasons.append(f"{label} ({param})")

    # HTTP method boost
    method = metadata.get("method", "GET").upper()
    if method == "POST":
        score += 0.1
        reasons.append("POST method")
    elif method in ("PUT", "DELETE", "PATCH"):
        score += 0.15
        reasons.append(f"{method} method")

    # Auth level
    status = metadata.get("status_code", 200)
    if status == 403:
        score += 0.2
        reasons.append("403 Forbidden — access control endpoint")
    elif status == 401:
        score += 0.15
        reasons.append("401 Unauthorized — auth endpoint")

    # Tech stack
    tech = metadata.get("tech", [])
    if isinstance(tech, list):
        for t in tech:
            for tech_name, boost in _TECH_BOOSTS.items():
                if tech_name.lower() in t.lower():
                    score += boost
                    reasons.append(f"Tech: {t}")

    # Normalise to 0-1
    score = min(score, 1.0)
    return round(score, 3), "; ".join(reasons) if reasons else "No notable signals"


# ─────────────────────────────────────────────
# Pass 2: Embedding Score
# ─────────────────────────────────────────────
def embedding_score(url: str, metadata: dict) -> tuple[float, float]:
    """
    Returns (similarity_to_confirmed_vulns, similarity_to_fps).
    High confirmed similarity → high score.
    High FP similarity → suppress.
    """
    ctx = VulnContext(
        url=url,
        vuln_type="unknown",   # we don't know yet at triage time
        tech_stack=metadata.get("tech", []),
        http_status=metadata.get("status_code"),
    )

    confirmed_similar = vector_store.find_similar_confirmed(ctx, n=3)
    fp_similar = vector_store.find_similar_fp(ctx, n=3)

    # Average similarity of top-3 confirmed matches
    if confirmed_similar:
        conf_score = sum(r["similarity"] for r in confirmed_similar) / len(confirmed_similar)
    else:
        conf_score = 0.0

    # Average similarity of top-3 FP matches
    if fp_similar:
        fp_score = sum(r["similarity"] for r in fp_similar) / len(fp_similar)
    else:
        fp_score = 0.0

    return round(conf_score, 3), round(fp_score, 3)


# ─────────────────────────────────────────────
# Pass 3: LLM Score (Claude Sonnet)
# ─────────────────────────────────────────────
def llm_score(url: str, metadata: dict, static_reason: str) -> tuple[float, str]:
    """Ask Claude Sonnet to assess exploitability. Returns (score, explanation)."""
    prompt = f"""You are a senior penetration tester doing a rapid triage assessment.

Score this HTTP endpoint's likelihood of containing an exploitable vulnerability.

## Endpoint Details
URL: {url}
HTTP Method: {metadata.get('method', 'GET')}
Status Code: {metadata.get('status_code', '?')}
Tech Stack: {metadata.get('tech', [])}
Parameters: {metadata.get('params', [])}
Server Header: {metadata.get('server', 'unknown')}
Page Title: {metadata.get('title', 'unknown')}

## Static Analysis Notes
{static_reason}

## Your Task
Return ONLY a JSON object with no extra text:
{{
  "score": <float 0.0 to 1.0>,
  "primary_vuln_hypothesis": "<most likely vuln type to test>",
  "reasoning": "<2-3 sentence justification>",
  "priority_params": ["<param names to focus on>"]
}}

Scoring guide:
- 0.8-1.0: Highly likely vulnerable — auth endpoints with redirect params, admin panels, file upload, SQLi-style params
- 0.5-0.79: Interesting — worth testing, some signals
- 0.2-0.49: Low priority — likely nothing, few signals
- 0.0-0.19: Skip — static resource, no interesting params
"""
    try:
        response = client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)
        return round(float(data.get("score", 0.3)), 3), data.get("reasoning", "")
    except Exception as e:
        return 0.3, f"LLM scoring failed: {e}"


# ─────────────────────────────────────────────
# Combined Triage
# ─────────────────────────────────────────────
def triage_finding(finding_id: str, url: str, metadata: dict) -> TriageResult:
    """Run all three passes and compute final weighted score."""
    weights = _load_weights()
    min_score = _load_min_score()
    fp_threshold = _load_fp_threshold()

    # Pass 1
    s_score, s_reason = static_score(url, metadata)

    # Pass 2
    emb_score, fp_score = embedding_score(url, metadata)

    # FP suppression check
    if fp_score >= fp_threshold:
        return TriageResult(
            finding_id=finding_id,
            url=url,
            static_score=s_score,
            embedding_score=emb_score,
            llm_score=0.0,
            final_score=0.0,
            passed=False,
            fp_suppressed=True,
            reason=f"Suppressed: {fp_score:.2f} similarity to known false positives (threshold: {fp_threshold})",
        )

    # Pass 3 (only run LLM if static + embedding suggest it's worth it)
    if s_score >= 0.2 or emb_score >= 0.3:
        l_score, l_reason = llm_score(url, metadata, s_reason)
    else:
        l_score, l_reason = 0.1, "Skipped LLM pass — low static + embedding score"

    # Weighted final
    final = (
        weights["static"] * s_score +
        weights["embedding"] * emb_score +
        weights["llm"] * l_score
    )
    final = round(min(final, 1.0), 3)
    passed = final >= min_score

    combined_reason = f"Static ({s_score}): {s_reason} | Embedding ({emb_score}) | LLM ({l_score}): {l_reason}"

    return TriageResult(
        finding_id=finding_id,
        url=url,
        static_score=s_score,
        embedding_score=emb_score,
        llm_score=l_score,
        final_score=final,
        passed=passed,
        fp_suppressed=False,
        reason=combined_reason,
    )


def triage_batch(findings: list[dict], min_score_override: Optional[float] = None) -> list[TriageResult]:
    """Triage a batch of findings, sort by final score descending."""
    results = []
    for f in findings:
        result = triage_finding(
            finding_id=f.get("id", "unknown"),
            url=f.get("target", f.get("url", "")),
            metadata=f.get("metadata", {}),
        )
        if min_score_override is not None:
            result.passed = result.final_score >= min_score_override
        results.append(result)

    results.sort(key=lambda r: r.final_score, reverse=True)
    return results
