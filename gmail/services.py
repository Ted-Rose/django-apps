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

from gmail.models import EmailParsingRule
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
    """Reduce HTML to its visible text.

    BeautifulSoup's parser unescapes entities (&nbsp; and friends —
    the old regex tag-stripper left them literal for gTTS to read),
    and <style>/<script> elements are decomposed first so their CSS/
    JS contents don't leak into the text (real e-klase bodies start
    with a `<style>` block)."""
    soup = BeautifulSoup(html_content, 'html.parser')
    for tag in soup(['script', 'style']):
        tag.decompose()
    clean_text = soup.get_text(separator=' ')
    return re.sub(r'\s+', ' ', clean_text).strip()


def _collapse(text):
    return re.sub(r'\s+', ' ', text or '').strip()


def _decode_part(part):
    """The text of a body part, decoded with the part's OWN charset
    — decoding a Baltic windows-1257 part with the top-level utf-8
    charset produces \\ufffd mojibake that langdetect then pins to
    'en'. policy.default's get_content() applies the part charset
    with errors='replace'; the explicit payload decode is the
    fallback for payload oddities (e.g. an unknown charset raising
    LookupError)."""
    try:
        return part.get_content()
    except (LookupError, UnicodeError, ValueError):
        pass
    payload = part.get_payload(decode=True)
    if not isinstance(payload, bytes):
        return ''
    try:
        return payload.decode(
            part.get_content_charset() or 'utf-8', errors='replace'
        )
    except LookupError:
        return payload.decode('utf-8', errors='replace')


def _message_body(mime_message):
    """The message's display-text body.

    EmailMessage.get_body(('plain', 'html')) walks nested multiparts
    (multipart/mixed → multipart/alternative) and keeps the
    plain-before-html preference the old top-level iter_parts loop
    had — which it couldn't find, producing the English placeholder
    'Multipart message without text part!'. No text part → empty
    string (subject/sender are still read aloud)."""
    part = mime_message.get_body(('plain', 'html'))
    if part is None or part.get_content_maintype() != 'text':
        return ''
    text = _decode_part(part)
    if part.get_content_type() == 'text/html':
        return extract_text_from_html(text)
    return _collapse(text)


def _first_group(match):
    """The first capture group that participated — a pattern like
    '(foo)|(bar)' matching 'bar' leaves group(1) None, which the
    naive group(1).strip() AttributeError'd on (500ing the whole
    fetch). No participating group → the whole match."""
    for i in range(1, (match.lastindex or 0) + 1):
        value = match.group(i)
        if value is not None:
            return value.strip()
    return match.group(0).strip()


def _safe_search(pattern, text, rule_name):
    try:
        return re.search(pattern, text, re.DOTALL)
    except re.error as e:
        logger.warning(
            f'EmailParsingRule "{rule_name}" regex failed: {e}'
        )
        return None


def _safe_sub(pattern, body, rule_name):
    """re.sub guarded like _safe_search — plus TypeError, which a
    non-string JSON entry raises instead of re.error."""
    try:
        return re.sub(pattern, '', body, flags=re.DOTALL)
    except (re.error, TypeError) as e:
        logger.warning(
            f'EmailParsingRule "{rule_name}" strip pattern '
            f'failed: {e}'
        )
        return body


def _sender_matches(rule, sender):
    """Case-insensitive match of the raw From header — same
    contains/equals/starts_with/ends_with convention as
    finance.CategoryRule (the helper is duplicated because feature
    apps must not import each other)."""
    value = (sender or '').casefold()
    pattern = (rule.sender_pattern or '').casefold()
    if not pattern:
        return False
    if rule.sender_match_type == 'equals':
        return value == pattern
    if rule.sender_match_type == 'starts_with':
        return value.startswith(pattern)
    if rule.sender_match_type == 'ends_with':
        return value.endswith(pattern)
    return pattern in value


