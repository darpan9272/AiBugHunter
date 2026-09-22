"""Quick smoke test — verify that configured AI providers are reachable."""

import os
from anthropic import Anthropic


def test_anthropic():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("⚠️  ANTHROPIC_API_KEY not set, skipping")
        return

    print("Testing Anthropic...")
    try:
        client = Anthropic(api_key=api_key)
        models = client.models.list()
        print(f"✅ Available models: {[m.id for m in models.data]}")
    except Exception as e:
        print(f"❌ Anthropic error: {e}")


if __name__ == "__main__":
    test_anthropic()
