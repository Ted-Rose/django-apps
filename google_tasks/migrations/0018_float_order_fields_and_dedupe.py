from django.db import migrations, models

import google_tasks.models


def dedupe_order_fields(apps, schema_editor):
    """Give every task a distinct position (data-level dedupe).

    Prepares the data for the unique constraints that a follow-up
    migration adds in step 2 of the rollout.

    Per user: renumber task_order to 1.0 ... n ordered by
    (task_order, updated); same for starred_order on starred rows;
    NULL out starred_order on non-starred rows.
    """
    GoogleTask = apps.get_model('google_tasks', 'GoogleTask')

    user_ids = GoogleTask.objects.values_list(
        'user_id', flat=True
    ).distinct()

    for user_id in user_ids:
        tasks = GoogleTask.objects.filter(user_id=user_id).order_by(
            'task_order', 'updated', 'pk'
        )
        for idx, task in enumerate(tasks, start=1):
            if task.task_order != float(idx):
                GoogleTask.objects.filter(pk=task.pk).update(
                    task_order=float(idx)
                )

        starred = GoogleTask.objects.filter(
            user_id=user_id, is_starred=True
        ).order_by('starred_order', 'updated', 'pk')
        for idx, task in enumerate(starred, start=1):
            if task.starred_order != float(idx):
                GoogleTask.objects.filter(pk=task.pk).update(
                    starred_order=float(idx)
                )

    GoogleTask.objects.filter(is_starred=False).update(
        starred_order=None
    )


class Migration(migrations.Migration):

    dependencies = [
        ('google_tasks', '0017_googletask_needs_push_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='googletask',
            name='task_order',
            field=models.FloatField(
                default=google_tasks.models.get_unix_timestamp,
                help_text='Manual ordering for tasks in task list view'
            ),
        ),
        migrations.AlterField(
            model_name='googletask',
            name='starred_order',
            field=models.FloatField(
                blank=True,
                help_text='Manual ordering for starred tasks in '
                          'starred view',
                null=True
            ),
        ),
        # Renumber so positions are distinct per user. The unique
        # constraints enforcing this are deferred to a follow-up
        # migration (two-step deploy): this migration must ship with
        # the new reorder code first so old code can no longer write
        # duplicate positions.
        migrations.RunPython(
            dedupe_order_fields,
            migrations.RunPython.noop
        ),
    ]
