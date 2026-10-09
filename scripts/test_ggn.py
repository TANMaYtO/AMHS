"""Test Gurugram queries on Nominatim."""

import time
import requests

queries = [
    "Hero Honda Chowk, Sector 34, Gurugram",
    "Hero Honda Chowk Flyover",
    "Hero Honda Chowk, NH 48",
    "Hero Honda Chowk",
    "Narsinghpur, Badshahpur",
    "Narsinghpur, Haryana",
    "Narsinghpur",
    "Narsinghpur, Sector 35, Gurugram",
]

url = "https://nominatim.openstreetmap.org/search"
headers = {"User-Agent": "FloodLens-Evaluation/0.1 (floodlens@amhs.local)"}

for q in queries:
    params = {
        "q": q,
        "format": "json",
        "limit": 3,
        "viewbox": "76.80,28.90,77.50,28.30",
        "bounded": 1,
    }
    r = requests.get(url, params=params, headers=headers, timeout=10)
    data = r.json()
    if data:
        for it in data:
            lat = float(it["lat"])
            lon = float(it["lon"])
            disp = it["display_name"][:75]
            print(f"FOUND: q='{q}' -> ({lat:.4f}, {lon:.4f}) | {disp}")
    else:
        print(f"NONE: q='{q}'")
    time.sleep(1.1)
