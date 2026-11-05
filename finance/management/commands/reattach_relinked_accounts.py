import logging

from django.core.management.base import BaseCommand

from finance.models import Account, Requisition
from finance.services.gocardless import (
    GoCardlessClient,
    GoCardlessError,
)
from finance.services.requisitions import mark_requisition_dead

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = (
        'Reattach Account rows stranded on dead (non-LN) '
        'requisitions. Some institutions (e.g. Swedbank) return '
        'stable GoCardless account ids across relinks, so a '
        'relink under a new LN requisition lists ids already '
        'stored locally — the callback reattaches them going '
        'forward, and this command repairs rows stranded before '
        'that fix so LN-scoped fetch jobs pick them up again. '
        'Run once post-deploy; safe to re-run (idempotent).'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Log the reattachments without writing.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        client = GoCardlessClient()

        # Newest first: when two live requisitions list the same
        # id, the newest one wins the reattach.
        requisitions = Requisition.objects.filter(
            status='LN'
        ).order_by('-created_at', '-id')

        total = 0
        for requisition in requisitions:
            try:
                data = client.get_requisition_data(
                    requisition.requisition_id
                )
            except GoCardlessError as exc:
                logger.error(
                    'Could not fetch requisition %s: %s — '
                    'skipping it',
                    requisition.requisition_id, exc,
                )
                dead = exc.dead_requisition_status
                if dead is not None:
                    self._stamp_status(requisition, dead, dry_run)
                continue
            status = data.get('status', requisition.status)
            if status != 'LN':
                # The local LN stamp is stale — the fresh fetch
                # says the consent is dead. Persist it like
                # ``requisition_callback`` does and skip.
                logger.info(
                    'Requisition %s is no longer linked '
                    '(status %s) — skipping it%s',
                    requisition.requisition_id, status,
                    ' [dry-run]' if dry_run else '',
                )
                self._stamp_status(requisition, status, dry_run)
                continue
            for account_id in data.get('accounts', []):
                total += self._reattach(
                    requisition, account_id, dry_run
                )

        logger.info(
            'Reattach complete: %d account(s) repointed%s',
            total, ' [dry-run]' if dry_run else '',
        )
        self.stdout.write(
            f'Reattach complete: {total} account(s) repointed'
            f'{" (dry run)" if dry_run else ""}'
        )

    def _stamp_status(self, requisition, new_status, dry_run):
        """Persist a fresh non-LN ``new_status`` on the local
        row — the same stamp ``requisition_callback`` performs.
        Routes through ``mark_requisition_dead`` when a local
        account exists (it takes an account, not a
        requisition); account-less requisitions are saved
        directly."""
        if dry_run or requisition.status == new_status:
            return
        account = requisition.accounts.first()
        if account is not None:
            mark_requisition_dead(account, new_status)
        else:
            requisition.status = new_status
            requisition.save(
                update_fields=['status', 'updated_at']
            )
            logger.warning(
                'Requisition %s marked dead (%s) — bank must '
                'be relinked',
                requisition.requisition_id, new_status,
            )
        requisition.status = new_status

    def _reattach(self, requisition, account_id, dry_run):
        """Repoint one stranded row to ``requisition``; 1 when the
        row qualified, else 0."""
        account = Account.objects.filter(
            account_id=account_id
        ).select_related('requisition').first()
        if (
            account is None
            or account.requisition_id == requisition.id
            or account.requisition.status == 'LN'
        ):
            return 0
        if (
            account.owner_id != requisition.user_id
            or account.institution_id != requisition.institution_id
        ):
            logger.warning(
                'Account pk %s (%s) is stranded on requisition %s '
                'but its owner/institution do not match '
                'requisition %s — skipping it',
                account.pk, account.account_id,
                account.requisition.requisition_id,
                requisition.requisition_id,
            )
            return 0
        logger.info(
            'Reattaching account pk %s (%s) from dead '
            'requisition %s to LN requisition %s%s',
            account.pk, account.account_id,
            account.requisition.requisition_id,
            requisition.requisition_id,
            ' [dry-run]' if dry_run else '',
        )
        if not dry_run:
            account.requisition = requisition
            account.save(update_fields=['requisition'])
        return 1
