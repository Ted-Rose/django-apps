import base64
from email import policy
import json
from email.parser import BytesParser
from gtts import gTTS
from django.conf import settings
from django.shortcuts import redirect
import logging
import os
import requests as http_requests
from django.contrib.auth import get_user_model, login as auth_login
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
import re
from datetime import datetime, timedelta
from langdetect import detect, DetectorFactory, LangDetectException
from bs4 import BeautifulSoup
import tempfile
import google.auth
import google.auth.transport.requests
from typing import Optional
from google.cloud import storage

logger = logging.getLogger('django')

# We request tokens with include_granted_scopes='true' (incremental
# authorization), so Google may return more scopes than this flow asked
# for (e.g. a previously granted tasks scope). Without this, oauthlib
# raises a Warning on the scope change and the callback fails.
os.environ.setdefault('OAUTHLIB_RELAX_TOKEN_SCOPE', '1')

# Allow HTTP for local development (ONLY for development!)
# In production, always use HTTPS
os.environ.setdefault('OAUTHLIB_INSECURE_TRANSPORT', '1')

BASE_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]

# All scopes needed for the application
ALL_APP_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/tasks",
]


class AudioGenerationError(Exception):
    """Raised when audio generation fails"""
    pass


def _sanitize_text_for_audio(text: str) -> str:
    """
    Sanitize text for audio generation.

    Args:
        text: Raw text

    Returns:
        Sanitized text suitable for TTS
    """
    # Replace URLs with the word "web link"
    text = re.sub(r'https?://\S+', 'web link', text)

    # Remove long dashes
    text = re.sub(r'-{2,}', '', text)

    # Remove excessive whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def text_to_audio(
    text: str,
    lang: Optional[str] = None,
    filename: Optional[str] = None,
) -> str:
    """
    Generate audio from text and upload to GCS.

    Args:
        text: Text to convert to audio (max 5000 chars)
        lang: Language code (auto-detected if None)
        filename: Base filename without extension
                  (auto-generated if None)

    Returns:
        Signed GCS URL valid for 7 days

    Raises:
        AudioGenerationError: If audio generation or upload fails
        ValueError: If inputs are invalid
    """
    # Input validation
    if not text or not isinstance(text, str):
        raise ValueError("Text must be a non-empty string")

    if len(text) > 5000:
        raise ValueError("Text too long (max 5000 characters)")

    # Detect language
    DetectorFactory.seed = 0
    if lang is None:
        try:
            lang = detect(text)
            logger.info(f"Detected language: {lang}")
            # Sometimes English is mistaken as German or Danish
            if lang not in ['lv', 'en']:
                lang = 'en'
                logger.info("Defaulting to English")
        except LangDetectException as e:
            logger.warning(
                f"Language detection failed: {e}, "
                f"defaulting to English"
            )
            lang = 'en'

    # Sanitize text
    text = _sanitize_text_for_audio(text)

    # Generate unique filename (timestamp + microseconds avoids
    # collisions; no blob.exists() check needed)
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')
    if filename:
        # Sanitize to prevent path traversal
        safe_filename = "".join(
            c for c in str(filename)
            if c.isalnum() or c in ('-', '_')
        )
        unique_filename = f"{timestamp}_{safe_filename}.mp3"
    else:
        unique_filename = f"{timestamp}_message_audio.mp3"

    # Get GCS bucket
    bucket_name = os.environ.get('GCS_AUDIO_BUCKET')
    if not bucket_name:
        logger.error('GCS_AUDIO_BUCKET environment variable not set')
        raise AudioGenerationError('GCS storage not configured')

    try:
        # Refresh ADC credentials so access_token is current.
        # On Cloud Run there is no private key — signed URLs must
        # use the IAM signBlob API via service_account_email +
        # access_token.
        credentials, _ = google.auth.default()
        credentials.refresh(
            google.auth.transport.requests.Request()
        )

        storage_client = storage.Client(credentials=credentials)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(f"recordings/{unique_filename}")

        # Generate audio and upload via a temp file (gTTS needs a
        # path)
        audio = gTTS(text=text, lang=lang, slow=False)
        with tempfile.NamedTemporaryFile(
            suffix='.mp3', delete=False
        ) as tmp_file:
            tmp_path = tmp_file.name
            audio.save(tmp_path)

        try:
            blob.upload_from_filename(
                tmp_path,
                content_type='audio/mpeg',
                timeout=30,
            )
            logger.info(f'Uploaded audio to GCS: {unique_filename}')
        finally:
            os.unlink(tmp_path)

        # Generate signed URL valid for 7 days
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(days=7),
            method="GET",
            service_account_email=credentials.service_account_email,
            access_token=credentials.token,
        )

        return signed_url

    except Exception as e:
        logger.exception(f"Failed to generate audio: {e}")
        raise AudioGenerationError(f"Audio generation failed: {e}")


