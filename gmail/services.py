"""Gmail feature services — the "Gmail to audio" reader.

Extracted from google_api/utils.py in the app split (Stage 0 of the
google_api React rewrite): pure code motion, no behavior change.
Depends on google_api for the shared OAuth platform (`google_auth`)
— the platform never imports this module, so `ALL_APP_SCOPES` there
keeps these scope strings as literals.
"""
import base64
from email import policy
from email.parser import BytesParser
import logging
import re

from bs4 import BeautifulSoup
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from google_api.utils import google_auth

logger = logging.getLogger('django')

GMAIL_READONLY_SCOPE = (
    "https://www.googleapis.com/auth/gmail.readonly"
)
GMAIL_MODIFY_SCOPE = (
    "https://www.googleapis.com/auth/gmail.modify"
)


def _needs_reauth(error):
    """Whether an HttpError means the stored Google credentials need
    reauthorization: 401/403 (revoked token or missing scopes such
    as insufficientPermissions), not transient API failures."""
    return getattr(error.resp, 'status', None) in (401, 403)


def extract_text_from_html(html_content):
    # Remove HTML comments
    html_content = re.sub(r'<!--(.*?)-->', '', html_content, flags=re.DOTALL)

    # Remove all HTML tags
    clean_text = re.sub(r'<.*?>', '', html_content, flags=re.DOTALL)

    # Normalize spaces and remove extra newlines
    clean_text = re.sub(r'\s+', ' ', clean_text)

    return clean_text.strip()


def get_messages(query, creds):
    """
    Returns a list of Gmail messages / emails that match the query,
    or an auth dict if reauthorization is needed.
    """
    message_details = []
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

        if not messages:
            logger.info('No messages found.')
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
        logger.error(f'Gmail API error: {error}')
        if _needs_reauth(error):
            # Revoked token or missing scopes — bounce the user into
            # the OAuth flow the same way unusable credentials do.
            return google_auth(
                None, scopes=[GMAIL_READONLY_SCOPE]
            )
    return message_details


def mark_messages_as_read(creds, message_ids):
    """
    Remove the UNREAD label from the given Gmail messages.

    Requires the gmail.modify scope. Returns True on success, False on
    API error, or an auth dict if reauthorization is needed.
    """
    if not message_ids:
        return True

    credentials = google_auth(creds, scopes=[GMAIL_MODIFY_SCOPE])
    if (isinstance(credentials, dict) and
            'authorization_url' in credentials):
        return credentials

    service = build("gmail", "v1", credentials=credentials)
    try:
        # batchModify accepts up to 1000 ids per call
        for i in range(0, len(message_ids), 1000):
            service.users().messages().batchModify(
                userId="me",
                body={
                    'ids': message_ids[i:i + 1000],
                    'removeLabelIds': ['UNREAD'],
                },
            ).execute()
        logger.info(f'Marked {len(message_ids)} messages as read')
        return True
    except HttpError as error:
        logger.error(f'Gmail API error marking messages read: {error}')
        if _needs_reauth(error):
            return google_auth(None, scopes=[GMAIL_MODIFY_SCOPE])
        return False
