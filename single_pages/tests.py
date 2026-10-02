"""Tests for the single_pages API (/api/single_pages/) and the
post-cutover root-mounted routes."""
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlparse

import requests
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse

from google_api.utils import AudioGenerationError
from single_pages.services import SPOKI_URLS

API = '/api/single_pages'

SPOKI_HTML = (
    b'<html><head><title>t</title></head><body>'
    b'<a class="title">Funny article</a>'
    b'<article><p>Hello</p>'
    b'<script>alert(1)</script>'
    b'<img src="/x.png" onerror="steal()">'
    b'</article></body></html>'
)


def spoki_response(html=SPOKI_HTML):
    resp = Mock()
    resp.content = html
    resp.raise_for_status = Mock()
    return resp


class SinglePagesApiTests(TestCase):
    """The /api/single_pages/ contract: session auth, tts error
    mapping, spoki fetch + nh3 sanitization."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )
        self.client.force_login(self.user)

    # --- session auth contract ---

    def test_unauthenticated_get_is_401_not_redirect(self):
        self.client.logout()
        for url in (f'{API}/tts/?text=x', f'{API}/spoki/'):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 401)
            self.assertEqual(resp.json()['error'], 'unauthenticated')

    def test_401_login_url_points_at_spa_page(self):
        # spa_url_for collapses /api/single_pages/* to the SPA base
        # (/twister) — the login bounce must never send the user back
        # to a raw /api/ JSON URL.
        self.client.logout()
        resp = self.client.get(f'{API}/spoki/?x=1')
        login_url = urlparse(resp.json()['login_url'])
        self.assertEqual(login_url.path, '/admin/login/')
        self.assertEqual(
            parse_qs(login_url.query)['next'], ['/twister?x=1']
        )

    # --- tts ---

    def test_tts_returns_signed_url(self):
        with patch('single_pages.api.text_to_audio',
                   return_value='https://signed.example/x.mp3') as tts:
            resp = self.client.get(
                f'{API}/tts/?text=sveiki&filename=h&lang=lv'
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(), {'audio_url': 'https://signed.example/x.mp3'}
        )
        self.assertEqual(tts.call_args.kwargs['lang'], 'lv')

    def test_tts_value_error_is_400(self):
        with patch('single_pages.api.text_to_audio',
                   side_effect=ValueError('Text too long')):
            resp = self.client.get(f'{API}/tts/?text=x')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json()['error'], 'bad_request')

    def test_tts_pipeline_error_is_502(self):
        with patch('single_pages.api.text_to_audio',
                   side_effect=AudioGenerationError('no bucket')):
            resp = self.client.get(f'{API}/tts/?text=x')
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()['error'], 'upstream_error')

    # --- spoki ---

    def test_spoki_success_shape_and_sanitization(self):
        with patch('single_pages.services.requests.get',
                   return_value=spoki_response()):
            resp = self.client.get(f'{API}/spoki/')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body['title'], 'Funny article')
        self.assertIn(body['source_url'], SPOKI_URLS)
        # nh3.clean stripped the script tag and the onerror handler —
        # the SPA renders this html via dangerouslySetInnerHTML.
        self.assertIn('<p>Hello</p>', body['html'])
        self.assertNotIn('<script', body['html'])
        self.assertNotIn('alert(1)', body['html'])
        self.assertNotIn('onerror', body['html'])

    def test_spoki_missing_title_element(self):
        with patch('single_pages.services.requests.get',
                   return_value=spoki_response(b'<p>no title</p>')):
            resp = self.client.get(f'{API}/spoki/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['title'], '')

    def test_spoki_upstream_failure_is_502(self):
        with patch(
            'single_pages.services.requests.get',
            side_effect=requests.exceptions.ConnectionError('down'),
        ):
            resp = self.client.get(f'{API}/spoki/')
        self.assertEqual(resp.status_code, 502)
        self.assertEqual(resp.json()['error'], 'upstream_error')


class SinglePagesCutoverRouteTests(TestCase):
    """Post-cutover routing: /twister + /spoki/ serve the SPA shell,
    /app/* 301s to the root-level page paths (base='')."""

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )

    def test_page_names_reverse_to_spa(self):
        self.assertEqual(reverse('single_pages:twister'), '/twister')
        self.assertEqual(reverse('single_pages:spoki_page'), '/spoki/')

    def test_spa_mounts_serve_shell_for_authed_user(self):
        self.client.force_login(self.user)
        for url in ('/twister', '/spoki/'):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 200, url)
            self.assertTemplateUsed(resp, 'spa_shell.html')

    def test_spa_mounts_are_login_gated(self):
        for url in ('/twister', '/spoki/'):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 302, url)
            self.assertIn('/login/?next=', resp.url)

    def test_non_get_to_page_path_404s(self):
        self.client.force_login(self.user)
        for url in ('/twister', '/spoki/'):
            resp = self.client.post(url)
            self.assertEqual(resp.status_code, 404, url)

    # --- legacy /app/* strangler mount → 301 (base='') ---

    def test_app_subpath_redirects_to_root(self):
        resp = self.client.get('/app/twister')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/twister')

    def test_app_bare_redirects_to_home(self):
        for url in ('/app', '/app/'):
            resp = self.client.get(url)
            self.assertEqual(resp.status_code, 301, url)
            self.assertEqual(resp['Location'], '/')

    def test_app_redirect_preserves_query_string(self):
        resp = self.client.get('/app/spoki?x=1')
        self.assertEqual(resp.status_code, 301)
        self.assertEqual(resp['Location'], '/spoki?x=1')

    def test_app_redirect_is_anonymous_friendly(self):
        # No login bounce on the redirect itself — the destination
        # view enforces auth after the hop.
        resp = self.client.get('/app/twister')
        self.assertEqual(resp.status_code, 301)
