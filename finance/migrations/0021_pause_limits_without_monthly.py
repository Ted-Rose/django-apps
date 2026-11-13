from django.db import migrations


def pause_limits_without_monthly(apps, schema_editor):
    """Pause limits left windowless by the 7/30-day field removal.

    A limit whose only thresholds were the dropped rolling windows
    keeps is_active=True but can never trigger (the evaluator
    filters limit_monthly__isnull=False) — flip it to paused so the
    flag honestly reflects that nothing is alerting. Restoring is a
    one-click re-enable once a monthly threshold is set.
    """
    TransactionLimit = apps.get_model('finance', 'TransactionLimit')
    TransactionLimit.objects.filter(
        is_active=True,
        limit_monthly__isnull=True,
    ).update(is_active=False)


class Migration(migrations.Migration):

    dependencies = [
        (
            'finance',
            '0020_remove_transactionlimit_alerted_30d_at_and_more',
        ),
    ]

    operations = [
        # No reverse — pre-migration paused rows can't be told
        # apart from the ones this paused.
        migrations.RunPython(
            pause_limits_without_monthly,
            migrations.RunPython.noop,
        ),
    ]
