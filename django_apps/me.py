"""Per-user settings API — mounted at /api/me/ in urls.py.

The SPAs read `language` from the spa_shell bootstrap at load; GET
lets them re-sync without a page reload, PATCH persists a change so
server-side contexts (job-generated notifications) pick it up too.
PATCH also sets the standard `django_language` cookie — inert today
(no LocaleMiddleware) but free future-proofing.
"""
from django.conf import settings
from ninja import Router, Schema
from ninja.errors import HttpError

from django_apps.api import api
from django_apps.models import UserSettings, user_language

router = Router()


class MeOut(Schema):
    username: str
    language: str


class LanguageIn(Schema):
    language: str


def _me_payload(request, language=None):
    return {
        'username': request.user.get_username(),
        'language': language or user_language(request.user),
    }


@router.get('/', response=MeOut)
def get_me(request):
    return _me_payload(request)


@router.patch('/', response=MeOut)
def patch_me(request, payload: LanguageIn):
    codes = {code for code, _name in settings.LANGUAGES}
    if payload.language not in codes:
        raise HttpError(400, f'Unsupported language: {payload.language}')
    user_settings, _ = UserSettings.objects.get_or_create(
        user=request.user,
        defaults={'language': payload.language},
    )
    if user_settings.language != payload.language:
        user_settings.language = payload.language
        user_settings.save(update_fields=['language'])
    # create_response (a real HttpResponse) so the language cookie
    # can ride along — the schema only documents the shape.
    response = api.create_response(
        request, _me_payload(request, user_settings.language),
        status=200,
    )
    response.set_cookie(
        settings.LANGUAGE_COOKIE_NAME,
        payload.language,
        max_age=settings.LANGUAGE_COOKIE_AGE,
        path=settings.LANGUAGE_COOKIE_PATH,
        domain=settings.LANGUAGE_COOKIE_DOMAIN,
        secure=settings.LANGUAGE_COOKIE_SECURE,
        httponly=settings.LANGUAGE_COOKIE_HTTPONLY,
        samesite=settings.LANGUAGE_COOKIE_SAMESITE,
    )
    return response
