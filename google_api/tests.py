import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

from django.test import TestCase
from django.urls import reverse
from oauthlib.oauth2.rfc6749.errors import (
    AccessDeniedError,
    InvalidGrantError,
    MissingCodeError,
)

from google.oauth2 import service_account

from google_api.utils import (
    AUDIO_FILE_LIMIT,
    AUDIO_FILE_MAX_BYTES,
    text_to_audio,
)

CALLBACK_URL = '/google/callback'


@contextmanager
def fetch_token_raising(exc):
    """Patch the InstalledAppFlow that callback() builds so
    fetch_token() raises `exc`."""
    with patch('google_api.utils.InstalledAppFlow') as flow_cls:
        flow = flow_cls.from_client_secrets_file.return_value
        flow.fetch_token.side_effect = exc
        yield flow


class OAuthCallbackTests(TestCase):
    """GET /google/callback with no usable auth code must bounce back
    into the OAuth login flow, not 500 — production bug: oauthlib's
    MissingCodeError was uncaught (user denied consent, pressed back,
    or opened the URL directly)."""

    def assert_login_redirect(self, resp, next_url=None):
        self.assertEqual(resp.status_code, 302)
        parsed = urlparse(resp.url)
        self.assertEqual(parsed.path, reverse('google_api:login'))
        if next_url:
            self.assertEqual(
                parse_qs(parsed.query)['next'], [next_url]
            )
        else:
            self.assertEqual(parsed.query, '')

    def test_missing_code_redirects_to_login(self):
        with fetch_token_raising(MissingCodeError()):
            resp = self.client.get(CALLBACK_URL)
        self.assert_login_redirect(resp)

    def test_access_denied_redirects_to_login_with_next(self):
        # Google sends ?error=access_denied (no code) when the user
        # denies consent — restart OAuth, preserving the original
        # oauth_redirect_url as ?next=.
        session = self.client.session
        session['oauth_redirect_url'] = '/gmail/?query=is%3Aunread'
        session.save()
        with fetch_token_raising(AccessDeniedError()):
            resp = self.client.get(
                f'{CALLBACK_URL}?error=access_denied'
            )
        self.assert_login_redirect(
            resp, next_url='/gmail/?query=is%3Aunread'
        )

    def test_invalid_grant_redirects_to_login(self):
        # Consumed/expired code (e.g. callback URL reloaded) was
        # already handled — keep it working after the merge.
        with fetch_token_raising(InvalidGrantError()):
            resp = self.client.get(CALLBACK_URL)
        self.assert_login_redirect(resp)


@contextmanager
def audio_pipeline():
    """Patch the gTTS → GCS upload chain inside text_to_audio so it
    returns a fake signed URL without network access or GCP
    credentials. Yields the gTTS mock — its call kwargs carry the
    lang the audio would have been generated in."""
    with patch.dict(os.environ, {'GCS_AUDIO_BUCKET': 'bucket'}), \
            patch('google.auth.default') as adc, \
            patch('google_api.utils.storage.Client') as client_cls, \
            patch('google_api.utils.gTTS') as gtts:
        creds = Mock()
        creds.service_account_email = 'sa@example.com'
        creds.token = 'tok'
        adc.return_value = (creds, 'project')
        blob = (
            client_cls.return_value.bucket.return_value
            .blob.return_value
        )
        blob.exists.return_value = False
        blob.generate_signed_url.return_value = 'https://signed/x.mp3'
        yield gtts