def extract_text_from_html(html_content):
    # Remove HTML comments
    html_content = re.sub(r'<!--(.*?)-->', '', html_content, flags=re.DOTALL)

    # Remove all HTML tags
    clean_text = re.sub(r'<.*?>', '', html_content, flags=re.DOTALL)

    # Normalize spaces and remove extra newlines
    clean_text = re.sub(r'\s+', ' ', clean_text)

    return clean_text.strip()


def get_user_credentials(user, scopes=None):
    """
    Get Google OAuth credentials for a user from the database.

    Args:
        user: Django User object
        scopes: Optional list of required scopes

    Returns:
        Credentials object if valid, None if missing or invalid
    """
    from google_api.models import GoogleOAuthCredentials

    try:
        oauth_creds = GoogleOAuthCredentials.objects.get(user=user)

        # Check if required scopes are granted
        if scopes and not oauth_creds.has_all_scopes(scopes):
            logger.warning(
                f'User {user.username} missing required scopes. '
                f'Required: {scopes}, Granted: {oauth_creds.scopes}'
            )
            return None

        client_secrets_path = getattr(
            settings, 'GOOGLE_APP_SECRETS_PATH',
            os.path.join(settings.BASE_DIR, 'google_api/app_secrets.json'),
        )
        with open(client_secrets_path, 'r') as file:
            data = json.load(file)

        client_id = data.get('web', {}).get('client_id')
        client_secret = data.get('web', {}).get('client_secret')
        token_uri = data.get('web', {}).get('token_uri')

        creds = Credentials(
            token=oauth_creds.access_token,
            refresh_token=oauth_creds.refresh_token,
            client_secret=client_secret,
            client_id=client_id,
            token_uri=token_uri,
            scopes=oauth_creds.scopes,
            expiry=oauth_creds.token_expiry,
        )

        # Refresh if expired
        if creds.expired and creds.refresh_token:
            logger.info(f'Refreshing expired token for user {user.username}')
            creds.refresh(Request())

            # Update database with new token
            oauth_creds.access_token = creds.token
            oauth_creds.token_expiry = creds.expiry
            oauth_creds.save()
            logger.info(f'Token refreshed for user {user.username}')

        return creds

    except GoogleOAuthCredentials.DoesNotExist:
        logger.info(f'No credentials found for user {user.username}')
        return None


