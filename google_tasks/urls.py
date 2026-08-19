from django.urls import path
from google_tasks import views

app_name = 'google_tasks'

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('starred/', views.starred_tasks, name='starred'),
    path('starred/reorder/', views.reorder_starred, name='reorder_starred'),
    path('tasks/reorder/', views.reorder_tasks, name='reorder_tasks'),
    path('sync/', views.sync_view, name='sync'),
    path(
        'task/<str:task_id>/toggle-star/',
        views.toggle_star,
        name='toggle_star'
    ),
    path(
        'task/<str:task_id>/complete/',
        views.complete_task_view,
        name='complete_task'
    ),
    path(
        'task/<str:task_id>/uncomplete/',
        views.uncomplete_task_view,
        name='uncomplete_task'
    ),
    path(
        'process-labels/',
        views.process_labels_view,
        name='process_labels'
    ),
    path(
        'task/<str:task_id>/process-label/',
        views.process_task_label_view,
        name='process_task_label'
    ),
    path(
        'divider/create/',
        views.create_divider,
        name='create_divider'
    ),
    path(
        'divider/<str:task_id>/delete/',
        views.delete_divider,
        name='delete_divider'
    ),
    path(
        'divider/<str:task_id>/update/',
        views.update_divider,
        name='update_divider'
    ),
    path('archived/', views.archived_tasks, name='archived'),
    path('trash/', views.trash_tasks, name='trash'),
    path(
        'task/<str:task_id>/archive/',
        views.archive_task_view,
        name='archive_task'
    ),
    path(
        'task/<str:task_id>/unarchive/',
        views.unarchive_task_view,
        name='unarchive_task'
    ),
    path(
        'task/<str:task_id>/delete/',
        views.delete_task_view,
        name='delete_task'
    ),
    path(
        'task/<str:task_id>/restore/',
        views.restore_task_view,
        name='restore_task'
    ),
    path(
        'task/<str:task_id>/permanent-delete/',
        views.permanent_delete_task_view,
        name='permanent_delete_task'
    ),
]
