"""
Meta-Agent — The Self-Learning Brain

Runs weekly (via cron) or on-demand from the dashboard (/api/learning).
Analyses all run outcomes and rewrites:
  1. Triage scoring weights
  2. Exploit agent priority order
  3. Strategy config (stored in Postgres + strategy_config.json)
  4. Agent system prompts (written back to agents/<agent>/system_prompt.md)

Provider-agnostic: works with ANY model.
  Priority:
    1. LEARNING_BASE_URL + LEARNING_API_KEY + LEARNING_MODEL
       (any OpenAI-compatible endpoint: DeepSeek, Ollama, LM Studio, vLLM, ...)
    2. ANTHROPIC_API_KEY + LEARNING_MODEL (defaults to Claude)
"""

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from outcome_store import (
    get_latest_strategy,
    get_outcomes_since,
    get_report_acceptance_rate,
    get_success_rates_by_vuln_type,
    save_strategy_version,
)
from vector_store import VectorStore, VulnContext

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
LEARNING_BASE_URL = os.getenv("LEARNING_BASE_URL", "")
LEARNING_API_KEY = os.getenv("LEARNING_API_KEY", "")
LEARNING_MODEL = os.getenv("LEARNING_MODEL", "")
AGENTS_DIR = Path(os.getenv("AGENTS_DIR", "../agents"))
STRATEGY_CONFIG_PATH = Path(os.getenv("STRATEGY_CONFIG_PATH", "./strategy_config.json"))

vector_store = VectorStore()


