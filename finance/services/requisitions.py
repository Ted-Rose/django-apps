import logging

from django.utils import timezone

from finance.models import Requisition

logger = logging.getLogger('django')


def mark_requisition_dead(account, new_status):
    """Stamp ``account.requisition.status`` — the consent is dead.

    Every ``status='LN'`` filter then skips it, so dead consents
    are never retried. Idempotent: marking per-account across a
    multi-account requisition only writes and logs once — the
    conditional update wins even when sibling accounts hold stale
    in-memory requisition instances.
    """
    requisition = account.requisition
    if requisition.status == new_status:
        return
    updated = Requisition.objects.filter(
        pk=requisition.pk,
    ).exclude(
        status=new_status,
    ).update(status=new_status, updated_at=timezone.now())
    requisition.status = new_status
    if not updated:
        return
    logger.warning(
        'Requisition %s marked dead (%s) — bank must be relinked',
        requisition.requisition_id,
        new_status,
    )
