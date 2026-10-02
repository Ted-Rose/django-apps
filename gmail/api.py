"""django-ninja router for gmail (mounted at /api/gmail/).

Read ops implement the page views' credential flow directly
(`get_user_credentials` → 401 google_reauth, auth dict → OAuth
session state + GoogleReauthRequired); the mark-read op delegates
to `gmail.views.mark_emails_read` via the shared `_adapt` helper —
the view kept its semantics when the `gmail-mark-read` route was
deleted at cutover.
`audio` is a typed, session-authenticated sibling of the legacy
`/text-to-audio` view — the function stays in google_api (platform),
the endpoint lives with the feature.
"""
from typing import List, Optional

from ninja import Query, Router, Schema

from django_apps.api import (
    ApiHttpError,
    GoogleReauthRequired,
    _adapt,
    _reauth_url,
    spa_url_for,
)
from google_api.models import GoogleOAuthCredentials
from google_api.utils import get_user_credentials, text_to_audio
from gmail import services, views
from gmail.services import GMAIL_READONLY_SCOPE

router = Router()


# --- Schemas ---

class GmailMessageOut(Schema):
    id: str
    subject: Optional[str] = None
    sender: Optional[str] = None
    body: Optional[str] = None


class GmailMessagesOut(Schema):
    messages: List[GmailMessageOut]
    query: str


class GmailStatusOut(Schema):
    has_credentials: bool
    scopes: List[str]


class MarkReadIn(Schema):
    # Non-empty enforced by the delegated view (it 400s on
    # empty/missing lists) — kept validate-only like the tasks *In
    # schemas.
    message_ids: List[str]


class AudioOut(Schema):
    audio_url: str


# --- Read endpoints ---

@router.get('/status/', response=GmailStatusOut)
def status(request):
    """API equivalent of @google_auth_required's eager check: the SPA
    calls this on mount and navigates to /login/?next=<spa url>
    itself when has_credentials is false — same eager bounce the
    decorator did before rendering gmail.html."""
    try:
        oauth_creds = GoogleOAuthCredentials.objects.get(
            user=request.user
        )
        scopes = list(oauth_creds.scopes or [])
        has_scopes = oauth_creds.has_all_scopes([GMAIL_READONLY_SCOPE])
    except GoogleOAuthCredentials.DoesNotExist:
        return {'has_credentials': False, 'scopes': []}

    usable = (
        has_scopes and
        get_user_credentials(request.user, [GMAIL_READONLY_SCOPE])
        is not None
    )
    return {'has_credentials': usable, 'scopes': scopes}


@router.get('/messages/', response=GmailMessagesOut)
def messages(request, query: str = Query('', max_length=500)):
    """Port of the gmail view's ?get_messages branch — same
    get_user_credentials → services.get_messages call path."""
    creds = get_user_credentials(
        request.user, scopes=[GMAIL_READONLY_SCOPE]
    )
    if not creds:
        raise GoogleReauthRequired(_reauth_url(request))

    # Pass credentials dict for backward compatibility
    creds_dict = {
        'token': creds.token,
        'refresh_token': creds.refresh_token,
        'expiry': creds.expiry.isoformat(),
        'scopes': list(creds.scopes or []),
    }
    result = services.get_messages(query=query, creds=creds_dict)

    # get_messages returns {'authorization_url', 'state', 'scopes'}
    # when Google reauth is needed — store OAuth state in the session
    # (same keys the page view writes) and surface the 401 the SPA
    # navigates from. oauth_redirect_url points back at the SPA page,
    # never at this /api/ JSON URL.
    if (isinstance(result, dict) and 'authorization_url' in result
            and 'state' in result):
        request.session['state'] = result['state']
        request.session['oauth_scopes'] = result.get('scopes', [])
        request.session['oauth_redirect_url'] = spa_url_for(request)
        raise GoogleReauthRequired(result['authorization_url'])

    return {'messages': result, 'query': query}


@router.get('/audio/', response=AudioOut)
def audio(request, text: str = Query('', max_length=6000),
          lang: Optional[str] = Query(None, max_length=10),
          filename: Optional[str] = Query(None, max_length=200)):
    """Session-authenticated sibling of /text-to-audio (which stays
    public for twister.html). Same {audio_url} shape; the legacy 500
    maps to the API's 502 upstream_error taxonomy."""
    try:
        audio_url = text_to_audio(text=text, lang=lang, filename=filename)
        return {'audio_url': audio_url}
    except ValueError as e:
        raise ApiHttpError(400, str(e)) from e
    # AudioGenerationError and any other pipeline failure map to the
    # API's upstream-error taxonomy (the legacy view returned 500).
    except Exception as e:
        raise ApiHttpError(
            502, f'Failed to generate audio: {e}'
        ) from e


# --- Mutation endpoints (delegate to the existing JSON views) ---

@router.post('/mark-read/')
def mark_read(request, payload: MarkReadIn):
    return _adapt(request, views.mark_emails_read(request))
