"""Inspect Gurugram locations and check confidence."""

import requests

queries = [
    ("Sector 15 Gurugram", "Sector 15, Gurugram"),
    ("Sector 15 Gurgaon", "Sector 15, Gurgaon"),
    ("Patel Nagar Gurugram", "Patel Nagar, Gurugram"),
    ("Civil Lines Gurugram", "Civil Lines, Gurugram"),
    ("Rajiv Chowk Gurugram", "Rajiv Chowk, Gurugram"),
    ("Subhash Chowk Gurugram", "Subhash Chowk, Gurugram"),
    ("Minto Bridge", "Minto Bridge, New Delhi"),
]

url = "https://nominatim.openstreetmap.org/search"
headers = {"User-Agent": "FloodLens-Evaluation/0.1 (floodlens@amhs.local)"}

for name, q in queries:
    params = {"q": q, "format": "json", "limit": 2}
    r = requests.get(url, params=params, headers=headers).json()
    print(f"\n--- Query: {q} ---")
    for it in r:
        print(f"  ({it['lat']}, {it['lon']}) | {it['display_name']} | type={it.get('type')} | imp={it.get('importance')}")
