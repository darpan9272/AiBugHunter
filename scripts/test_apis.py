"""Ad-hoc API key connectivity check. Read-only / non-destructive calls only."""
import os
import sys
import httpx

# Load .env
from pathlib import Path
env = Path(__file__).resolve().parent.parent / ".env"
for line in env.read_text().splitlines():
    line = line.split("#", 1)[0].strip()
    if "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

OK, FAIL = "PASS", "FAIL"

def line(name, status, detail=""):
    print(f"[{status}] {name:<22} {detail}")

# ── Anthropic ──
def test_anthropic():
    key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return line("Anthropic", "SKIP", "no key")
    try:
        import anthropic
        c = anthropic.Anthropic(api_key=key)
        models = [m.id for m in c.models.list().data]
        line("Anthropic", OK, f"{len(models)} models, e.g. {models[:3]}")
    except Exception as e:
        line("Anthropic", FAIL, str(e)[:200])

# ── Google Gemini ──
def test_google():
    key = os.environ.get("GOOGLE_API_KEY", "")
    if not key:
        return line("Google Gemini", "SKIP", "no key")
    try:
        r = httpx.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": key}, timeout=30,
        )
        if r.status_code == 200:
            names = [m["name"].split("/")[-1] for m in r.json().get("models", [])]
            line("Google Gemini", OK, f"{len(names)} models, e.g. {names[:3]}")
        else:
            line("Google Gemini", FAIL, f"HTTP {r.status_code}: {r.text[:150]}")
    except Exception as e:
        line("Google Gemini", FAIL, str(e)[:200])

# ── Shodan ──
def test_shodan():
    key = os.environ.get("SHODAN_API_KEY", "")
    if not key:
        return line("Shodan", "SKIP", "no key")
    try:
        r = httpx.get("https://api.shodan.io/api-info", params={"key": key}, timeout=30)
        if r.status_code == 200:
            d = r.json()
            line("Shodan", OK, f"plan={d.get('plan')}, query_credits={d.get('query_credits')}")
        else:
            line("Shodan", FAIL, f"HTTP {r.status_code}: {r.text[:150]}")
    except Exception as e:
        line("Shodan", FAIL, str(e)[:200])

# ── Censys ──
def test_censys():
    uid = os.environ.get("CENSYS_API_ID", "")
    secret = os.environ.get("CENSYS_API_SECRET", "")
    if not (uid and secret):
        return line("Censys", "SKIP", "no key")
    try:
        r = httpx.get("https://search.censys.io/api/v1/account", auth=(uid, secret), timeout=30)
        if r.status_code == 200:
            d = r.json()
            quota = d.get("quota", {})
            line("Censys", OK, f"email={d.get('email')}, quota={quota.get('used')}/{quota.get('allowance')}")
        else:
            line("Censys", FAIL, f"HTTP {r.status_code}: {r.text[:150]}")
    except Exception as e:
        line("Censys", FAIL, str(e)[:200])

if __name__ == "__main__":
    print("API connectivity check (read-only)\n" + "-" * 50)
    test_anthropic()
    test_google()
    test_shodan()
    test_censys()
    print("-" * 50)
