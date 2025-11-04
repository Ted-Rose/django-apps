from django.shortcuts import render
from bs4 import BeautifulSoup
import requests


def twister(request):
    return render(request, 'twister.html')


def spoki_page_view(request):
    url = "https://spoki.lv/joki/-Vecie-joki-vienmer-esot-lieliski/932248"
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
