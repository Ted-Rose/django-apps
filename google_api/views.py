from django.shortcuts import render, redirect
from google_api.utils import get_messages, text_to_audio, google_auth
from django.http import JsonResponse
from django.conf import settings


def gmail(request):
    if 'get_messages' in request.GET:
        creds = request.session.get('google_credentials')
        if creds:
            query = request.GET.get('query', '')
            messages = get_messages(query=query, creds=creds)

            # If user has to authorize authorization_url is returned
            if 'authorization_url' in messages and 'state' in messages:
                request.session['state'] = messages['state']
                return redirect(messages['authorization_url'])
            
            context = {'messages': messages}
            return render(request, 'gmail.html', context)
        else:
            auth = google_auth()
            request.session['state'] = auth['state']
            request.session['oauth_scopes'] = auth.get('scopes', [])
            return redirect(auth['authorization_url'])

    return render(request, 'gmail.html')


def login_view(request):
    next_url = request.GET.get('next', 'google_api:gmail')
    request.session['oauth_redirect_url'] = next_url
    scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'openid',
    ]
    auth = google_auth(scopes=scopes)
    request.session['state'] = auth['state']
    request.session['oauth_scopes'] = scopes
    return redirect(auth['authorization_url'])


def audio(request):
    if request.method == 'GET':
        text = request.GET.get('text')
        filename = request.GET.get('filename')
        lang = request.GET.get('lang')
        audio_url = text_to_audio(text=text, lang=lang, filename=filename)
        
        # Return the audio URL as JSON response
        return JsonResponse({'audio_url': audio_url})
    else:
        # Return a 405 Method Not Allowed response for other request methods
        return JsonResponse({'error': 'Method Not Allowed'}, status=405)