class TextToAudioLanguageTests(TestCase):
    """text_to_audio detects language as an lv-vs-en argmax over
    detect_langs (the global winner over 55 profiles used to lose
    Latvian to fr/lt by a hair and fall back to 'en'), and detection
    runs on the sanitized text so URLs can't skew it."""

    @staticmethod
    def langs(*pairs):
        """detect_langs() result stand-ins: (lang, prob) tuples."""
        return [
            SimpleNamespace(lang=lang, prob=prob)
            for lang, prob in pairs
        ]

    def test_lv_runner_up_beats_fr_winner(self):
        # Production case: a Latvian-subject invoice detected
        # fr:0.57 with lv a close second — previously mapped to
        # 'en' by the whitelist fallback.
        with audio_pipeline() as gtts, \
                patch('google_api.utils.detect_langs',
                      return_value=self.langs(('fr', 0.57),
                                              ('lv', 0.43))):
            url = text_to_audio('Rēķins par pakalpojumu')
        self.assertEqual(url, 'https://signed/x.mp3')
        self.assertEqual(gtts.call_args.kwargs['lang'], 'lv')

    def test_en_when_lv_absent_from_candidates(self):
        with audio_pipeline() as gtts, \
                patch('google_api.utils.detect_langs',
                      return_value=self.langs(('de', 0.7),
                                              ('fr', 0.3))):
            text_to_audio('Some message')
        self.assertEqual(gtts.call_args.kwargs['lang'], 'en')

    def test_en_wins_when_it_outscores_lv(self):
        with audio_pipeline() as gtts, \
                patch('google_api.utils.detect_langs',
                      return_value=self.langs(('en', 0.8),
                                              ('lv', 0.2))):
            text_to_audio('hello there')
        self.assertEqual(gtts.call_args.kwargs['lang'], 'en')

    def test_explicit_lang_skips_detection(self):
        with audio_pipeline() as gtts, \
                patch('google_api.utils.detect_langs') as detect:
            text_to_audio('jebkurš teksts', lang='lv')
        detect.assert_not_called()
        self.assertEqual(gtts.call_args.kwargs['lang'], 'lv')

    def test_detection_runs_on_sanitized_text(self):
        # The URL must be gone before langdetect sees the text —
        # ASCII noise used to skew the n-gram scoring.
        seen = []

        def fake_detect_langs(text):
            seen.append(text)
            return self.langs(('en', 0.9), ('lv', 0.1))

        with audio_pipeline(), \
                patch('google_api.utils.detect_langs',
                      side_effect=fake_detect_langs):
            text_to_audio('See https://example.com/invoice.pdf now')
        self.assertEqual(seen, ['See web link now'])

    def test_url_only_text_does_not_crash_detection(self):
        # '-' and URLs sanitize away to nothing; langdetect raises
        # LangDetectException on empty input → 'en', no 500.
        with audio_pipeline() as gtts:
            url = text_to_audio('----- -----')
        self.assertEqual(url, 'https://signed/x.mp3')
        self.assertEqual(gtts.call_args.kwargs['lang'], 'en')

    def test_divider_runs_stripped_before_tts(self):
        # The e-klase '____' footer divider used to reach gTTS,
        # which spells out each underscore.
        with audio_pipeline() as gtts:
            text_to_audio(
                'Teksts ' + '_' * 50 + ' vēl teksts', lang='lv'
            )
        self.assertEqual(
            gtts.call_args.kwargs['text'], 'Teksts vēl teksts'
        )

    def test_image_placeholders_not_read_aloud(self):
        # Gmail text/plain parts keep '[image: name.jpg]' and
        # '[inline_image]' for inline images — gTTS used to read
        # the bracketed label aloud.
        with audio_pipeline() as gtts:
            text_to_audio(
                'See [image: photo.jpg] and [inline_image] here',
                lang='en',
            )
        self.assertEqual(
            gtts.call_args.kwargs['text'], 'See and here'
        )

    def test_emphasis_asterisks_stripped(self):
        # '*' in *emphasis* and '* bullet' lists reads aloud as
        # "asterisk".
        with audio_pipeline() as gtts:
            text_to_audio('a *bold* and * item', lang='en')
        self.assertEqual(
            gtts.call_args.kwargs['text'], 'a bold and item'
        )


