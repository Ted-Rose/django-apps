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
            audio_file_name = get_verses(passage, format='audio')  # Returns the name of the audio file
            audio_file_path = os.path.join(os.getcwd(), audio_file_name)  # Adjust path as necessary
            return FileResponse(open(audio_file_path, 'rb'), as_attachment=True, filename=audio_file_name)
    else:
        form = PassageForm()
    return render(request, 'bible_research/passage_form.html', {'form': form})