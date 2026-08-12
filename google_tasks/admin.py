from django.contrib import admin
from google_tasks.models import (
    GoogleTaskList,
    GoogleTask
)


@admin.register(GoogleTaskList)
class GoogleTaskListAdmin(admin.ModelAdmin):
    list_display = ['title', 'user', 'list_id', 'updated']
    list_filter = ['user']
    search_fields = ['title', 'list_id']


@admin.register(GoogleTask)
class GoogleTaskAdmin(admin.ModelAdmin):
    list_display = [
        'title',
        'user',
        'task_list',
        'status',
        'is_starred',
        'is_divider',
        'due_date'
    ]
    list_filter = [
        'user',
        'task_list',
        'status',
        'is_starred',
        'is_divider'
    ]
    search_fields = ['title', 'notes', 'task_id']