def google_auth(creds=None, scopes=None, user=None):
    """
    Get or create Google OAuth credentials.

    Args:
        creds: Legacy session-based credentials dict (deprecated)
        scopes: List of OAuth scopes to request
        user: Django User object (preferred method)

    Returns:
        Credentials object or dict with authorization_url if reauth needed
    """
    if scopes is None:
        scopes = ["https://www.googleapis.com/auth/gmail.readonly"]
    scopes = list(set(scopes) | set(BASE_SCOPES))
    logger.info(f'google_auth called with scopes: {scopes}')

    client_secrets_path = getattr(
        settings, 'GOOGLE_APP_SECRETS_PATH',
        os.path.join(settings.BASE_DIR, 'google_api/app_secrets.json'),
    )
    with open(client_secrets_path, 'r') as file:
        data = json.load(file)

    client_id = data.get('web', {}).get('client_id')
    client_secret = data.get('web', {}).get('client_secret')
    token_uri = data.get('web', {}).get('token_uri')

    # Try to get credentials from database if user is provided
    if user and user.is_authenticated:
        db_creds = get_user_credentials(user, scopes)
        if db_creds and db_creds.valid:
            return db_creds
        # If credentials exist but scopes are missing, trigger reauth
        if db_creds is None:
            from google_api.models import GoogleOAuthCredentials
            try:
                oauth_creds = GoogleOAuthCredentials.objects.get(user=user)
                if not oauth_creds.has_all_scopes(scopes):
                    # Need to reauth for additional scopes
                    pass
            except GoogleOAuthCredentials.DoesNotExist:
                pass

    # Legacy session-based credentials support
    if creds:
        granted_scopes = set(creds.get('scopes', []))
        required_scopes = set(scopes)
        logger.info(f'Granted scopes: {granted_scopes}')
        logger.info(f'Required scopes: {required_scopes}')

        if not required_scopes.issubset(granted_scopes):
            logger.warning(
                f'Missing scopes: '
                f'{required_scopes - granted_scopes}. '
                f'Reauth required.'
            )
            creds = None
        else:
            logger.info('All required scopes are granted')
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
                # Set creds to None to ensure we run the OAuth flow
                creds = None
        if not creds or not creds.valid:
            flow = InstalledAppFlow.from_client_secrets_file(
                client_secrets_path,
                scopes,
                redirect_uri=f"{settings.BASE_URL}/google/callback"
            )
            authorization_url, state = flow.authorization_url(
                access_type='offline',
                include_granted_scopes='true',
                prompt='consent'
            )
            return {
                "authorization_url": authorization_url,
                "state": state,
                "scopes": scopes
            }

    return creds


