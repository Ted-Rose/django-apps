from django.contrib import admin
from google_tasks.models import (
    GoogleTaskList,
    GoogleTask,
    TaskLabel
)


@admin.register(TaskLabel)
class TaskLabelAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'color', 'created', 'task_count']
    list_filter = ['user', 'created']
    search_fields = ['name']

    def task_count(self, obj):
        return obj.tasks.count()
    task_count.short_description = 'Tasks'


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
        'label_list',
        'status',
        'is_starred',
        'is_divider',
        'due_date'
    ]
    list_filter = [
        'user',
        'task_list',
        'labels',
        'status',
        'is_starred',
        'is_divider'
    ]
    search_fields = ['title', 'notes', 'task_id']
    filter_horizontal = ['labels']

    def label_list(self, obj):
        return ', '.join([label.name for label in obj.labels.all()])
    label_list.short_description = 'Labels'
