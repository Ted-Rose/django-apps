"""django-ninja router for single_pages (mounted at
/api/single_pages/).

Two GET ops, no mutations. `tts` is a session-authenticated sibling
of the legacy /text-to-audio view (the function lives in google_api,
the endpoint with the feature — same arrangement as
/api/gmail/audio/). `spoki` proxies a random spoki.lv article with
nh3 sanitization — the deleted template rendered the fetched page
|safe (XSS); the SPA's dangerouslySetInnerHTML only ever sees
sanitized output.
"""
from typing import Optional

import nh3
import requests
from ninja import Query, Router, Schema

from django_apps.api import ApiHttpError
from google_api.utils import text_to_audio
from single_pages import services

router = Router()


# --- Schemas ---

class AudioOut(Schema):
    audio_url: str


class SpokiOut(Schema):
    title: str
    html: str
    source_url: str


# --- Endpoints ---

@router.get('/tts/', response=AudioOut)
def tts(request, text: str = Query('', max_length=6000),
        lang: Optional[str] = Query(None, max_length=10),
        filename: Optional[str] = Query(None, max_length=200)):
    """Same {audio_url} shape as /text-to-audio and
    /api/gmail/audio/; `lang` validation reuses text_to_audio's
    lv/en restriction — its ValueError maps to 400, pipeline
    failures to the API's 502 upstream_error taxonomy."""
    try:
        audio_url = text_to_audio(text=text, lang=lang,
                                  filename=filename)
        return {'audio_url': audio_url}
    except ValueError as e:
        raise ApiHttpError(400, str(e)) from e
    except Exception as e:
        raise ApiHttpError(
            502, f'Failed to generate audio: {e}'
        ) from e


@router.get('/spoki/', response=SpokiOut)
def spoki(request):
    """Random spoki.lv article, sanitized. The live fetch is per-hit
    (same as the template view) — upstream failures are 502."""
    try:
        article = services.fetch_spoki_article()
    except requests.exceptions.RequestException as e:
        raise ApiHttpError(
            502, f'Failed to fetch article: {e}'
        ) from e
    article['html'] = nh3.clean(article['html'])
    return article
