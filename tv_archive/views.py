from django.shortcuts import render
from django.core.cache import cache
from django.db.models import Q
from django_apps.utils import translate_lv_to_eng
import json
import urllib3
from bs4 import BeautifulSoup
from urllib.parse import quote_plus
from time import sleep
from datetime import datetime, timedelta
import random
from .models import Content
import re
from difflib import SequenceMatcher
import logging
import certifi
from urllib3.util.retry import Retry
from urllib3.exceptions import MaxRetryError

logger = logging.getLogger(__name__)


def content_list(request):
    content_rating = request.GET.get('content_rating', None)
    not_content_rating = request.GET.get('not_content_rating', None)
    rating_value = request.GET.get('rating_value', None)
    start_date = request.GET.get('start_date', None)
    end_date = request.GET.get('end_date', None)
    ratio = request.GET.get('ratio', None)
    not_channel = request.GET.get('not_channel', None)
    channel = request.GET.get('channel', None)

    query = Q()
    if content_rating:
        query &= Q(content_rating=content_rating)
    if rating_value:
        query &= Q(rating_value__gte=rating_value)
    if not_content_rating:
        query &= ~Q(content_rating=not_content_rating)
    if start_date:
        query &= Q(start_date__gte=start_date)
    if end_date:
        query &= Q(start_date__lte=end_date)
    if ratio:
        query &= Q(ratio=ratio)
    if not_channel:
        query &= ~Q(channel=not_channel)
    if channel:
        query &= Q(channel=channel)

    contents = Content.objects.filter(query)

    context = {
        'contents': contents,
    }

    return render(request, 'content_list.html', context)

def random_sleep(min_seconds=1, max_seconds=2):
    """Sleeps for a random amount of time between min_seconds and max_seconds."""
    sleep_time = random.randint(min_seconds, max_seconds)
    sleep(sleep_time)

# Set up urllib3 pool manager with retry strategy
retry_strategy = Retry(
    total=3,
    backoff_factor=30,
    status_forcelist=[429, 500, 502, 503, 504]
)
http = urllib3.PoolManager(retries=retry_strategy, cert_reqs='CERT_REQUIRED', ca_certs=certifi.where())

def get_ratings(query, content_type=None):
    # Encode the query with UTF-8 encoding and spaces replaced with '+'
    encoded_query = quote_plus(query, encoding='utf-8')
    filter = "?s=tt" if content_type == "movie" else ""
    url = f"https://www.imdb.com/find/{filter}?q={encoded_query}&ref_=nv_sr_sm"

    # The user_agent is required to prevent 403 errors
    user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6446.75 Safari/537.36"
    headers = {"User-Agent": user_agent}

    try:
        random_sleep()
        search_results = http.request("GET", url, headers=headers)
        html_content = search_results.data
        soup = BeautifulSoup(html_content, 'html.parser')
        summary = soup.find('div', class_="ipc-metadata-list-summary-item__tc")
    except MaxRetryError:
        logger.error("Max retries exceeded for search request.")
        return None

    if summary is None:
        logger.info(f"Summary not found for:\n {query}")
        return None

    link_element = summary.find('a')
    if link_element:
        link = "https://www.imdb.com/" + link_element['href']
    else:
        logger.info("Link not found")
        return None

    try:
        random_sleep()
        content_description = http.request("GET", link, headers=headers)
        html_content = content_description.data
        soup = BeautifulSoup(html_content, 'html.parser')

        script_tags = soup.find_all('script', type='application/ld+json')
        if script_tags:
            logger.info(f"SCRIPT_TAGS: \n {script_tags}")
            script_tag = script_tags[0]
            json_data = script_tag.string
            if json_data:
                parsed_data = json.loads(json_data)

                description = parsed_data.get("description", "")
                description = re.sub(r"&\w+;", "", description)

                published_date = parsed_data.get("datePublished")
            if description:
                description = re.sub(r"&\w+;", "", parsed_data.get("description"))
            else:
                description = ""

            content_script_tags = soup.find_all('script', type='application/ld+json')
            content_script_tag = content_script_tags[0]
            content_json_data = content_script_tag.string
            content_parsed_data = json.loads(content_json_data)
            content_title = content_parsed_data.get("name")
            return {
                "title": content_title,
                "type": parsed_data.get("@type"),
                "description": description,
                "image": parsed_data.get("image"),
                "url": parsed_data.get("url"),
                "content_rating": parsed_data.get("contentRating"),
                "rating_value": parsed_data.get("aggregateRating", {}).get("ratingValue"),
                "published_date": published_date,
            }
    except MaxRetryError:
        logger.error("Max retries exceeded for content description request.")
        return None

    return None

