from django.db import migrations, models
from django.utils import timezone


def backfill_updated_at(apps, schema_editor):
    """Fill NULL updated_at values before making the field non-nullable."""
    GoogleTask = apps.get_model('google_tasks', 'GoogleTask')
    GoogleTask.objects.filter(updated_at__isnull=True).update(
        updated_at=timezone.now()
    )


def backfill_needs_push(apps, schema_editor):
    """Preserve dirty state under the old updated_at > last_synced_at logic."""
    GoogleTask = apps.get_model('google_tasks', 'GoogleTask')
    GoogleTask.objects.filter(
        models.Q(last_synced_at__isnull=True) |
        models.Q(updated_at__gt=models.F('last_synced_at'))
    ).update(needs_push=True)


class Migration(migrations.Migration):

    dependencies = [
        (
            'google_tasks',
            '0016_googletask_last_synced_at_'
            'googletask_updated_at_and_more'
        ),
    ]

    operations = [
        migrations.AddField(
            model_name='googletask',
            name='needs_push',
            field=models.BooleanField(
                default=False,
                help_text='Local changes pending push to Google Tasks'
            ),
        ),
        migrations.RunPython(
            backfill_updated_at,
            migrations.RunPython.noop
        ),
        migrations.AlterField(
            model_name='googletask',
            name='updated_at',
            field=models.DateTimeField(
                auto_now=True,
                help_text='When this task was last modified in our '
                          'database'
            ),
        ),
        migrations.RunPython(
            backfill_needs_push,
            migrations.RunPython.noop
        ),
    ]
