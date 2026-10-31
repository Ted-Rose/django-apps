import logging

logger = logging.getLogger('django')


def mark_requisition_dead(account, new_status):
    """Stamp ``account.requisition.status`` — the consent is dead.

    Every ``status='LN'`` filter then skips it, so dead consents
    are never retried. Idempotent: marking per-account across a
    multi-account requisition only writes and logs once.
    """
    requisition = account.requisition
    if requisition.status == new_status:
        return
    requisition.status = new_status
    requisition.save(update_fields=['status', 'updated_at'])
    logger.warning(
        'Requisition %s marked dead (%s) — bank must be relinked',
        requisition.requisition_id,
        new_status,
    )
