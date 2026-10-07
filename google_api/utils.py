import json
from gtts import gTTS
from django.conf import settings
from django.shortcuts import redirect
import logging
import os
import requests as http_requests
from django.contrib.auth import get_user_model, login as auth_login
from django.core.exceptions import ImproperlyConfigured
from django.urls import reverse
from urllib.parse import quote
from google.auth.exceptions import RefreshError
from oauthlib.oauth2.rfc6749.errors import (
    AccessDeniedError,
    InvalidGrantError,
    MissingCodeError,
)
from google.auth.transport.requests import Request
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
import re
from datetime import datetime, timedelta, timezone as dt_timezone
from langdetect import (
    DetectorFactory,
    LangDetectException,
    detect_langs,
)
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

# All scopes needed for the application. Feature-app scope constants
# live in their own <feature>/services.py (e.g. gmail.services) but are
# duplicated here as literals on purpose — the platform must not import
# feature apps (dependency direction: gmail → google_api, never back).
ALL_APP_SCOPES = [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.modify",
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

    # Sanitize BEFORE detecting — URLs and other ASCII noise skew
    # langdetect's n-gram scoring (sanitized text is also what gTTS
    # gets, so detection sees exactly what is read aloud).
    text = _sanitize_text_for_audio(text)

    # Detect language. The audio only ever plays 'lv' or 'en', so
    # instead of trusting detect()'s global winner over 55 profiles
    # (Latvian mail regularly loses by a hair to lt/fr/de and used
    # to fall back to 'en'), pick the higher-probability of the two.
    DetectorFactory.seed = 0
    if lang is None:
        try:
            probs = {p.lang: p.prob for p in detect_langs(text)}
            lang = 'lv' if probs.get('lv', 0) > probs.get('en', 0) \
                else 'en'
            logger.info(f"Detected language: {lang} ({probs})")
        except LangDetectException as e:
            logger.warning(
                f"Language detection failed: {e}, "
                f"defaulting to English"
            )
            lang = 'en'

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

        # Generate signed URL valid for 7 days. Service-account-key
        # creds (Vercel lambdas) carry a private key and sign locally;
        # Cloud Run metadata-server creds have none, so signing goes
        # through the IAM signBlob API instead.
        sign_kwargs = {}
        if not isinstance(credentials, service_account.Credentials):
            sign_kwargs = {
                'service_account_email':
                    credentials.service_account_email,
                'access_token': credentials.token,
            }
        signed_url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(days=7),
            method="GET",
            **sign_kwargs,
        )

        return signed_url

    except Exception as e:
        logger.exception(f"Failed to generate audio: {e}")
        raise AudioGenerationError(f"Audio generation failed: {e}")


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

        # Google Auth library expects NAIVE UTC datetimes, not aware!
        # Convert timezone-aware datetime to naive UTC
        token_expiry = oauth_creds.token_expiry
        if token_expiry:
            is_aware = (
                token_expiry.tzinfo is not None and
                token_expiry.tzinfo.utcoffset(token_expiry) is not None
            )
            if is_aware:
                logger.info(
                    f'Converting timezone-aware to naive UTC for '
                    f'user {user.username}. tzinfo={token_expiry.tzinfo}'
                )
                # Convert to UTC and remove timezone info
                token_expiry = token_expiry.astimezone(dt_timezone.utc)
                token_expiry = token_expiry.replace(tzinfo=None)
            else:
                logger.info(
                    f'token_expiry already naive for user '
                    f'{user.username}'
                )

        tzinfo_str = (
            token_expiry.tzinfo if token_expiry else None
        )
        logger.info(
            f'Creating Credentials for {user.username} with '
            f'expiry={token_expiry}, tzinfo={tzinfo_str}'
        )

        creds = Credentials(
            token=oauth_creds.access_token,
            refresh_token=oauth_creds.refresh_token,
            client_secret=client_secret,
            client_id=client_id,
            token_uri=token_uri,
            scopes=oauth_creds.scopes,
            expiry=token_expiry,
        )

        # Double-check: creds.expiry should be naive UTC
        creds_is_aware = (
            creds.expiry and
            creds.expiry.tzinfo is not None and
            creds.expiry.tzinfo.utcoffset(creds.expiry) is not None
        )
        if creds_is_aware:
            logger.warning(
                'Credentials object has timezone-aware expiry! '
                f'Converting to naive UTC. expiry={creds.expiry}'
            )
            # Convert to naive UTC
            creds.expiry = creds.expiry.astimezone(dt_timezone.utc)
            creds.expiry = creds.expiry.replace(tzinfo=None)

        # Refresh if expired - wrap in try/except to catch timezone errors
        try:
            is_expired = creds.expired
        except TypeError as e:
            if 'offset-naive and offset-aware' in str(e):
                logger.error(
                    f'TypeError when checking creds.expired: {e}. '
                    f'creds.expiry={creds.expiry}, '
                    f'tzinfo={creds.expiry.tzinfo if creds.expiry else None}'
                )
                # Convert to naive UTC and try again
                if creds.expiry:
                    if creds.expiry.tzinfo:
                        creds.expiry = creds.expiry.astimezone(
                            dt_timezone.utc
                        )
                    creds.expiry = creds.expiry.replace(tzinfo=None)
                    is_expired = creds.expired
                else:
                    is_expired = True
            else:
                raise

        if is_expired and creds.refresh_token:
            logger.info(f'Refreshing expired token for user {user.username}')
            try:
                creds.refresh(Request())
            except RefreshError as e:
                logger.warning(
                    f'Token refresh failed for user {user.username}: '
                    f'{e}. Re-authentication required.'
                )
                return None

            # Update database with new token
            # Google returns naive UTC, Django needs timezone-aware
            refreshed_expiry = creds.expiry
            if refreshed_expiry:
                if refreshed_expiry.tzinfo is None:
                    # Naive datetime from Google, assume UTC
                    refreshed_expiry = refreshed_expiry.replace(
                        tzinfo=dt_timezone.utc
                    )

            oauth_creds.access_token = creds.token
            oauth_creds.token_expiry = refreshed_expiry
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
            # Parse expiry - Google Auth library expects NAIVE UTC
            expiry = datetime.fromisoformat(creds['expiry'])
            # Convert to naive UTC if timezone-aware
            if expiry.tzinfo is not None:
                expiry = expiry.astimezone(dt_timezone.utc)
                expiry = expiry.replace(tzinfo=None)

            creds = Credentials(
                token=creds['token'],
                refresh_token=creds['refresh_token'],
                client_secret=client_secret,
                client_id=client_id,
                token_uri=token_uri,
                scopes=scopes,
                expiry=expiry,
            )

    # Check if credentials are valid - wrap in try/except for timezone
    try:
        is_valid = creds and creds.valid
    except TypeError as e:
        if 'offset-naive and offset-aware' in str(e):
            logger.error(
                f'TypeError when checking creds.valid: {e}. '
                f'Fixing expiry to naive UTC'
            )
            if creds and creds.expiry:
                if creds.expiry.tzinfo:
                    creds.expiry = creds.expiry.astimezone(dt_timezone.utc)
                creds.expiry = creds.expiry.replace(tzinfo=None)
            is_valid = creds and creds.valid
        else:
            raise

    if not is_valid:
        if creds and creds.expired and creds.refresh_token:
            # creds.expiry is naive UTC; timezone.now() is aware -
            # compare against naive UTC to avoid TypeError.
            now_naive_utc = datetime.now(
                dt_timezone.utc
            ).replace(tzinfo=None)
            can_refresh = creds.expiry > now_naive_utc
            if can_refresh:
                creds.refresh(Request())
            else:
                # Set creds to None to ensure we run the OAuth flow
                creds = None
        if not creds or not creds.valid:
            if not settings.BASE_URL:
                # Empty BASE_URL produces a relative redirect_uri
                # ('/google/callback') which Google rejects with an
                # opaque 'invalid_request' error.
                raise ImproperlyConfigured(
                    'BASE_URL is not set - configure APP_BASE_URL '
                    '(env var or private_settings.json) with the '
                    'full site URL, e.g. https://example.com'
                )
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
    default_path = os.path.join(
        settings.BASE_DIR, 'google_api/app_secrets.json'
    )
    client_secrets_path = getattr(
        settings, 'GOOGLE_APP_SECRETS_PATH', default_path
    )

    redirect_uri = f"{settings.BASE_URL}/google/callback"
    flow = InstalledAppFlow.from_client_secrets_file(
        client_secrets_path,
        scopes,
        redirect_uri=redirect_uri
    )
    try:
        flow.fetch_token(
            authorization_response=request.build_absolute_uri()
        )
    except (
        AccessDeniedError,
        InvalidGrantError,
        MissingCodeError,
    ) as e:
        # Auth code already consumed or expired (e.g. the callback
        # URL was reloaded), consent denied (?error=access_denied),
        # or no code at all (back button / direct hit) — restart the
        # OAuth flow instead of a 500.
        logger.warning(
            f'OAuth callback failed ({e.error}); '
            'redirecting to login'
        )
        login_url = reverse('google_api:login')
        next_url = request.session.get('oauth_redirect_url')
        if next_url:
            login_url = f'{login_url}?next={quote(next_url)}'
        return redirect(login_url)
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
        # Ensure expiry is timezone-aware
        expiry = credentials.expiry
        expiry_is_naive = (
            expiry and (
                expiry.tzinfo is None or
                expiry.tzinfo.utcoffset(expiry) is None
            )
        )
        if expiry_is_naive:
            logger.warning(
                'Callback received naive expiry datetime, '
                'converting to UTC'
            )
            expiry = expiry.replace(tzinfo=dt_timezone.utc)

        GoogleOAuthCredentials.objects.update_or_create(
            user=user,
            defaults={
                'access_token': credentials.token,
                'refresh_token': credentials.refresh_token,
                'token_expiry': expiry,
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
