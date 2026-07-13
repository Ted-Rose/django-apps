from django.urls import path
from google_tasks import views

app_name = 'google_tasks'

urlpatterns = [
    path('', views.dashboard, name='dashboard'),
    path('starred/', views.starred_tasks, name='starred'),
    path('sync/', views.sync_view, name='sync'),
    path(
        'task/<str:task_id>/toggle-star/',
        views.toggle_star,
        name='toggle_star'
    ),
    path('task/<str:task_id>/add-label/', views.add_label, name='add_label'),
    path(
        'task/<str:task_id>/remove-label/<int:label_id>/',
        views.remove_label,
        name='remove_label'
    ),
    path('label/create/', views.create_label, name='create_label'),
]