class TextToAudioSigningTests(TestCase):
    """Signed URLs are generated via IAM signBlob when ADC has no
    private key (Cloud Run metadata server), but service-account-key
    creds (Vercel lambdas) sign locally — no signBlob args."""

    def test_service_account_key_signs_locally(self):
        sa_creds = Mock(spec=service_account.Credentials)
        with patch.dict(os.environ, {'GCS_AUDIO_BUCKET': 'bucket'}), \
                patch('google.auth.default',
                      return_value=(sa_creds, 'project')), \
                patch('google_api.utils.storage.Client') as client_cls, \
                patch('google_api.utils.gTTS'):
            blob = (
                client_cls.return_value.bucket.return_value
                .blob.return_value
            )
            blob.exists.return_value = False
            blob.generate_signed_url.return_value = \
                'https://signed/x.mp3'
            url = text_to_audio('sveiki', lang='lv')
        self.assertEqual(url, 'https://signed/x.mp3')
        kwargs = blob.generate_signed_url.call_args.kwargs
        self.assertNotIn('service_account_email', kwargs)
        self.assertNotIn('access_token', kwargs)

    def test_metadata_creds_sign_via_signblob(self):
        with patch.dict(os.environ, {'GCS_AUDIO_BUCKET': 'bucket'}), \
                patch('google.auth.default') as adc, \
                patch('google_api.utils.storage.Client') as client_cls, \
                patch('google_api.utils.gTTS'):
            creds = Mock()
            creds.service_account_email = 'sa@example.com'
            creds.token = 'tok'
            adc.return_value = (creds, 'project')
            blob = (
                client_cls.return_value.bucket.return_value
                .blob.return_value
            )
            blob.exists.return_value = False
            blob.generate_signed_url.return_value = \
                'https://signed/x.mp3'
            text_to_audio('hello', lang='en')
        kwargs = blob.generate_signed_url.call_args.kwargs
        self.assertEqual(
            kwargs['service_account_email'], 'sa@example.com'
        )
        self.assertEqual(kwargs['access_token'], 'tok')


class TextToAudioReuseTests(TestCase):
    """Filenames are content-addressed (lang + text hash): repeat
    requests for the same audio skip gTTS/upload and just re-sign
    the existing object — a retry after a timeout resumes instead
    of regenerating and orphaning the previous upload."""

    def test_existing_object_skips_generation(self):
        with patch.dict(os.environ, {'GCS_AUDIO_BUCKET': 'bucket'}), \
                patch('google.auth.default') as adc, \
                patch('google_api.utils.storage.Client') as client_cls, \
                patch('google_api.utils.gTTS') as gtts:
            adc.return_value = (Mock(), 'project')
            blob = (
                client_cls.return_value.bucket.return_value
                .blob.return_value
            )
            blob.exists.return_value = True
            blob.generate_signed_url.return_value = \
                'https://signed/existing.mp3'
            url = text_to_audio('sveiki', lang='lv')
        self.assertEqual(url, 'https://signed/existing.mp3')
        gtts.assert_not_called()
        blob.upload_from_filename.assert_not_called()

    def test_same_text_and_lang_produce_same_filename(self):
        with patch.dict(os.environ, {'GCS_AUDIO_BUCKET': 'bucket'}), \
                patch('google.auth.default') as adc, \
                patch('google_api.utils.storage.Client') as client_cls, \
                patch('google_api.utils.gTTS'):
            adc.return_value = (Mock(), 'project')
            blob = (
                client_cls.return_value.bucket.return_value
                .blob.return_value
            )
            blob.exists.return_value = False
            blob.generate_signed_url.return_value = 'https://signed/x'
            blob_cls = client_cls.return_value.bucket.return_value.blob
            text_to_audio('the same words', lang='en')
            text_to_audio('the same words', lang='en')
            text_to_audio('the same words', lang='lv')
        names = [c.args[0] for c in blob_cls.call_args_list]
        self.assertEqual(names[0], names[1])
        self.assertNotEqual(names[0], names[2])
        self.assertIn('recordings/message_audio_', names[0])


