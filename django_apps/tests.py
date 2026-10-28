"""Tests for the per-user settings API (/api/me/), the
build-time .po → .mo compile step used by job gettext, and the
run_all_jobs master command."""
import json
from datetime import date
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase

from django_apps.management.commands.run_all_jobs import (
    JOBS,
    scheduled_today,
)
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


class RunAllJobsScheduleTests(SimpleTestCase):
    """Predicate math for run_all_jobs.scheduled_today."""

    def test_daily(self):
        self.assertTrue(
            scheduled_today('daily', date(2026, 10, 28))
        )

    def test_weekly_gates_on_weekday(self):
        # 2026-10-26 is a Monday, 2026-10-27 a Tuesday.
        self.assertTrue(
            scheduled_today('weekly:mon', date(2026, 10, 26))
        )
        self.assertFalse(
            scheduled_today('weekly:mon', date(2026, 10, 27))
        )
        self.assertTrue(
            scheduled_today('weekly:sun', date(2026, 11, 1))
        )

    def test_dom_odd(self):
        self.assertTrue(
            scheduled_today('dom:odd', date(2026, 10, 27))
        )
        self.assertFalse(
            scheduled_today('dom:odd', date(2026, 10, 28))
        )

    def test_dom_exact_day(self):
        self.assertTrue(
            scheduled_today('dom:15', date(2026, 10, 15))
        )
        self.assertFalse(
            scheduled_today('dom:15', date(2026, 10, 16))
        )

    def test_last_day_of_month(self):
        self.assertTrue(
            scheduled_today(
                'last_day_of_month', date(2026, 10, 31)
            )
        )
        self.assertFalse(
            scheduled_today(
                'last_day_of_month', date(2026, 10, 30)
            )
        )
        # February in a non-leap year.
        self.assertTrue(
            scheduled_today(
                'last_day_of_month', date(2026, 2, 28)
            )
        )
        # February in a leap year — only the 29th is the last
        # day.
        self.assertFalse(
            scheduled_today(
                'last_day_of_month', date(2028, 2, 28)
            )
        )
        self.assertTrue(
            scheduled_today(
                'last_day_of_month', date(2028, 2, 29)
            )
        )

    def test_dom_out_of_range_raises(self):
        for bad in ('dom:0', 'dom:32'):
            with self.subTest(schedule=bad):
                with self.assertRaises(CommandError):
                    scheduled_today(bad, date(2026, 10, 15))

    def test_manual_is_never_due(self):
        self.assertFalse(
            scheduled_today('manual', date(2026, 10, 28))
        )

    def test_unknown_schedule_raises(self):
        with self.assertRaises(CommandError):
            scheduled_today('fortnightly', date(2026, 10, 28))

    def test_every_jobs_entry_schedule_parses(self):
        # Guards the real JOBS list against typo'd schedule
        # specs — each must resolve without raising.
        for label, _argv, schedule in JOBS:
            with self.subTest(label=label):
                scheduled_today(schedule, date(2026, 10, 28))


class RunAllJobsCommandTests(SimpleTestCase):
    """--dry-run/--only/--force behavior of run_all_jobs; the
    inner call_command is mocked so no real sub-job runs."""

    MOD = 'django_apps.management.commands.run_all_jobs'

    def run_command(self, *argv):
        out = StringIO()
        call_command('run_all_jobs', *argv, stdout=out)
        return out.getvalue()

    def test_dry_run_lists_due_jobs_without_calling(self):
        with patch(f'{self.MOD}.call_command') as sub:
            output = self.run_command('--dry-run')
        sub.assert_not_called()
        self.assertIn('RUN check_balance_alerts', output)

    def test_dry_run_marks_off_day_entries_skip(self):
        # 2026-10-27 is a Tuesday — a weekly:mon entry is not due.
        with patch(
            f'{self.MOD}.JOBS', [('fake_job', [], 'weekly:mon')]
        ), patch(
            f'{self.MOD}._utc_today',
            return_value=date(2026, 10, 27),
        ), patch(f'{self.MOD}.call_command') as sub:
            output = self.run_command('--dry-run')
        sub.assert_not_called()
        self.assertIn('SKIP fake_job', output)

    def test_only_runs_named_job_ignoring_schedule(self):
        with patch(
            f'{self.MOD}.JOBS', [('fake_job', ['--x'], 'manual')]
        ), patch(f'{self.MOD}.call_command') as sub:
            self.run_command('--only', 'fake_job')
        sub.assert_called_once_with('fake_job', '--x')

    def test_only_unknown_label_errors(self):
        with self.assertRaises(CommandError):
            self.run_command('--only', 'nope')

    def test_force_runs_entries_regardless_of_schedule(self):
        with patch(
            f'{self.MOD}.JOBS',
            [('a', [], 'weekly:mon'), ('b', [], 'manual')],
        ), patch(f'{self.MOD}.call_command') as sub:
            self.run_command('--force')
        self.assertEqual(sub.call_count, 2)

    def test_failure_continues_and_exits_nonzero(self):
        with patch(
            f'{self.MOD}.JOBS',
            [('bad_job', [], 'daily'), ('good_job', [], 'daily')],
        ), patch(f'{self.MOD}.call_command') as sub:
            sub.side_effect = [Exception('boom'), None]
            with self.assertRaises(CommandError):
                self.run_command()
        # The second entry still ran after the first failed.
        self.assertEqual(sub.call_count, 2)

    def test_bad_schedule_fails_only_that_entry(self):
        with patch(
            f'{self.MOD}.JOBS',
            [
                ('bad_sched', [], 'weekly:monday'),
                ('good_job', [], 'daily'),
            ],
        ), patch(f'{self.MOD}.call_command') as sub:
            with self.assertRaises(CommandError):
                self.run_command()
        # The bad spec did not abort the pass.
        sub.assert_called_once_with('good_job')

    def test_sub_command_system_exit_continues(self):
        with patch(
            f'{self.MOD}.JOBS',
            [('exiting', [], 'daily'), ('ok', [], 'daily')],
        ), patch(f'{self.MOD}.call_command') as sub:
            sub.side_effect = [SystemExit(2), None]
            with self.assertRaises(CommandError):
                self.run_command()
        self.assertEqual(sub.call_count, 2)