def ask_model(prompt: str, max_tokens: int = 4096) -> str:
    """Send the analysis prompt to whichever model is configured."""
    # Path 1: any OpenAI-compatible endpoint (DeepSeek, Ollama, LM Studio, vLLM...)
    if LEARNING_BASE_URL:
        import httpx

        url = LEARNING_BASE_URL.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if LEARNING_API_KEY:
            headers["Authorization"] = f"Bearer {LEARNING_API_KEY}"
        resp = httpx.post(
            url,
            headers=headers,
            json={
                "model": LEARNING_MODEL or "default",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "temperature": 0.3,
            },
            timeout=600,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"] or ""

    # Path 2: Anthropic native
    if ANTHROPIC_API_KEY:
        import anthropic

        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        response = client.messages.create(
            model=LEARNING_MODEL or "claude-sonnet-4-5",
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    raise RuntimeError(
        "No model configured for learning. Set LEARNING_BASE_URL (+LEARNING_MODEL) "
        "for any OpenAI-compatible/local server, or ANTHROPIC_API_KEY."
    )


def run_weekly_learning_cycle(days: int = 7):
    """Main entry point — full learning cycle over the last N days."""
    print(f"\n{'='*60}")
    print(f"META-AGENT: Weekly Learning Cycle — {datetime.now(timezone.utc).isoformat()}")
    print(f"{'='*60}\n")

    # 1. Gather all data
    print("[1/6] Gathering outcome data...")
    outcomes = get_outcomes_since(days=days)
    success_rates = get_success_rates_by_vuln_type()
    acceptance_stats = get_report_acceptance_rate()
    current_strategy = get_latest_strategy()
    vector_stats = vector_store.collection_stats()

    print(f"      Found {len(outcomes)} outcomes this week")
    print(f"      Acceptance rate stats: {acceptance_stats}")
    print(f"      Vector DB: {vector_stats}")

    if not outcomes:
        print("No outcomes to learn from this week. Skipping cycle.")
        return

    # 2. Update vector store with confirmed/rejected findings
    print("[2/6] Updating vector store with new outcomes...")
    for outcome in outcomes:
        ctx = VulnContext(
            url=outcome.get("target", ""),
            vuln_type=outcome.get("agent_type", "unknown"),
            payload=outcome.get("payload"),
            response_snippet=outcome.get("response_snippet"),
        )
        if outcome["event_type"] == "accepted":
            vector_store.add_confirmed_vuln(ctx, report_id=outcome["report_id"])
            if outcome.get("payload"):
                vector_store.add_successful_payload(
                    vuln_type=outcome["agent_type"],
                    payload=outcome["payload"],
                    context_url=outcome.get("target", ""),
                    payload_id=outcome["id"],
                )
        elif outcome["event_type"] in ("rejected", "informative"):
            vector_store.add_false_positive(
                ctx,
                reason=outcome["event_type"],
                report_id=outcome["report_id"],
            )
    print(f"      Vector DB now: {vector_store.collection_stats()}")

    # 3. Ask the configured model to analyse patterns and propose new strategy
    print("[3/6] Running Meta-Agent analysis...")
    analysis_prompt = _build_analysis_prompt(
        outcomes, success_rates, acceptance_stats, current_strategy
    )
    analysis = ask_model(analysis_prompt, max_tokens=4096)
    print(f"      Analysis complete ({len(analysis)} chars)")

    # 4. Extract structured strategy update from analysis
    print("[4/6] Extracting new strategy config...")
    new_strategy = _extract_strategy_from_analysis(analysis, current_strategy["config"])

    # 5. Save new strategy to DB + file
    print("[5/6] Saving new strategy...")
    version = save_strategy_version(new_strategy, reasoning=analysis)
    STRATEGY_CONFIG_PATH.write_text(json.dumps(new_strategy, indent=2))
    print(f"      Saved strategy v{version}")

    # 6. Rewrite agent system prompts with updated guidance
    print("[6/6] Updating agent system prompts...")
    _update_agent_prompts(new_strategy, analysis)

    print(f"\n✅ Weekly learning cycle complete. Strategy now at v{version}.\n")
    return {"version": version, "strategy": new_strategy, "analysis_summary": analysis[:500]}


def _build_analysis_prompt(outcomes, success_rates, acceptance_stats, current_strategy) -> str:
    return f"""You are the Meta-Agent for an autonomous bug hunting system.
Your job is to analyse this week's results and output an updated strategy config.

## Current Strategy (v{current_strategy['version']})
```json
{json.dumps(current_strategy['config'], indent=2)}
```

## This Week's Acceptance Stats
```json
{json.dumps(acceptance_stats, indent=2)}
```

## Success Rates by Vuln Type
```json
{json.dumps(success_rates, indent=2)}
```

## This Week's Outcomes (sample — last 20)
```json
{json.dumps(outcomes[:20], indent=2, default=str)}
```

## Your Task

1. **Analyse patterns**: What vuln types are working? What's generating noise?
   What target types are most fruitful? Which payloads succeeded?

2. **Identify weaknesses**: Are certain agents producing too many FPs?
   Are any vuln classes being under-tested?

3. **Propose a new strategy config** in this exact JSON format within a ```json block:
```json
{{
    "triage_weights": {{"static": 0.0-1.0, "embedding": 0.0-1.0, "llm": 0.0-1.0}},
    "exploit_priority": ["ordered", "list", "of", "vuln", "types"],
    "target_type_hints": {{"tech_stack_pattern": ["preferred_vuln_types"]}},
    "payload_boost_patterns": ["regex patterns of payloads to prioritise"],
    "fp_suppression_threshold": 0.0-1.0,
    "min_triage_score": 0.0-1.0
}}
```

4. **Write 3-5 specific guidance updates** for the recon, triage, and exploit agents
   (what they should do differently next week).

Be specific and data-driven. Explain your reasoning clearly."""


def _extract_strategy_from_analysis(analysis: str, current_config: dict) -> dict:
    """Parse the JSON strategy block from the meta-agent's analysis."""
    match = re.search(r"```json\s*(\{.*?\})\s*```", analysis, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Fallback: return current config unchanged
    return current_config


def _update_agent_prompts(strategy: dict, analysis: str):
    """Append learning notes to each agent's system prompt."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    learning_note = f"""
---
## 🧠 Learning Update — {timestamp}

The Meta-Agent updated this agent's guidance based on last week's results.

### Key Changes
{_extract_key_changes(analysis)}

### Current Strategy Config
- Triage weights: {strategy.get('triage_weights', {})}
- Exploit priority: {strategy.get('exploit_priority', [])}
- Min triage score: {strategy.get('min_triage_score', 0.3)}
- FP suppression threshold: {strategy.get('fp_suppression_threshold', 0.8)}
"""

    for agent_dir in AGENTS_DIR.iterdir():
        if agent_dir.is_dir():
            prompt_file = agent_dir / "system_prompt.md"
            if prompt_file.exists():
                existing = prompt_file.read_text()
                # Remove old learning update block if present
                existing = re.sub(
                    r"\n---\n## 🧠 Learning Update.*$", "", existing, flags=re.DOTALL
                )
                prompt_file.write_text(existing + learning_note)


def _extract_key_changes(analysis: str) -> str:
    """Extract the 3-5 guidance updates section from the analysis."""
    match = re.search(
        r"(guidance updates?.*?)(?:```|\Z)", analysis, re.IGNORECASE | re.DOTALL
    )
    if match:
        return match.group(1).strip()[:1000]
    return "See full analysis in strategy_versions table."


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Meta-Agent self-learning cycle")
    parser.add_argument("--days", type=int, default=7, help="Look-back window in days")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON result")
    args = parser.parse_args()

    try:
        result = run_weekly_learning_cycle(days=args.days)
        if args.json:
            print("\n===RESULT_JSON===")
            print(json.dumps(result or {}, default=str))
    except Exception as exc:  # surface errors to the dashboard
        print(f"LEARNING_CYCLE_FAILED: {exc}", file=sys.stderr)
        if args.json:
            print("\n===RESULT_JSON===")
            print(json.dumps({"error": str(exc)}))
        sys.exit(1)
