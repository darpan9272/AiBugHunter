import os
import asyncio
from anthropic import Anthropic

async def test():
    print("Testing Anthropic...")
    try:
        client = Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        models = client.models.list()
        print([m.id for m in models.data])
    except Exception as e:
        print(f"Anthropic error: {e}")

asyncio.run(test())
