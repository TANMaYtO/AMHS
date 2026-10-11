import requests
import time
import json

questions = [
    "Which spots flood first if 50 mm/hr hits tonight?",
    "Is Minto Bridge at risk at 40 mm/hr?",
    "I have 6 pumps, where should they go for 60 mm/hr?",
    "Is the route from Connaught Place to Cyber City safe right now at 40 mm/hr?",
    "Evaluate waterlogging risk along the corridor from AIIMS to IGI Airport at 50 mm/hr"
]

print("=== TESTING AGENT CHAT QUESTIONS ===\n")

for i, q in enumerate(questions, 1):
    print(f"[{i}/5] Question: \"{q}\"")
    t0 = time.time()
    try:
        r = requests.post(
            "http://127.0.0.1:8000/agent/chat",
            json={"message": q, "history": []},
            timeout=90
        )
        elapsed = time.time() - t0
        if r.status_code == 200:
            data = r.json()
            reply = data.get("reply", "")
            traces = data.get("tool_trace", [])
            tools_used = [t.get("tool") for t in traces]
            print(f"   -> Status: HTTP 200 in {elapsed:.1f}s")
            print(f"   -> Tools called ({len(traces)}): {tools_used}")
            for t in traces:
                print(f"      * {t.get('tool')}: {t.get('summary')}")
            print(f"   -> Reply preview: {reply[:140].strip()}...\n")
        else:
            print(f"   -> FAILED: HTTP {r.status_code}: {r.text}\n")
    except Exception as e:
        print(f"   -> ERROR: {e}\n")
    time.sleep(5)
