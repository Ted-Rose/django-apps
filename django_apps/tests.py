"""Tests for the per-user settings API (/api/me/) and the
build-time .po → .mo compile step used by job gettext."""
import json
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import TestCase

from django_apps.models import UserSettings, user_language


class MeApiTests(TestCase):
    URL = '/api/me/'

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='alice', password='pw'
        )

    def patch_json(self, payload):
        return self.client.patch(
            self.URL,
            data=json.dumps(payload),
            content_type='application/json',
        )

    def test_get_returns_username_and_default_language(self):
        self.client.force_login(self.user)
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            resp.json(),
            {'username': 'alice', 'language': 'en'},
        )

    def test_get_reads_stored_language(self):
        self.client.force_login(self.user)
        UserSettings.objects.create(user=self.user, language='lv')
        self.assertEqual(
            self.client.get(self.URL).json()['language'], 'lv'
        )

    def test_patch_persists_language_and_sets_cookie(self):
        self.client.force_login(self.user)
        resp = self.patch_json({'language': 'lv'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['language'], 'lv')
        self.assertEqual(
            UserSettings.objects.get(user=self.user).language, 'lv'
        )
        self.assertEqual(user_language(self.user), 'lv')
        self.assertEqual(
            resp.cookies[settings.LANGUAGE_COOKIE_NAME].value, 'lv'
        )

    def test_patch_updates_existing_settings_row(self):
        self.client.force_login(self.user)
        UserSettings.objects.create(user=self.user, language='lv')
        resp = self.patch_json({'language': 'en'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            UserSettings.objects.get(user=self.user).language, 'en'
        )

    def test_patch_rejects_unsupported_language(self):
        self.client.force_login(self.user)
        resp = self.patch_json({'language': 'xx'})
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(
            UserSettings.objects.filter(user=self.user).exists()
        )

    def test_unauthenticated_get_is_401(self):
        resp = self.client.get(self.URL)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.json()['error'], 'unauthenticated')


class CompilePoTests(TestCase):
    """compile_po turns committed .po sources into parseable .mo
    catalogs (msgfmt is absent on the build targets)."""

    def test_compiles_parseable_mo_files(self):
        import polib

        from django_apps.console_tasks.build import compile_po

        compile_po()
        for lang in ('en', 'lv'):
            mo_path = (
                Path(settings.BASE_DIR) / 'locale' / lang
                / 'LC_MESSAGES' / 'django.mo'
            )
            self.assertTrue(mo_path.exists(), mo_path)
            catalog = polib.mofile(str(mo_path))
            msgids = [entry.msgid for entry in catalog]
            if lang == 'lv':
                # en entries carry empty msgstrs (English IS the
                # msgid) so the en catalog compiles to no entries.
                self.assertIn('Spending limit exceeded', msgids)