def _first_matching_rule(rules, sender):
    """First rule (the caller passes them in priority, pk order)
    whose sender pattern matches — first match wins."""
    for rule in rules or []:
        if _sender_matches(rule, sender):
            return rule
    return None


def _apply_rule(rule, subject, body):
    """Apply a matched EmailParsingRule to subject/body.

    subject_regex runs against the parsed body BEFORE body_regex
    replaces it (mirroring the e-klase parse, where 'Tēma:' lives in
    the body); each strip_patterns regex is re.sub'd out with
    DOTALL; whitespace is collapsed at the end."""
    body = body or ''
    if rule.subject_regex:
        match = _safe_search(rule.subject_regex, body, rule.name)
        if match:
            subject = _first_group(match)
    if rule.body_regex:
        match = _safe_search(rule.body_regex, body, rule.name)
        if match:
            body = _first_group(match)
    patterns = rule.strip_patterns or []
    if not isinstance(patterns, list):
        # A plain string in the JSONField would iterate
        # character-by-character and gut the body.
        logger.warning(
            f'EmailParsingRule "{rule.name}" strip_patterns is '
            f'not a list: {patterns!r}'
        )
        patterns = []
    for pattern in patterns:
        if not isinstance(pattern, str):
            logger.warning(
                f'EmailParsingRule "{rule.name}" skipping '
                f'non-string strip pattern: {pattern!r}'
            )
            continue
        body = _safe_sub(pattern, body, rule.name)
    return subject, _collapse(body)


def active_rules_for(user):
    """The user's active parsing rules, ordered for first-match
    evaluation (priority, then pk — like finance CategoryRule)."""
    return list(
        EmailParsingRule.objects
        .filter(user=user, is_active=True)
        .order_by('priority', 'pk')
    )


_EKLASE_SENDER = 'e-klase <notifikacijas@e-klase.lv>'
_EKLASE_SUBJECT_RE = r'Tēma: (.*?)(?=No:)'
_EKLASE_BODY_RE = r'Kam: ([\s\S]*?)(?=_+Lai atbildētu vai pārsūtītu)'
_EKLASE_STRIP_RE = (
    r'.*?Lai aplūkotu pielikumus, pieslēdzieties E-klasei\.'
)


def _eklase_fallback(sender, subject, body):
    """The hardcoded notifikacijas@e-klase.lv parse — the default
    path when no EmailParsingRule matched, so accounts without
    rules see identical behavior."""
    if sender != _EKLASE_SENDER:
        return subject, body

    # Extract subject using a regular expression
    subject_match = re.search(_EKLASE_SUBJECT_RE, body or '')
    if subject_match:
        subject = subject_match.group(1).strip()

    # Extract main body content, excluding boilerplate
    body_match = re.search(_EKLASE_BODY_RE, body or '', re.DOTALL)
    if body_match:
        body = body_match.group(1).strip()

        # Remove any remaining HTML tags + collapse whitespace
        body = extract_text_from_html(body)

        body = re.sub(_EKLASE_STRIP_RE, '', body, flags=re.DOTALL)
        body = body.strip()

    return subject, body


def get_messages(query, creds, rules=None):
    """
    Returns a list of Gmail messages / emails that match the query,
    or an auth dict if reauthorization is needed.

    ``rules`` is the user's active EmailParsingRules in (priority,
    pk) order (see ``active_rules_for``); after the generic MIME
    parse the first sender-matching rule applies, otherwise the
    hardcoded e-klase fallback runs. Each returned dict carries a
    ``lang`` hint = the matched rule's ``force_language`` (or None).
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
            body = _message_body(mime_message)

            rule = _first_matching_rule(rules, sender)
            if rule is not None:
                subject, body = _apply_rule(rule, subject, body)
                lang = rule.force_language or None
            else:
                subject, body = _eklase_fallback(sender, subject, body)
                lang = None

            message_details.append({
                'id': message_id,
                'subject': subject,
                'sender': sender,
                'body': body,
                'lang': lang,
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
