"""Test script running the four required control-room scenarios through FloodLens agent.

Scenarios:
1. "Which spots flood first if 50 mm/hr hits tonight?"
2. "Is Minto Bridge at risk at 40 mm/hr?"
3. "I have 6 pumps, where should they go for 60 mm/hr?"
4. "What does the forecast say for Gurugram?"
"""

import json
import os
import sys
import time

# Ensure floodlens root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi.testclient import TestClient
from api.main import app

SCENARIOS = [
    "Which spots flood first if 50 mm/hr hits tonight?",
    "Is Minto Bridge at risk at 40 mm/hr?",
    "I have 6 pumps, where should they go for 60 mm/hr?",
    "What does the forecast say for Gurugram?",
]


def run_scenarios() -> None:
    """Execute all 4 scenarios against the FastAPI /agent/chat endpoint."""
    print("=" * 80)
    print("FloodLens Agent Test Suite: 4 Control Room Scenarios")
    print(f"Provider: {os.getenv('MODEL_PROVIDER', 'gemini')}")
    print("=" * 80)

    client = TestClient(app)

    # First test /health
    health_resp = client.get("/health")
    print(f"Health check: {health_resp.status_code} -> {health_resp.json()}\n")

    for idx, prompt in enumerate(SCENARIOS, 1):
        print("=" * 80)
        print(f"SCENARIO {idx}: \"{prompt}\"")
        print("=" * 80)
        t0 = time.time()
        resp = client.post(
            "/agent/chat",
            json={"message": prompt, "history": []},
        )
        elapsed = time.time() - t0

        if resp.status_code != 200:
            print(f"ERROR: Status {resp.status_code}: {resp.text}")
            continue

        data = resp.json()
        print(f"Latency: {elapsed:.2f}s")
        print("\n--- TOOL TRACE ---")
        if not data["tool_trace"]:
            print("  (No tools called)")
        for t_idx, trace in enumerate(data["tool_trace"], 1):
            print(f"  [{t_idx}] Tool: {trace['tool']}")
            print(f"      Args: {json.dumps(trace['args'])}")
            print(f"      Summary: {trace['summary']}")

        print("\n--- AGENT REPLY ---")
        print(data["reply"])
        print("\n")

        # Pacing sleep between scenarios to respect Gemini API rate limits
        if idx < len(SCENARIOS):
            print("Pacing delay (12s) before next scenario...")
            time.sleep(12)


if __name__ == "__main__":
    run_scenarios()
