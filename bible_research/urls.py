from django.urls import path
from . import views

app_name = 'bible_research'

urlpatterns = [
    path('bible/', views.generate_audio, name='generate_audio'),
]
