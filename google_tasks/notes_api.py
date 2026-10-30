"""django-ninja router for quick notes (mounted at /api/notes/).

Notes are GoogleTask rows carrying a #notes marker — the marker is
the source of truth, so clients send a category id and the server
composes/rewrites the marker itself (app-composed markers live in
the task body, keeping Google-side titles clean). Read endpoints
mirror the tasks dashboard shape; note create/update delegate to
the views.py task handlers after rewriting request.body so the
marker is injected server-side, and category mutations retag
member markers via the services helpers (rename/merge/delete keep
the stored markers matching the tree).
"""
import json
import logging
from typing import List, Optional

from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Query, Router, Schema

from django_apps.api import ApiHttpError, _adapt
from google_tasks import views
from google_tasks.api import (
    FlagsOut,
    NoteCategoryRef,
    TaskOut,
    _creds_or_reauth,
    _order_active,
    _order_completed,
)
from google_tasks.models import GoogleTask, NoteCategory
from google_tasks.services import (
    find_note_marker,
    note_display_name,
    note_marker_for,
    note_marker_segments,
    process_task_labels,
    rename_note_category,
    resolve_note_category,
    retarget_note_category,
    slugify_note_segment,
    strip_note_marker,
)

logger = logging.getLogger('django')

router = Router()


# --- Schemas ---

class NoteCategoryOut(NoteCategoryRef):
    note_count: int = 0


class NotesDashboardOut(Schema):
    notes: List[TaskOut]
    completed: List[TaskOut]
    categories: List[NoteCategoryOut]
    selected_category: Optional[int] = None
    order_by: str
    flags: FlagsOut


class NoteCreateIn(Schema):
    title: str
    body: Optional[str] = None
    category_id: Optional[int] = None
    task_list_id: Optional[str] = None


class NoteUpdateIn(Schema):
    title: Optional[str] = None
    body: Optional[str] = None
    # Absent = unchanged; explicit null = uncategorized. ninja sets
    # model_fields_set so the two cases stay distinguishable.
    category_id: Optional[int] = None
    # Explicit False strips the marker → the note becomes a plain
    # task again (the SPA's "not a note" escape).
    is_note: Optional[bool] = None


class CategoryCreateIn(Schema):
    name: str
    parent_id: Optional[int] = None


class CategoryRenameIn(Schema):
    name: str


class CategoryMergeIn(Schema):
    source_id: int
    # null target = merge into the uncategorized bucket.
    target_id: Optional[int] = None


class RetagOut(Schema):
    success: bool
    retagged: int


class NoteCategoryMutationOut(Schema):
    # Named distinctly from finance/api.py's CategoryOut — shared
    # component names collide in the generated OpenAPI schema.
    category: NoteCategoryOut
    retagged: int = 0


# --- Helpers ---

def _note_queryset(user):
    return GoogleTask.objects.filter(
        user=user, is_note=True
    ).select_related(
        'task_list', 'note_category'
    ).prefetch_related('labels')


def _user_category(request, category_id):
    return get_object_or_404(
        NoteCategory, id=category_id, user=request.user
    )


def _subtree_ids(user, category):
    """The category's id plus every descendant's at any depth —
    the category filter and subtree counts both cover the whole
    subtree. One query builds the children map; the walk is
    in-memory."""
    children = {}
    for cat in NoteCategory.objects.filter(user=user):
        children.setdefault(cat.parent_id, []).append(cat.pk)
    ids = [category.pk]
    stack = [category.pk]
    while stack:
        for child_id in children.get(stack.pop(), ()):
            ids.append(child_id)
            stack.append(child_id)
    return ids


def _process_one_note(request, task_id):
    """Run label processing for one freshly written note so the
    marker classifies/categorizes immediately. A failure must not
    break the create/update response — the next run retries the
    classification anyway (the marker is already stored)."""
    try:
        creds = _creds_or_reauth(request)
        result = process_task_labels(
            request.user, creds, task_id=task_id
        )
        if isinstance(result, dict) and \
                'authorization_url' in result:
            logger.warning(
                f'Reauth needed processing note {task_id}'
            )
    except Exception:
        logger.exception(
            f'Post-write note processing failed for {task_id}'
        )


# --- Read endpoints ---

