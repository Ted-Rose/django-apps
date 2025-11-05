from django.shortcuts import render
from bs4 import BeautifulSoup
import requests
import random


def twister(request):
    return render(request, 'twister.html')


def spoki_page_view(request):
    urls = [
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
    url = random.choice(urls)
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(url, headers=headers)
        response.raise_for_status()  # Raise an exception for bad status codes
        soup = BeautifulSoup(response.content, 'html.parser')

        content = str(soup)

        title = soup.find('a', class_='title').get_text(strip=True)
        # content_div = soup.find('div', class_='title')
        # content = str(content_div) if content_div else "<p>Content not found.</p>"

    except requests.exceptions.RequestException as e:
        title = "Error"
        content = f"<p>Could not fetch content from URL: {e}</p>"

    context = {
        'title': title,
        'content': content,
    }
    return render(request, 'blog_proxy_template.html', context)
