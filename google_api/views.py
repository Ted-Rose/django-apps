from django.shortcuts import redirect
from django.utils.http import url_has_allowed_host_and_scheme
from google_api.utils import (
    text_to_audio,
    google_auth,
)
from django.http import JsonResponse


def login_view(request):
    """
    Unified login view that requests all necessary scopes for the app.
    This includes Gmail (readonly) and Google Tasks access.
    """
    from google_api.utils import ALL_APP_SCOPES

    next_url = request.GET.get('next')
    if next_url and not url_has_allowed_host_and_scheme(
            next_url, allowed_hosts={request.get_host()}):
        # Open-redirect guard — the shell's SessionGate makes
        # /login/?next=<path> the standard anonymous bounce, so
        # `next` is request input that must stay same-origin
        # (rejects https://evil.com and scheme-relative //host).
        next_url = None
    next_url = next_url or 'google_tasks:dashboard'
    request.session['oauth_redirect_url'] = next_url

    # Request all scopes at once for a unified login experience
    auth = google_auth(scopes=ALL_APP_SCOPES, user=request.user)

    if isinstance(auth, dict) and 'authorization_url' in auth:
        request.session['state'] = auth['state']
        request.session['oauth_scopes'] = auth['scopes']
        return redirect(auth['authorization_url'])

    # Already authenticated, redirect to next URL
    return redirect(next_url)


def audio(request):
    if request.method == 'GET':
        text = request.GET.get('text')
        filename = request.GET.get('filename')
        lang = request.GET.get('lang')

        try:
            audio_url = text_to_audio(
                text=text, lang=lang, filename=filename
            )
            # Return the audio URL as JSON response
            return JsonResponse({'audio_url': audio_url})
        except ValueError as e:
            # Invalid input (empty text, too long, etc.)
            return JsonResponse(
                {'error': str(e)},
                status=400
            )
        except Exception as e:
            # Audio generation or upload failed
            return JsonResponse(
                {'error': f'Failed to generate audio: {str(e)}'},
                status=500
            )
    else:
        # Return a 405 Method Not Allowed response
        return JsonResponse(
            {'error': 'Method Not Allowed'},
            status=405
        )