@router.get('/', response=NotesDashboardOut)
def notes_dashboard(request,
                    category: Optional[int] = Query(None),
                    q: Optional[str] = Query(None, max_length=200),
                    order: str = 'order_asc'):
    creds = _creds_or_reauth(request)
    notes = _note_queryset(request.user).filter(
        is_archived=False, is_deleted=False
    )
    if category is not None:
        node = _user_category(request, category)
        notes = notes.filter(
            note_category_id__in=_subtree_ids(request.user, node)
        )
    if q:
        # Deliberately matches against the stored title/body —
        # marker text included, so `?q=god` also finds notes filed
        # under #notes-god-… paths. Searching BY category is the
        # feature here, not a leak.
        notes = notes.filter(
            Q(title__icontains=q) | Q(notes__icontains=q)
        )
    direct_counts = {
        row['note_category_id']: row['n']
        for row in GoogleTask.objects.filter(
            user=request.user, is_note=True,
            is_archived=False, is_deleted=False,
            status='needsAction',
        ).values('note_category_id').annotate(n=Count('pk'))
    }
    all_categories = list(
        NoteCategory.objects.filter(user=request.user)
    )
    # note_count is the SUBTREE total — a folder shows every note
    # beneath it, matching the subtree-aware ?category= filter.
    # Each category's direct count accumulates onto all of its
    # ancestors (O(categories × depth), in-memory).
    by_id = {cat.id: cat for cat in all_categories}
    subtree_counts = {cat.id: 0 for cat in all_categories}
    for cat in all_categories:
        direct = direct_counts.get(cat.id, 0)
        if not direct:
            continue
        node = cat
        seen = set()
        while node is not None and node.id not in seen:
            seen.add(node.id)
            subtree_counts[node.id] += direct
            node = by_id.get(node.parent_id)
    categories = [
        {
            'id': cat.id,
            'name': cat.name,
            'slug': cat.slug,
            'parent_id': cat.parent_id,
            'note_count': subtree_counts[cat.id],
        }
        for cat in all_categories
    ]
    return {
        'notes': _order_active(
            notes.filter(status='needsAction'), order
        ),
        'completed': _order_completed(
            notes.filter(status='completed'), order
        ),
        'categories': categories,
        'selected_category': category,
        'order_by': order,
        'flags': {'has_credentials': bool(creds)},
    }


# --- Note mutations (delegate to the existing JSON views) ---

@router.post('/')
def create_note(request, payload: NoteCreateIn):
    category = None
    if payload.category_id is not None:
        category = _user_category(request, payload.category_id)
    marker = note_marker_for(category)
    body = (payload.body or '').rstrip()
    notes_field = f'{body}\n\n{marker}' if body else marker
    # The create view re-parses request.body itself, so swap in a
    # task-create payload carrying the composed marker — same
    # Google insert → local row path, same reauth/error contract
    # through _adapt.
    request._body = json.dumps({
        'title': payload.title,
        'notes': notes_field,
        'task_list_id': payload.task_list_id,
    }).encode()
    response = _adapt(request, views.create_task_view(request))
    if response.status_code == 200:
        task_id = json.loads(response.content)['task_id']
        _process_one_note(request, task_id)
    return response


# --- Category mutations ---

def _slug_or_400(name):
    slug = slugify_note_segment(name)
    if not slug:
        raise ApiHttpError(
            400, 'Invalid category name', code='invalidCategoryName'
        )
    return slug


def _check_slug_free(request, slug, parent_id, exclude_pk=None):
    clash = NoteCategory.objects.filter(
        user=request.user, parent_id=parent_id, slug=slug
    )
    if exclude_pk is not None:
        clash = clash.exclude(pk=exclude_pk)
    if clash.exists():
        raise ApiHttpError(
            409, 'Category already exists', code='categoryExists'
        )


def _category_out(category):
    return {
        'id': category.id,
        'name': category.name,
        'slug': category.slug,
        'parent_id': category.parent_id,
        'note_count': 0,
    }


@router.post('/categories/', response=NoteCategoryMutationOut)
def create_category(request, payload: CategoryCreateIn):
    parent = None
    if payload.parent_id is not None:
        parent = _user_category(request, payload.parent_id)
    slug = _slug_or_400(payload.name)
    _check_slug_free(request, slug, payload.parent_id)
    category = NoteCategory.objects.create(
        user=request.user,
        name=payload.name.strip() or note_display_name(slug),
        slug=slug,
        parent=parent,
    )
    return {'category': _category_out(category), 'retagged': 0}


def _target_or_none(request, target_id, source):
    """Resolve a merge/delete target — must exist, belong to the
    user, and sit outside the source subtree (a category cannot
    fold into itself or any of its descendants, at any depth)."""
    if target_id is None:
        return None
    target = _user_category(request, target_id)
    node = target
    while node is not None:
        if node.pk == source.pk:
            raise ApiHttpError(
                400, 'Target cannot be inside the source subtree',
                code='invalidCategoryTarget',
            )
        node = node.parent
    return target


