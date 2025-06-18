from django.shortcuts import render
from .forms import PassageForm
from django.http import JsonResponse
import base64
from .get_word import get_verses


def verses(request):
    if request.method == 'GET':
        passage = request.GET.get('passage')
        passages_format = request.GET.get('passages_format', 'json')
        if passage:
            try:
                verses = get_verses(
                    passage,
                    response_format='text',
                    passages_format=passages_format
                )
                return JsonResponse({'verses': verses})
            except Exception as e:
                return JsonResponse({'error': str(e)}, status=400)
        else:
            return JsonResponse({'error': 'Passage is required'}, status=400)
    else:
        return JsonResponse({'error': 'Only GET requests are allowed'}, status=405)


def generate_audio(request):
    if request.method == 'POST':
        form = PassageForm(request.POST)
        if form.is_valid():
            passage = form.cleaned_data['passage']
            audio_content = get_verses(passage, response_format='audio')
            if audio_content:
                response_data = {
                    "audio_content": base64.b64encode(audio_content).decode('ascii')
                }
                return JsonResponse(response_data)

    else:
        form = PassageForm()
    return render(request, 'bible_research/passage_form.html', {'form': form})