def get_messages(query, creds):
    """
    Returns a list of Gmail messages / emails that match the query.
    """
    try:
        credentials = google_auth(creds)
        if (isinstance(credentials, dict) and
                'authorization_url' in credentials):
            return credentials

        service = build("gmail", "v1", credentials=credentials)
        results = (
            service.users().messages()
            .list(userId="me", q=query, maxResults=100)
            .execute()
        )
        messages = results.get("messages", [])

        message_details = []

        if not messages:
            print("No messages found.")
            return []

        for message in messages:
            message_id = message['id']
            msg = (
                service.users().messages()
                .get(userId="me", id=message_id, format='raw')
                .execute()
            )
            msg_str = base64.urlsafe_b64decode(
                msg['raw'].encode('ASCII')
            )
            mime_message = BytesParser(
                policy=policy.default
            ).parsebytes(msg_str)

            subject = mime_message['subject']
            sender = mime_message['from']

            body = None
            charset = mime_message.get_content_charset('utf-8')
            if mime_message.is_multipart():
                for part in mime_message.iter_parts():
                    content_type = part.get_content_type()
                    if content_type == 'text/plain':
                        body = (
                            part.get_payload(decode=True)
                            .decode(charset, errors='replace')
                        )
                        break
                    elif content_type == 'text/html':
                        html_content = (
                            part.get_payload(decode=True)
                            .decode(charset, errors='replace')
                        )
                        body = extract_text_from_html(html_content)
                        break
                if not body:
                    body = 'Multipart message without text part!'
            else:
                body = (
                    mime_message.get_payload(decode=True)
                    .decode(charset, errors='replace')
                )

            body = extract_text_from_html(body)
            if sender == "e-klase <notifikacijas@e-klase.lv>":
                # Extract subject using a regular expression
                subject_match = re.search(r"Tēma: (.*?)(?=No:)", body)
                if subject_match:
                    subject = subject_match.group(1).strip()

                # Extract main body content, excluding boilerplate
                body_pattern = (
                    r"Kam: ([\s\S]*?)(?=_______________________________"
                    r"________________Lai atbildētu vai pārsūtītu)"
                )
                body_match = re.search(body_pattern, body, re.DOTALL)
                if body_match:
                    body = body_match.group(1).strip()

                    # Remove any remaining HTML tags
                    soup = BeautifulSoup(body, 'html.parser')
                    body = soup.get_text(separator=' ')

                    # Remove extra whitespace
                    body = re.sub(r'\s+', ' ', body).strip()

                    body_start_pattern = (
                        r".*?Lai aplūkotu pielikumus, "
                        r"pieslēdzieties E-klasei\."
                    )
                    new_body = re.sub(
                        body_start_pattern, '', body, flags=re.DOTALL
                    )
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
    """
    OAuth callback handler.
    Saves credentials to database for long-term storage.
    """
    from google_api.models import GoogleOAuthCredentials

    if scopes is None:
        scopes = request.session.pop(
            'oauth_scopes',
            ["https://www.googleapis.com/auth/gmail.readonly"]
        )
    # Add BASE_SCOPES to match what google_auth requests
    scopes = list(set(scopes) | set(BASE_SCOPES))
    client_secrets_path = getattr(
        settings, 'GOOGLE_APP_SECRETS_PATH',
        os.path.join(settings.BASE_DIR, 'google_api/app_secrets.json'),
    )

    flow = InstalledAppFlow.from_client_secrets_file(
                client_secrets_path,
                scopes,
                redirect_uri=f"{settings.BASE_URL}/google/callback"
            )
    flow.fetch_token(authorization_response=request.build_absolute_uri())
    credentials = flow.credentials

    # Keep credentials in session for backward compatibility
    request.session['google_credentials'] = {
        'token': credentials.token,
        'refresh_token': credentials.refresh_token,
        'expiry': credentials.expiry.isoformat(),
        'scopes': list(credentials.scopes or []),
    }

    # Get or create user from Google userinfo
    user = None
    try:
        userinfo = http_requests.get(
            'https://www.googleapis.com/oauth2/v3/userinfo',
            headers={'Authorization': f'Bearer {credentials.token}'},
            timeout=5,
        ).json()
        email = userinfo.get('email', '')
        if email:
            User = get_user_model()
            username = email.split('@')[0][:150]
            user, created = User.objects.get_or_create(
                email=email,
                defaults={'username': username},
            )
            auth_login(
                request,
                user,
                backend='django.contrib.auth.backends.ModelBackend',
            )
            logger.info(
                f'User {user.username} logged in '
                f'({"created" if created else "existing"})'
            )
    except Exception:
        logger.exception('Failed to fetch Google userinfo in callback')

    # Save credentials to database for authenticated user
    if user:
        GoogleOAuthCredentials.objects.update_or_create(
            user=user,
            defaults={
                'access_token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_expiry': credentials.expiry,
                'scopes': list(credentials.scopes or []),
            }
        )
        logger.info(
            f'Saved credentials for user {user.username} '
            f'with scopes: {list(credentials.scopes or [])}'
        )

    redirect_url = request.session.pop(
        'oauth_redirect_url', 'google_tasks:dashboard'
    )

    # Remove sync parameter to prevent re-triggering OAuth loop
    if isinstance(redirect_url, str) and 'sync' in redirect_url:
        from urllib.parse import urlparse, parse_qs, urlencode, urlunparse
        parsed = urlparse(redirect_url)
        query_params = parse_qs(parsed.query)
        query_params.pop('sync', None)
        new_query = urlencode(query_params, doseq=True)
        redirect_url = urlunparse((
            parsed.scheme, parsed.netloc, parsed.path,
            parsed.params, new_query, parsed.fragment
        ))

    return redirect(redirect_url)
