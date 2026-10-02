"""Server-side fetches for single_pages.

The spoki.lv proxy must stay server-side — JS can't fetch
cross-origin and shouldn't. Returned HTML is UNSANITIZED; API ops
run nh3.clean on it before it reaches the SPA.
"""
import random

import requests
from bs4 import BeautifulSoup

SPOKI_URLS = [
    "https://spoki.lv/joki/-Vecie-joki-vienmer-esot-lieliski/932248",
    "https://spoki.lv/foto-izlases/Apkarteja-pasaule-ir-interesanta-/932279",
    "https://spoki.lv/tribine/Kapec-suni-medz-laizit-kaju-pirkstus/930670",
    "https://spoki.lv/tribine/Latvijas-hokeja-izlasei-bus-jauni/932287",
    "https://spoki.lv/tribine/Legendara-restorana-Senite-kupols-vairs/932281",
    "https://spoki.lv/izgudrojumi/Okeana-ir-atrasti-pieradijumi-par/931284",
    "https://spoki.lv/tribine/Apstiprinats-Cilveki-patiesam-medz/930619",
    "https://spoki.lv/tribine/Murkski-tikko-atrisinaja-154-gadus-vecu/929713",
    "https://spoki.lv/tribine/Noslepums-Vienigie-tris-objekti-kas/928115",
]

SPOKI_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) '
                  'Chrome/91.0.4472.124 Safari/537.36'
}


def fetch_spoki_article():
    """Fetch a random spoki.lv article.

    Returns {'title', 'html', 'source_url'} where `html` is the
    parsed document as a string — callers must sanitize it before
    rendering. Raises requests.exceptions.RequestException on
    upstream failure.
    """
    url = random.choice(SPOKI_URLS)
    response = requests.get(url, headers=SPOKI_HEADERS, timeout=10)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    title_el = soup.find('a', class_='title')
    return {
        'title': title_el.get_text(strip=True) if title_el else '',
        'html': str(soup),
        'source_url': url,
    }
