from django.shortcuts import render
from .forms import PassageForm
from django.http import JsonResponse
import base64
from .get_word import get_verses


def generate_audio(request):
    if request.method == 'POST':
        form = PassageForm(request.POST)
        if form.is_valid():
            passage = form.cleaned_data['passage']
            audio_content = get_verses(passage, format='audio')
            if audio_content:
                response_data = {
                    "audio_content": base64.b64encode(audio_content).decode('ascii')
                }
                return JsonResponse(response_data)

    else:
        form = PassageForm()
    return render(request, 'bible_research/passage_form.html', {'form': form})
