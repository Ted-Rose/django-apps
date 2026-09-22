import time

from django.conf import settings
from django.db import models
from django.db.models import F


def get_unix_timestamp():
    return time.time()


class TaskLabel(models.Model):
    """User-defined labels for organizing tasks (app-level only)."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)
    color = models.CharField(
        max_length=7,
        default='#0d6efd',
        help_text='Hex color code for label badge'
    )
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['user', 'name']
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.user.username})'


class GoogleTaskList(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    list_id = models.CharField(max_length=255, unique=True)
    title = models.CharField(max_length=255)
    updated = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['title']
        unique_together = ['user', 'list_id']

    def __str__(self):
        return f'{self.title} ({self.user.username})'


class GoogleTask(models.Model):
    STATUS_CHOICES = [
        ('needsAction', 'Needs Action'),
        ('completed', 'Completed'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    task_id = models.CharField(max_length=255, unique=True)
    task_list = models.ForeignKey(
        GoogleTaskList,
        on_delete=models.CASCADE,
        related_name='tasks',
        null=True,
        blank=True
    )
    title = models.CharField(max_length=500)
    notes = models.TextField(blank=True, null=True)
    due_date = models.DateTimeField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='needsAction'
    )
    completed = models.DateTimeField(null=True, blank=True)
    updated = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Last update timestamp from Google Tasks API'
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        help_text='When this task was last modified in our database'
    )
    last_synced_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When we last synced this task with Google Tasks'
    )
    needs_push = models.BooleanField(
        default=False,
        help_text='Local changes pending push to Google Tasks'
    )
    created = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When this task was first synced/created locally'
    )
    is_starred = models.BooleanField(default=False)
    is_divider = models.BooleanField(
        default=False,
        help_text='If True, this task acts as a visual divider'
    )
    task_order = models.FloatField(
        default=get_unix_timestamp,
        help_text='Manual ordering for tasks in task list view'
    )
    starred_order = models.FloatField(
        null=True,
        blank=True,
        help_text='Manual ordering for starred tasks in starred view'
    )
    is_archived = models.BooleanField(
        default=False,
        help_text='Task is archived (hidden from main view but accessible)'
    )
    is_deleted = models.BooleanField(
        default=False,
        help_text='Task is in trash (will be auto-purged after 30 days)'
    )
    deleted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text='When the task was moved to trash'
    )
    labels = models.ManyToManyField(
        TaskLabel,
        blank=True,
        related_name='tasks'
    )

    class Meta:
        ordering = [
            F('task_order').asc(nulls_last=True),
            '-updated'
        ]
        unique_together = ['user', 'task_id']
        # NOTE: the unique constraints on (user, task_order) and
        # (user, starred_order WHERE is_starred) are intentionally
        # deferred to a follow-up migration — deploy the float fields
        # + dedupe + new reorder code first, then add the constraints
        # once no old code can write duplicate positions.
        # constraints = [
        #     models.UniqueConstraint(
        #         fields=['user', 'task_order'],
        #         name='unique_task_order_per_user',
        #     ),
        #     models.UniqueConstraint(
        #         fields=['user', 'starred_order'],
        #         name='unique_starred_order_per_user',
        #         condition=Q(is_starred=True),
        #     ),
        # ]

    def __str__(self):
        return f'{self.title} ({self.user.username})'