class TextToAudioLimitTests(TestCase):
    """After each upload the recordings/ prefix is capped at
    AUDIO_FILE_LIMIT objects — the oldest are deleted so the bucket
    stays inside the GCP free tier. Cleanup is best-effort: its
    failure must not break a generation that already succeeded."""

    @staticmethod
    def _blobs(count):
        """list_blobs() stand-ins, oldest first."""
        blobs = []
        for i in range(count):
            blob = Mock()
            blob.name = f'recordings/a_{i}.mp3'
            blob.time_created = datetime(
                2024, 1, 1, tzinfo=timezone.utc
            ) + timedelta(days=i)
            blobs.append(blob)
        return blobs

    @contextmanager
    def _pipeline(self):
        """audio_pipeline() variant that yields the bucket mock so
        list_blobs()/delete() can be stubbed and asserted on."""
        with patch.dict(os.environ, {'GCS_AUDIO_BUCKET': 'bucket'}), \
                patch('google.auth.default',
                      return_value=(Mock(), 'project')), \
                patch('google_api.utils.storage.Client') as cl, \
                patch('google_api.utils.gTTS'):
            bucket = cl.return_value.bucket.return_value
            blob = bucket.blob.return_value
            blob.exists.return_value = False
            blob.generate_signed_url.return_value = \
                'https://signed/x.mp3'
            yield bucket

    def test_oldest_deleted_when_limit_exceeded(self):
        with self._pipeline() as bucket:
            bucket.list_blobs.return_value = self._blobs(
                AUDIO_FILE_LIMIT + 2
            )
            url = text_to_audio('sveiki', lang='lv')
            deleted = [
                b.name for b in bucket.list_blobs.return_value
                if b.delete.called
            ]
        self.assertEqual(url, 'https://signed/x.mp3')
        self.assertEqual(
            deleted,
            ['recordings/a_0.mp3', 'recordings/a_1.mp3'],
        )

    def test_no_deletion_at_or_under_limit(self):
        with self._pipeline() as bucket:
            bucket.list_blobs.return_value = self._blobs(
                AUDIO_FILE_LIMIT
            )
            text_to_audio('sveiki', lang='lv')
            for blob in bucket.list_blobs.return_value:
                blob.delete.assert_not_called()

    def test_limit_not_checked_on_dedup_hit(self):
        # An existing object doesn't grow the bucket — skip the
        # listing entirely.
        with self._pipeline() as bucket:
            bucket.blob.return_value.exists.return_value = True
            url = text_to_audio('sveiki', lang='lv')
            bucket.list_blobs.assert_not_called()
        self.assertEqual(url, 'https://signed/x.mp3')

    def test_cleanup_failure_still_returns_url(self):
        with self._pipeline() as bucket:
            bucket.list_blobs.side_effect = Exception('listing boom')
            url = text_to_audio('sveiki', lang='lv')
        self.assertEqual(url, 'https://signed/x.mp3')

    def test_byte_cap_covers_max_input_at_real_bitrate(self):
        # gTTS renders ~64 kbps ≈ ~600 B/char of English measured —
        # the 1 MB cap silently rejected every render over ~1900
        # chars while the 5000-char input cap stayed legal.
        self.assertGreaterEqual(AUDIO_FILE_MAX_BYTES, 5000 * 600)

    def test_full_length_gmail_render_uploads(self):
        # The production failure: a 2333-char email rendered
        # 1,413,696 B — over the old 1 MB cap, under the new one.
        with self._pipeline() as bucket, \
                patch('google_api.utils.os.path.getsize',
                      return_value=1_413_696):
            url = text_to_audio('x' * 2333, lang='en')
        self.assertEqual(url, 'https://signed/x.mp3')
        bucket.blob.return_value \
            .upload_from_filename.assert_called_once()

    def test_oversized_render_rejected_before_upload(self):
        # A render over AUDIO_FILE_MAX_BYTES is a deterministic
        # ValueError (→ API 400), never an upload — a backstop
        # against pathological renders (the public /text-to-audio
        # endpoint it originally guarded is commented out).
        with self._pipeline() as bucket, \
                patch('google_api.utils.os.path.getsize',
                      return_value=AUDIO_FILE_MAX_BYTES + 1):
            with self.assertRaises(ValueError):
                text_to_audio('sveiki', lang='lv')
            bucket.blob.return_value \
                .upload_from_filename.assert_not_called()
