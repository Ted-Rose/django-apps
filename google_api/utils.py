import base64
from email import policy
import json
from email.parser import BytesParser
from gtts import gTTS
from django.conf import settings
from django.shortcuts import redirect
import logging
import os
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import re
from datetime import datetime
from google_api import views
from langdetect import detect, DetectorFactory
from bs4 import BeautifulSoup

logger = logging.getLogger('django')

def text_to_audio(text: str, lang: str = None, filename: str = None) -> str:
    DetectorFactory.seed = 0
    if lang is None:
        lang = detect(text)
        print("\n\n\nset lang to: ", lang)
        # Sometimes by mistake English is mistaken as German or Danish
        if lang not in ['lv', 'en']:
            lang = 'en'
    
    # Replace URLs with the word "web link"
    text = re.sub(r'https?://\S+', 'web link', text)
    # Remove long dashes
    text = re.sub(r'-{2,}', '', text)

    filename = 'message_audio.mp3' if filename is None else str(filename) + '.mp3'
    audio_file_path = os.path.join(settings.MEDIA_ROOT, "recordings", filename)
    
    # Check if the file already exists
    if not os.path.exists(audio_file_path):
        # If it doesn't exist, create the audio file
        audio = gTTS(text=text, lang=lang, slow=False)
        audio.save(audio_file_path)
    
    audio_url = settings.MEDIA_URL + 'recordings/' + filename
    return audio_url


def extract_text_from_html(html_content):
    # Remove HTML comments
    html_content = re.sub(r'<!--(.*?)-->', '', html_content, flags=re.DOTALL)
    
    # Remove all HTML tags
    clean_text = re.sub(r'<.*?>', '', html_content, flags=re.DOTALL)
    
    # Normalize spaces and remove extra newlines
    clean_text = re.sub(r'\s+', ' ', clean_text)
    
    return clean_text.strip()


def google_auth(creds=None, scopes=None):
    if scopes is None:
        scopes = ["https://www.googleapis.com/auth/gmail.readonly"]
    client_secrets_path = getattr(
        settings, 'GOOGLE_APP_SECRETS_PATH',
        os.path.join(settings.BASE_DIR, 'google_api/app_secrets.json'),
    )
    with open(client_secrets_path, 'r') as file:
        data = json.load(file)
    
    client_id = data.get('web', {}).get('client_id')
    client_secret = data.get('web', {}).get('client_secret')
    token_uri = data.get('web', {}).get('token_uri')
    
    if creds:
      creds = Credentials(
          token=creds['token'],
          refresh_token=creds['refresh_token'],
          client_secret=client_secret,
          client_id=client_id,
          token_uri=token_uri,
          scopes=scopes,
          expiry=datetime.fromisoformat(creds['expiry']),
      )

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            can_refresh = creds.expiry > datetime.today()
            if can_refresh:
                creds.refresh(Request())
            else:
                creds = None  # Set creds to None to ensure we run the OAuth flow
        if not creds or not creds.valid:
            flow = InstalledAppFlow.from_client_secrets_file(
                client_secrets_path,
                scopes,
                redirect_uri = f"{settings.BASE_URL}/google/callback"
            )
            authorization_url, state  = flow.authorization_url(
                access_type='offline',
                include_granted_scopes='true'
            )
            return {"authorization_url": authorization_url, "state": state, "scopes": scopes}
  
    return creds


def get_messages(query, creds):
    """
    Returns a list of Gmail messages / emails that match the query.
    """
    try:
        credentials = google_auth(creds)
        if isinstance(credentials, dict) and 'authorization_url' in credentials:
          return credentials

        service = build("gmail", "v1", credentials=credentials)
        results = service.users().messages().list(userId="me", q=query, maxResults=100).execute()
        messages = results.get("messages", [])
        
        message_details = []

        if not messages:
            print("No messages found.")
            return
        
        for message in messages:
            message_id = message['id']
            msg = service.users().messages().get(userId="me", id=message_id, format='raw').execute()
            msg_str = base64.urlsafe_b64decode(msg['raw'].encode('ASCII'))
            mime_message = BytesParser(policy=policy.default).parsebytes(msg_str)

            subject = mime_message['subject']
            sender = mime_message['from']

            body = None
            charset = mime_message.get_content_charset('utf-8')
            if mime_message.is_multipart():
                for part in mime_message.iter_parts():
                    if part.get_content_type() == 'text/plain':
                        body = part.get_payload(decode=True).decode(charset, errors='replace')
                        break
                    elif part.get_content_type() == 'text/html':
                        body = extract_text_from_html(part.get_payload(decode=True).decode(charset, errors='replace'))
                        break
                if not body:
                    body = 'Multipart message without text part!'
            else:
                body = mime_message.get_payload(decode=True).decode(charset, errors='replace')
            
            body = extract_text_from_html(body)
            if sender == "e-klase <notifikacijas@e-klase.lv>":
                # Extract subject using a regular expression
                subject_match = re.search(r"Tēma: (.*?)(?=No:)", body)
                if subject_match:
                    subject = subject_match.group(1).strip()

                # Extract the main body content, excluding boilerplate, subject, and recipient info
                body_pattern = r"Kam: ([\s\S]*?)(?=_______________________________________________Lai atbildētu vai pārsūtītu)"
                body_match = re.search(body_pattern, body, re.DOTALL)
                if body_match:
                    body = body_match.group(1).strip()

                    # Remove any remaining HTML tags
                    soup = BeautifulSoup(body, 'html.parser')
                    body = soup.get_text(separator=' ')

                    # Remove extra whitespace
                    body = re.sub(r'\s+', ' ', body).strip()

                    body_start_pattern = r".*?Lai aplūkotu pielikumus, pieslēdzieties E-klasei\."
                    new_body = re.sub(body_start_pattern, '', body, flags=re.DOTALL)
                    body = new_body.strip()

            message_details.append({
                'id': message_id,
                'subject': subject,
                'sender': sender,
                'body': body
            })

    except HttpError as error:
        # Handle errors from Gmail API.
        print(f"An error occurred: {error}")
    
    return message_details


def build_google_service(service_name, version, creds, scopes=None):
    """
    Generic service builder for Google APIs.
    Args:
        service_name: e.g., 'gmail', 'tasks'
        version: e.g., 'v1'
        creds: credentials dict or Credentials object
        scopes: list of OAuth scopes
    Returns:
        Google API service object or auth dict if reauth needed
    """
    credentials = google_auth(creds, scopes)
    if isinstance(credentials, dict) and 'authorization_url' in credentials:
        return credentials
    return build(service_name, version, credentials=credentials)


def callback(request, scopes=None):
    if scopes is None:
        scopes = ["https://www.googleapis.com/auth/gmail.readonly"]
    client_secrets_path = getattr(
        settings, 'GOOGLE_APP_SECRETS_PATH',
        os.path.join(settings.BASE_DIR, 'google_api/app_secrets.json'),
    )

    flow = InstalledAppFlow.from_client_secrets_file(
                client_secrets_path,
                scopes,
                redirect_uri = f"{settings.BASE_URL}/google/callback"
            )
    flow.fetch_token(authorization_response=request.build_absolute_uri())
    credentials = flow.credentials
    request.session['google_credentials'] = {
        'token': credentials.token,
        'refresh_token': credentials.refresh_token,
        'expiry': credentials.expiry.isoformat()
    }

    redirect_url = request.session.pop('oauth_redirect_url', 'google_api:gmail')
    return redirect(redirect_url)
