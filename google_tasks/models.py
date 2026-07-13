from django.conf import settings
from django.db import models


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


class TaskLabel(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=100)
    color = models.CharField(
        max_length=7,
        default='#007bff',
        help_text='Hex color code'
    )

    class Meta:
        ordering = ['name']
        unique_together = ['user', 'name']

    def __str__(self):
        return f'{self.name} ({self.user.username})'


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
        related_name='tasks'
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
    updated = models.DateTimeField(null=True, blank=True)
    is_starred = models.BooleanField(default=False)
    local_labels = models.ManyToManyField(
        TaskLabel,
        blank=True,
        related_name='tasks'
    )

    class Meta:
        ordering = ['-updated']
        unique_together = ['user', 'task_id']

    def __str__(self):
        return f'{self.title} ({self.user.username})'
