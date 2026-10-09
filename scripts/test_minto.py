"""Find historic Minto Bridge article URL in Hindustan Times."""

import re
import requests

url = "https://www.hindustantimes.com/trending/miracle-at-minto-bridge-no-waterlogging-smooth-traffic-leaves-delhiites-surprised-101753251255738.html"
resp = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}).text
links = re.findall(r'href=[\'"](https://www.hindustantimes.com/[^\'"]*minto[^\'"]*)[\'"]', resp, re.I)
for l in set(links):
    print("Found link:", l)
