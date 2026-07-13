from django.contrib import admin
from google_tasks.models import (
    GoogleTaskList,
    TaskLabel,
    GoogleTask
)


@admin.register(GoogleTaskList)
class GoogleTaskListAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'list_id', 'updated']
    list_filter = ['user']
    search_fields = ['title', 'list_id']


@admin.register(TaskLabel)
class TaskLabelAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'color']
    list_filter = ['user']
    search_fields = ['name']


@admin.register(GoogleTask)
class GoogleTaskAdmin(admin.ModelAdmin):
    list_display = [
        'title',
        'user',
        'task_list',
        'status',
        'is_starred',
        'due_date'
    ]
    list_filter = ['user', 'task_list', 'status', 'is_starred']
    search_fields = ['title', 'notes', 'task_id']
    filter_horizontal = ['local_labels']
