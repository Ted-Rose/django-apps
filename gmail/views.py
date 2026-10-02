import json

from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_POST
from django.http import JsonResponse

from google_api.utils import get_user_credentials, google_auth
from gmail.services import GMAIL_MODIFY_SCOPE, mark_messages_as_read


def _gmail_reauth_response(request, auth):
    """Store OAuth state and return a reauth JSON response."""
    request.session['state'] = auth['state']
    request.session['oauth_scopes'] = auth.get('scopes', [])
    request.session['oauth_redirect_url'] = (
        request.META.get('HTTP_REFERER') or '/gmail/'
    )
    return JsonResponse({
        'success': False,
        'reauth_required': True,
        'authorization_url': auth['authorization_url'],
    })


@login_required
@require_POST
def mark_emails_read(request):
    """Mark one or more Gmail messages as read (removes UNREAD).

    Not URL-routed anymore — POST /api/gmail/mark-read/ delegates
    here via django_apps.api._adapt so the SPA gets identical
    semantics (session-stored OAuth state, {success}/{reauth}
    payloads)."""
    try:
        data = json.loads(request.body)
    except ValueError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)

    message_ids = data.get('message_ids')
    if not isinstance(message_ids, list) or not message_ids:
        return JsonResponse(
            {'error': 'message_ids must be a non-empty list'},
            status=400,
        )

    creds = get_user_credentials(
        request.user, scopes=[GMAIL_MODIFY_SCOPE]
    )
    if not creds:
        auth = google_auth(scopes=[GMAIL_MODIFY_SCOPE], user=request.user)
        if isinstance(auth, dict) and 'authorization_url' in auth:
            return _gmail_reauth_response(request, auth)
        return JsonResponse(
            {'error': 'No credentials found'}, status=401
        )

    # Pass credentials dict for backward compatibility
    creds_dict = {
        'token': creds.token,
        'refresh_token': creds.refresh_token,
        'expiry': creds.expiry.isoformat(),
        'scopes': list(creds.scopes or []),
    }
    result = mark_messages_as_read(creds_dict, message_ids)

    if (isinstance(result, dict) and
            'authorization_url' in result):
        return _gmail_reauth_response(request, result)

    if not result:
        return JsonResponse(
            {'error': 'Failed to mark messages as read'}, status=500
        )
    return JsonResponse({'success': True})
