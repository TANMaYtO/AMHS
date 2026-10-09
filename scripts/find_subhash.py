"""Find live Subhash Chowk Indian Express article."""

import requests
import re

redirect_urls = [
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHLJ25Jmpv4Td8973gtvi-eTji6YWHtOc0kYYjsfjFDEmyEI4NRQRbp7eNxXeG9-cep-6zA6vlpG2qDe1j3wHFeqw3FPluM40R1FH0pdCmxw14rQLJlIWfrH9XFAiJggnp_kVZkkEsETcfQsIewAhhA1jBfM72kQ4AH8_Wb6rPSChQ-m65i8PVqe0g-ZiSyELR07Maku87oOQO0vJe6_otVViD5N7I04RHlebpu63ALNSdecT8Y8sQE",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEscriNXXWFo03xHST5BM5KX5YQCDZ1XAnTtQO9mEbymVVGmQeDEtbYVXHVdek7VwZzWMJIALbjjhzjAzM7nKowh7VcbnyBded0LQT2Iz2CGDxyR3VXdeQtlwSMB_Tigg5sucnB64NFuWbidiMKmIN0DXCY_oaGaKRqeXdB1qVv-3wiqbf1-TLak3F2dDhFm65QaDSrb0reny4PQsijtHcg6R8uxntSsNznzUC2nbo9zweo7-PUBy2O",
    "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHsffuCx09Q17hkeEtzXgH4fthw0wCyY770fxGDESVsMDhlf7OdWffxdEbycraVzjNeWQJgH5dtnm8mMCOnv11_AVb1YB65HJPyDytTOAATyQz-KVHO13HA4EcRZg4k7u99_nSD1KW81dRd66hVn_WdDjzE4Eu4zEFHrHwUIAxJpnYmO204XlofXu_1RT8e95F8i_TdyQAA0qUC1i8Qx6L8l98Gse9oMT7YsHRsA_OnKc5R6vk=",
]

for ru in redirect_urls:
    try:
        resp = requests.get(ru, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
        print(f"Status: {resp.status_code} | Final URL: {resp.url}")
        # Search for Subhash Chowk in text
        if "Subhash Chowk" in resp.text:
            print("  -> Page contains 'Subhash Chowk'!")
            title = re.findall(r'<title>(.*?)</title>', resp.text, re.I)
            if title:
                print("  Title:", title[0].encode("ascii", "ignore").decode())
    except Exception as e:
        print("Error:", e)