# The literal 'merge' route must precede the {category_id} routes —
# django-ninja matches in registration order, so otherwise a POST
# to /categories/merge/ binds 'merge' as a category id and 405s.
@router.post('/categories/merge/', response=RetagOut)
def merge_categories(request, payload: CategoryMergeIn):
    source = _user_category(request, payload.source_id)
    target = _target_or_none(request, payload.target_id, source)
    retagged = retarget_note_category(request.user, source, target)
    return {'success': True, 'retagged': retagged}


@router.patch(
    '/categories/{category_id}/',
    response=NoteCategoryMutationOut,
)
def rename_category(request, category_id: int,
                    payload: CategoryRenameIn):
    category = _user_category(request, category_id)
    slug = _slug_or_400(payload.name)
    _check_slug_free(
        request, slug, category.parent_id, exclude_pk=category.pk
    )
    retagged = rename_note_category(
        category,
        slug,
        payload.name.strip() or note_display_name(slug),
    )
    return {
        'category': _category_out(category),
        'retagged': retagged,
    }


@router.delete('/categories/{category_id}/', response=RetagOut)
def delete_category(request, category_id: int,
                    to: Optional[str] = Query(None)):
    category = _user_category(request, category_id)
    target_id = None
    if to and to != 'uncategorized':
        try:
            target_id = int(to)
        except ValueError:
            raise ApiHttpError(
                400, 'Invalid delete target',
                code='invalidDeleteTarget',
            )
    target = _target_or_none(request, target_id, category)
    retagged = retarget_note_category(request.user, category, target)
    return {'success': True, 'retagged': retagged}


# --- Note detail mutation ---
#
# The {task_id} route must come LAST: it would also match
# /categories/, so every literal subpath registers first.
@router.patch('/{task_id}/')
def update_note(request, task_id: str, payload: NoteUpdateIn):
    task = get_object_or_404(
        _note_queryset(request.user), task_id=task_id
    )
    fields = payload.model_fields_set
    un_note = (
        'is_note' in fields and payload.is_note is False
    )
    title = (
        payload.title if payload.title is not None else task.title
    )
    body = (
        payload.body if payload.body is not None
        else task.notes or ''
    )
    if 'category_id' in fields:
        # Explicit category change (null = uncategorized) — the
        # marker recomposes from the category's path.
        category = None
        if payload.category_id is not None:
            category = _user_category(request, payload.category_id)
        marker = note_marker_for(category)
    else:
        # No category change — the stored marker stays the source
        # of truth, so it is preserved verbatim (canonicalized)
        # wherever it lives, and the FK re-resolves from it.
        existing = find_note_marker(title, body)
        if existing is not None:
            segments = note_marker_segments(existing.group(0))
        else:
            segments = note_marker_segments(
                note_marker_for(task.note_category)
            )
        marker = (
            '#notes' if not segments
            else '#notes-' + '-'.join(segments)
        )
        category = resolve_note_category(request.user, segments)
    # Strip existing markers (wherever they live) and append the
    # freshly composed one to the body — app-composed markers never
    # sit in the title.
    clean_title, clean_body = strip_note_marker(title, body)
    if not clean_title:
        if 'title' in fields or un_note:
            # A supplied marker-only title — or an un-note
            # conversion of one — genuinely leaves no title.
            raise ApiHttpError(
                400, 'Title cannot be empty', code='emptyTitle'
            )
        # The stored title was marker-only: the recomposed marker
        # stands in as the whole title, so no marker appends to
        # the body below.
        clean_title = marker
    max_title = GoogleTask._meta.get_field('title').max_length
    if len(clean_title) > max_title:
        raise ApiHttpError(
            400,
            f'Title cannot exceed {max_title} characters',
            code='titleTooLong',
        )
    if un_note or clean_title == marker:
        notes_field = clean_body
    else:
        notes_field = (
            f'{clean_body}\n\n{marker}' if clean_body else marker
        )
    # Same write semantics as update_task_view: text changes flag
    # needs_push so the next sync pushes them to Google. (The view
    # itself is @require_POST and can't serve this PATCH.)
    notes_field = notes_field or None
    update_fields = [
        'title', 'notes', 'needs_push', 'is_note', 'note_category',
        # auto_now fields only stamp when listed in update_fields
        # — without it a PATCH would not move updated_at.
        'updated_at',
    ]
    if (clean_title != task.title
            or notes_field != (task.notes or None)):
        task.needs_push = True
    task.title = clean_title
    task.notes = notes_field
    task.is_note = not un_note
    task.note_category = category if not un_note else None
    task.save(update_fields=update_fields)
    return {'success': True, 'task_id': task_id}
