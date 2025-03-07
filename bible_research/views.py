from django.shortcuts import render
from .forms import PassageForm
from django.http import FileResponse
import os
from .get_word import get_verses


def generate_audio(request):
    if request.method == 'POST':
        form = PassageForm(request.POST)
        if form.is_valid():
            passage = form.cleaned_data['passage']
            audio_url = get_verses(passage, format='audio')
            return render(request, 'bible_research/passage_form.html', {'audio_url': audio_url, 'form': form})
    else:
        form = PassageForm()
    return render(request, 'bible_research/passage_form.html', {'form': form})
