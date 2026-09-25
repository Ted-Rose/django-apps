"""Web Push delivery for spending-limit alerts.

Each user's browsers register a ``PushSubscription`` row; alerts are
fanned out to all of them via ``pywebpush`` using the VAPID keys from
settings. Empty ``VAPID_PRIVATE_KEY`` disables the feature entirely —
the sender is then a no-op.
"""
import json
import logging

from django.conf import settings
from pywebpush import WebPushException, webpush

logger = logging.getLogger('django')


def send_limit_alert(user, title, body, url):
    """Push a notification to every subscribed browser of ``user``."""
    private_key = getattr(settings, 'VAPID_PRIVATE_KEY', '')
    if not private_key:
        logger.debug(
            'VAPID_PRIVATE_KEY not set - skipping push alert '
            'for user=%s', user.username,
        )
        return

    payload = json.dumps({'title': title, 'body': body, 'url': url})
    for subscription in user.push_subscriptions.all():
        try:
            webpush(
                subscription_info={
                    'endpoint': subscription.endpoint,
                    'keys': {
                        'p256dh': subscription.p256dh,
                        'auth': subscription.auth,
                    },
                },
                data=payload,
                vapid_private_key=private_key,
                vapid_claims={'sub': settings.VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status = (
                exc.response.status_code if exc.response is not None
                else None
            )
            # 404/410: subscription gone on the push service.
            # 403: subscription was created under a different VAPID
            # key — it can never succeed with the current keypair.
            if status in (403, 404, 410):
                pk = subscription.pk
                subscription.delete()
                logger.info(
                    'Dropped stale push subscription %s for user=%s '
                    '(push service returned %s)',
                    pk, user.username, status,
                )
            else:
                logger.warning(
                    'Push to subscription %s failed for user=%s: %s',
                    subscription.pk, user.username, exc,
                )
        except Exception:
            # e.g. network errors or a malformed VAPID key — log and
            # keep going so one bad subscription can't abort the run.
            logger.exception(
                'Push to subscription %s failed for user=%s',
                subscription.pk, user.username,
            )
