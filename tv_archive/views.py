from django.shortcuts import render
from django.db.models import Q

from .models import Content


def content_list(request):
    content_rating = request.GET.get('content_rating', None)
    not_content_rating = request.GET.get('not_content_rating', None)
    rating_value = request.GET.get('rating_value', None)
    start_date = request.GET.get('start_date', None)
    end_date = request.GET.get('end_date', None)
    ratio = request.GET.get('ratio', None)
    not_channel = request.GET.get('not_channel', None)
    channel = request.GET.get('channel', None)

    query = Q()
    if content_rating:
        query &= Q(content_rating=content_rating)
    if rating_value:
        query &= Q(rating_value__gte=rating_value)
    if not_content_rating:
        query &= ~Q(content_rating=not_content_rating)
    if start_date:
        query &= Q(start_date__gte=start_date)
    if end_date:
        query &= Q(start_date__lte=end_date)
    if ratio:
        query &= Q(ratio=ratio)
    if not_channel:
        query &= ~Q(channel=not_channel)
    if channel:
        query &= Q(channel=channel)

    contents = Content.objects.filter(query)

    context = {
        'contents': contents,
    }

    return render(request, 'content_list.html', context)
