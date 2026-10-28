"""Master Cloud Run job: run the scheduled sub-commands in one pass.

Consolidates the per-task Cloud Run jobs + Cloud Scheduler triggers
into a single `all-jobs` job (cost: schedulers bill past the free
quota). Edit ONLY the JOBS list below — one line per sub-job, so an
entry can be commented out to disable it. Entries run sequentially,
in listed order, each via call_command; a failing entry is logged
and the pass continues, exiting non-zero at the end.

Schedules are evaluated against today's UTC date:
  daily               every day
  weekly:<mon..sun>   on that weekday
  dom:odd             on odd days of the month (cron */2 semantics)
  dom:N               on day-of-month N
  last_day_of_month   on the calendar month's last day
  manual              never in a normal pass; only via --only
"""
import calendar
import logging
from datetime import datetime, timezone

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from django_apps.sentry import capture_internal_exception

logger = logging.getLogger('django')


# label, argv, schedule — runs only when `schedule` matches today.
JOBS = [
    ("check_balance_alerts", [], "daily"),
    # Every entry below runs under the single all-jobs-daily
    # scheduler — adding one is free (no per-job Cloud Scheduler
    # triggers anymore). To disable a sub-job, comment it out:
    # ("sync_bank_transactions", [], "daily"),
    # ("evaluate_spending_limits", [], "daily"),
]


_WEEKDAYS = ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')


def _utc_today():
    return datetime.now(timezone.utc).date()


def scheduled_today(schedule, today):
    """True when `schedule` matches `today` (a UTC date)."""
    if schedule == 'daily':
        return True
    if schedule == 'manual':
        return False
    if schedule == 'last_day_of_month':
        last = calendar.monthrange(today.year, today.month)[1]
        return today.day == last
    if schedule == 'dom:odd':
        return today.day % 2 == 1
    if schedule.startswith('dom:') and schedule[4:].isdigit():
        day = int(schedule[4:])
        if not 1 <= day <= 31:
            raise CommandError(
                f'dom:N day-of-month out of range {schedule!r}'
            )
        return today.day == day
    if (
        schedule.startswith('weekly:')
        and schedule[7:] in _WEEKDAYS
    ):
        return today.weekday() == _WEEKDAYS.index(schedule[7:])
    raise CommandError(f'Unknown schedule {schedule!r}')


class Command(BaseCommand):
    help = (
        'Run the JOBS entries whose schedule matches today, in '
        'listed order — one execution of the all-jobs Cloud Run job.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--only',
            metavar='LABEL',
            help='Run just the named JOBS entry, ignoring its '
                 'schedule (the manual per-job trigger).',
        )
        parser.add_argument(
            '--force',
            action='store_true',
            help='Run every enabled JOBS entry, ignoring schedules.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would run today and exit.',
        )

    def handle(self, *args, **options):
        today = _utc_today()
        only = options['only']
        force = options['force'] or bool(only)
        dry_run = options['dry_run']

        jobs = list(JOBS)
        if only:
            jobs = [j for j in jobs if j[0] == only]
            if not jobs:
                raise CommandError(f'No JOBS entry named {only!r}')

        ran = failures = 0
        for label, argv, schedule in jobs:
            try:
                # Inside the try so a bad schedule spec fails only
                # this entry instead of aborting the whole pass.
                # Dry-run always evaluates the spec — even under
                # --force — so a broken spec still flags as a
                # failure below instead of printing RUN.
                if dry_run:
                    due = scheduled_today(schedule, today) or force
                    verdict = 'RUN' if due else 'SKIP'
                    self.stdout.write(
                        f'{verdict} {label} (schedule={schedule})'
                    )
                    ran += int(due)
                    continue
                due = force or scheduled_today(schedule, today)
                if not due:
                    self.stdout.write(
                        f'Skipping {label} (schedule={schedule})'
                    )
                    continue
                self.stdout.write(f'Running {label} ...')
                call_command(label, *argv)
            except (Exception, SystemExit) as exc:
                # SystemExit included so a sub-command calling
                # sys.exit() cannot kill the pass; a clean exit
                # (code 0 or None) is not a failure.
                if (
                    isinstance(exc, SystemExit)
                    and exc.code in (None, 0)
                ):
                    ran += 1
                    continue
                failures += 1
                logger.exception('run_all_jobs: %s failed', label)
                # Caught here so the pass continues — but then the
                # crash is invisible to DjangoIntegration, which
                # only sees uncaught exceptions. The all-jobs Cloud
                # Run job is the highest-value internal_error
                # source; no-op when Sentry is uninitialized.
                capture_internal_exception(exc)
                self.stderr.write(f'{label} failed — continuing')
            else:
                ran += 1

        skipped = len(jobs) - ran - failures
        verb = 'would run' if dry_run else 'ran'
        self.stdout.write(
            f'run_all_jobs done: {ran} {verb}, {skipped} skipped, '
            f'{failures} failed'
        )
        if failures:
            raise CommandError(f'{failures} job(s) failed')
