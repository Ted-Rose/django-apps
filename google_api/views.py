from django.shortcuts import render, redirect
from google_api.utils import (
    get_messages,
    text_to_audio,
    get_user_credentials,
    google_auth
)
from google_api.decorators import google_auth_required
from django.http import JsonResponse


@google_auth_required(scopes=['https://www.googleapis.com/auth/gmail.readonly'])
def gmail(request):
    """Gmail message viewer with text-to-speech functionality."""
    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Tasks', 'url': '/tasks/', 'icon': 'check2-square',
         'btn_class': 'btn-light'},
    ]

    if 'get_messages' in request.GET:
        # Get credentials from database
        creds = get_user_credentials(
            request.user,
            scopes=['https://www.googleapis.com/auth/gmail.readonly']
        )
        
        if creds:
            query = request.GET.get('query', '')
            # Pass credentials dict for backward compatibility
            creds_dict = {
                'token': creds.token,
                'refresh_token': creds.refresh_token,
                'expiry': creds.expiry.isoformat(),
                'scopes': list(creds.scopes or []),
            }
            messages = get_messages(query=query, creds=creds_dict)

            # If user has to authorize authorization_url is returned
            if (isinstance(messages, dict) and 'authorization_url' in
                    messages and 'state' in messages):
                request.session['state'] = messages['state']
                request.session['oauth_scopes'] = messages.get('scopes', [])
                request.session['oauth_redirect_url'] = request.get_full_path()
                return redirect(messages['authorization_url'])

            context = {
                'messages': messages,
                'has_credentials': True,
                'burger_menu_items': burger_menu_items,
            }
            return render(request, 'gmail.html', context)

    context = {
        'has_credentials': True,
        'burger_menu_items': burger_menu_items,
    }
    return render(request, 'gmail.html', context)


def login_view(request):
    """
    Unified login view that requests all necessary scopes for the app.
    This includes Gmail (readonly) and Google Tasks access.
    """
    from google_api.utils import ALL_APP_SCOPES
    
    next_url = request.GET.get('next', 'google_tasks:dashboard')
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
