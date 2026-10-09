"""Test alternative Nominatim queries."""

import time
import requests

test_alts = [
    ("Sangam Vihar", "Sangam Vihar, Delhi"),
    ("Narsinghpur", "Narsinghpur, Gurgaon"),
    ("Hero Honda Chowk", "Hero Honda Chowk, Gurgaon"),
    ("Hero Honda Chowk", "Hero Honda Chowk"),
    ("Kalindi Kunj", "Kalindi Kunj, Delhi"),
    ("Chirag Dilli", "Chirag Delhi, Delhi"),
    ("AIIMS", "AIIMS, New Delhi"),
    ("AIIMS", "All India Institute of Medical Sciences, New Delhi"),
    ("Bharat Mandapam", "Bharat Mandapam"),
    ("Bharat Mandapam", "Pragati Maidan, New Delhi"),
]

url = "https://nominatim.openstreetmap.org/search"
headers = {"User-Agent": "FloodLens-Evaluation/0.1 (floodlens@amhs.local)"}

for name, q in test_alts:
    params = {
        "q": q,
        "format": "json",
        "limit": 1,
        "viewbox": "76.80,28.90,77.50,28.30",
        "bounded": 1,
    }
    try:
        r = requests.get(url, params=params, headers=headers, timeout=10)
        data = r.json()
        if data:
            it = data[0]
            lat = float(it["lat"])
            lon = float(it["lon"])
            imp = it.get("importance")
            disp = it["display_name"][:60]
            print(f"FOUND: {name} (q='{q}') -> ({lat:.4f}, {lon:.4f}) | {disp} | imp={imp}")
        else:
            print(f"NONE: {name} (q='{q}')")
    except Exception as e:
        print(f"ERR: {e}")
    time.sleep(1.1)
