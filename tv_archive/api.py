"""django-ninja router for tv_archive (mounted at /api/tv-arhivs/).

Read-only and public — a single fat GET mirroring the template
page's filter form (same param names, so a ``/tv-arhivs?…`` URL
works verbatim against the API). ``auth=None`` is deliberate: this
is the first public operation on the shared NinjaAPI — ninja treats
``None`` as "no auth" while the default ``NOT_SET`` would inherit
the API-level ``django_auth``.

Typed params do the validation the template view lacked (junk in
``rating_value``/``ratio``/``start_date`` was a 500 — now a 422).
Two deliberate changes from the template, per the rewrite plan:
``ratio`` filters ``ratio__gte`` (a minimum match score — exact
float equality almost never hits) and results are paginated at 50
per page with a fixed ``-start_date, -id`` ordering instead of one
unbounded list in arbitrary order. ``start_date``/``end_date`` both
filter ``start_date`` (``__gte``/``__lte``) — the template's quirk,
kept verbatim. The dropdown option lists ride in the same response
so the SPA never needs a second call.
"""
from datetime import date
from typing import List, Optional

from django.core.paginator import Paginator
from django.db.models import Q
from ninja import Router, Schema

from tv_archive.models import Content

router = Router()

PAGE_SIZE = 50


class ContentOut(Schema):
    id: int
    title_lv: str
    title_eng: str
    type: str
    description_lv: Optional[str] = None
    description_eng: Optional[str] = None
    image: Optional[str] = None
    url: str
    content_rating: Optional[str] = None
    rating_value: Optional[float] = None
    start_date: Optional[date] = None
    channel: str
    ratio: Optional[float] = None


class ContentsOut(Schema):
    """One page of contents plus every filter-dropdown option list
    the page needs — a single endpoint per the rewrite plan."""
    contents: List[ContentOut]
    page: int
    num_pages: int
    count: int
    channels: List[str]
    content_ratings: List[str]
    types: List[str]


def _distinct_values(field):
    return (
        Content.objects.exclude(**{f'{field}__isnull': True})
        .exclude(**{field: ''})
        .order_by(field)
        .values_list(field, flat=True)
        .distinct()
    )


@router.get('/contents/', response=ContentsOut, auth=None)
def content_list(request, content_rating: str = '',
                 not_content_rating: str = '',
                 rating_value: Optional[float] = None,
                 start_date: Optional[date] = None,
                 end_date: Optional[date] = None,
                 ratio: Optional[float] = None,
                 channel: str = '', not_channel: str = '',
                 page: int = 1):
    query = Q()
    if content_rating:
        query &= Q(content_rating=content_rating)
    if not_content_rating:
        query &= ~Q(content_rating=not_content_rating)
    if rating_value is not None:
        query &= Q(rating_value__gte=rating_value)
    if start_date:
        query &= Q(start_date__gte=start_date)
    if end_date:
        query &= Q(start_date__lte=end_date)
    if ratio is not None:
        query &= Q(ratio__gte=ratio)
    if channel:
        query &= Q(channel=channel)
    if not_channel:
        query &= ~Q(channel=not_channel)

    contents = Content.objects.filter(query).order_by(
        '-start_date', '-id'
    )
    paginator = Paginator(contents, PAGE_SIZE)
    page_obj = paginator.get_page(page)

    return {
        'contents': page_obj.object_list,
        'page': page_obj.number,
        'num_pages': paginator.num_pages,
        'count': paginator.count,
        'channels': list(_distinct_values('channel')),
        'content_ratings': list(_distinct_values('content_rating')),
        'types': list(_distinct_values('type')),
    }
