from django.urls import path
from . import views

app_name = 'single_pages'

urlpatterns = [
    path('twister', views.twister, name='twister'),
    path('spoki/', views.spoki_page_view, name='spoki_page'),
]