def fetch_tv_program_details():
    channels = {
        "filmzone_hd": "filmzone_hd",
        "ltv7_hd": "ltv7_hd",
        "ltv1_hd": "ltv1_hd",
        }
    oldest_date = (datetime.now() - timedelta(days=6))

    for channel in channels:
        logger.info(f"Channel: {channel}")
        # Data is available for a span of 14 days
        for day in range(14):
            date = (oldest_date + timedelta(days=day))
            date_string = date.strftime('%d-%m-%Y')
            logger.info(f"Date: {date}")
            url = f"https://www.tet.lv/televizija/tv-programma?tv-type=interactive&view-type=list&date={date_string}&channel={channel}"

            response = http.request("GET", url)
            html_content = response.data
            soup = BeautifulSoup(html_content, 'html.parser')

            contents = soup.find_all('div', class_="show-expander-content")
            logger.info(f"Found {len(contents)} programs.")
            programs = []

            for program in contents:
                title_lv = program.find('div', class_="tet-font__headline--s")
                if title_lv:
                    title_lv = title_lv.text.strip()

                    if title_lv is None or title_lv in [
                        'Panorāma',
                        'Dienas ziņas',
                        'Krustpunktā',
                        'Rīta Panorāma',
                        'Laika ziņas',
                        'Sporta ziņas',
                        'Nakts ziņas',
                        'Kultūras ziņas',
                        'Saki Jā!',
                        'Spiegu spēles',
                        'De Facto',
                        'Laika ziņas',
                        'Basketbols.Basketbols: NBA.',
                        'Leģendārais loms',
                        'Rīta Panorāma',
                        'Aizliegtais paņēmiens',
                        'UgunsGrēks 4',
                        'Vides fakti',
                        'Aculiecinieks',
                        '1 :1. Aktuālā intervija',
                        'Sporta studija',
                        'Autoziņas',
                        'Bez Tabu',
                        '900 sekundes',
                        'Kultūršoks',
                        'SuperBingo',
                        'Kobra 17',
                        'Tāskmāsters'
                    ]:
                        continue

                    description_lv = program.find('div', class_="text tet-font__body--s")
                    if description_lv:
                        description_lv = re.sub(r"&\w+;", "", description_lv.text.strip())

                    ratings = get_ratings(title_lv, 'tv')
                    if ratings:
                        print("-" * 100)
                        title_ratio = 0
                        description_ratio = 0
                        if title_lv:
                            title_lv_to_eng = translate_lv_to_eng(title_lv)
                            title_ratio = SequenceMatcher(None, ratings["title"], title_lv_to_eng).ratio()
                            logger.info(f"TITLE LV: \n {title_lv}")
                            logger.info(f"TITLE LV TO ENG: \n {title_lv_to_eng}")
                            logger.info(f"TITLE ENG: \n {ratings['title']}")
                            logger.info(f"TITLE RATIO: \n {title_ratio}")
                        if description_lv:
                            description_lv_to_eng = translate_lv_to_eng(description_lv)
                            description_ratio = SequenceMatcher(None, ratings["description"], description_lv_to_eng).ratio()
                            logger.info(f"DESCRIPTION LV: \n {description_lv}")
                            logger.info(f"DESCRIPTION LV TO ENG: \n {description_lv_to_eng}")
                            logger.info(f"DESCRIPTION ENG: \n {ratings['description']}")
                            logger.info(f"DESCRIPTION RATIO: \n {description_ratio}")

                        ratio = max(title_ratio, description_ratio)

                        logger.info(f"IMDB DATE UPLOADED: \n {ratings['published_date']}")
                        logger.info(f"RATIO:\n {ratio}")
                        image_element = program.find('img')
                        image_url = image_element['src'] if image_element else ratings.get("image")
                        start_date = date.strftime('%Y-%m-%d')
                        Content.objects.update_or_create(
                              url=ratings["url"],
                              defaults={
                                  'type': ratings.get("type", ""),
                                  'title_lv': title_lv,
                                  'title_eng': ratings["title"],
                                  'description_lv': description_lv,
                                  'description_eng': ratings["description"],
                                  'image': ratings.get("image", ""),
                                  'url': ratings["url"],
                                  'image': image_url,
                                  'content_rating': ratings.get("content_rating", ""),
                                  'rating_value': ratings.get("rating_value", None),
                                  'start_date': start_date,
                                  'channel': channel,
                                  'ratio': ratio,
                              }
                          )
                else:
                    logger.info(f"No data found for {title_lv}")
    return programs

programs = fetch_tv_program_details()
