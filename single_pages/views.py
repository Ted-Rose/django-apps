from django.shortcuts import render
from bs4 import BeautifulSoup
import requests


def twister(request):
    return render(request, 'twister.html')


def spoki_page_view(request):
    url = "https://spoki.lv/stilsmode/Kas-ar-mani-notika-Cilveki-atceras-savus/932253"
    try:
        response = requests.get(url)
        response.raise_for_status()  # Raise an exception for bad status codes
        soup = BeautifulSoup(response.content, 'html.parser')

        title = soup.find('h1', class_='article-title').get_text() if soup.find('h1', class_='article-title') else "Title not found"
        content_div = soup.find('div', class_='article-body-content')
        content = str(content_div) if content_div else "<p>Content not found.</p>"

    except requests.exceptions.RequestException as e:
        title = "Error"
        content = f"<p>Could not fetch content from URL: {e}</p>"

    context = {
        'title': title,
        'content': content,
    }
    return render(request, 'tv_programs/spoki_page.html', context)
