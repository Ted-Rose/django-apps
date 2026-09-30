"""django-ninja router for google_tasks (mounted at /api/tasks/).

GET endpoints serialize tasks directly. POST operations delegate to
the existing JSON views so mutation semantics — same service calls,
same OAuth session state, same per-user scoping — stay identical;
_adapt() maps their reauth_required / error payloads onto the API
contract (401 google_reauth, uniform {error, detail}).
"""
import json
from datetime import datetime
from typing import List, Optional
from urllib.parse import urlencode

from django.db.models import F, Q
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from ninja import Query, Router, Schema
from pydantic import Field

from django_apps.api import (
    GoogleReauthRequired,
    error_slug,
    spa_url_for,
)
from google_tasks import views
from google_tasks.models import GoogleTask, GoogleTaskList, TaskLabel

router = Router()


# --- Schemas ---
#
# The *In schemas are validate-only: ninja parses the request body for
# 422 checking and to generate the OpenAPI spec / TS types, but the
# delegated views re-parse request.body themselves. They deliberately
# mirror the views' JSON contracts rather than drive behavior, so keep
# them in sync with the views when contracts change.

class LabelRef(Schema):
    id: int
    name: str


class LabelOut(LabelRef):
    color: str
    task_count: Optional[int] = None


class TaskListRef(Schema):
    list_id: str
    title: str


class TaskListOut(TaskListRef):
    updated: Optional[datetime] = None


class TaskOut(Schema):
    """One task as the SPA consumes it — local-only fields included
    (needs_push lets the UI show pending vs synced state)."""
    task_id: str
    title: str
    notes: Optional[str] = None
    status: str
    due: Optional[datetime] = None
    completed: Optional[datetime] = None
    updated: Optional[datetime] = None
    position: Optional[str] = None
    task_list: Optional[TaskListRef] = None
    is_starred: bool
    is_divider: bool
    task_order: Optional[float] = None
    starred_order: Optional[float] = None
    labels: List[LabelRef] = []
    is_archived: bool
    is_deleted: bool
    deleted_at: Optional[datetime] = None
    needs_push: bool

    @staticmethod
    def resolve_due(obj):
        return obj.due_date

    @staticmethod
    def resolve_position(obj):
        # Google's opaque position string is not persisted locally.
        return None

    @staticmethod
    def resolve_labels(obj):
        return obj.labels.all()


class FlagsOut(Schema):
    has_credentials: bool = False
    is_starred_view: bool = False
    is_overdue_view: bool = False
    is_archived_view: bool = False
    is_trash_view: bool = False


class DashboardOut(Schema):
    tasks: List[TaskOut]
    completed: List[TaskOut]
    task_lists: List[TaskListOut]
    labels: List[LabelOut]
    selected_list: Optional[str] = None
    selected_list_title: Optional[str] = None
    selected_label: Optional[str] = None
    order_by: str
    flags: FlagsOut


class TaskDetailOut(Schema):
    task: TaskOut
    labels: List[LabelOut]
    has_credentials: bool


class SearchOut(Schema):
    tasks: List[TaskOut]
    total_results: int


class ReorderItem(Schema):
    task_id: str
    position: float


class ReorderIn(Schema):
    # max_length mirrors the view's REORDER_CAP so oversized payloads
    # fail with a 422 here instead of the view's 400.
    updates: List[ReorderItem] = Field(max_length=views.REORDER_CAP)
    task_list_id: Optional[str] = None


class DividerCreateIn(Schema):
    task_list_id: Optional[str] = None
    is_starred: bool = False


class DividerUpdateIn(Schema):
    title: str = ''


class TaskCreateIn(Schema):
    title: str
    notes: Optional[str] = None
    is_starred: bool = False
    task_list_id: Optional[str] = None
    label_ids: List[int] = Field(default_factory=list, max_length=50)


class TaskUpdateIn(Schema):
    title: str
    notes: Optional[str] = None
    label_ids: Optional[List[int]] = Field(default=None, max_length=50)


# --- Shared helpers ---

def _reauth_url(request):
    """Google OAuth login URL whose `next` sends the user back to the
    SPA page for this request (never to a raw /api/ JSON URL)."""
    return (
        f"{reverse('google_api:login')}"
        f"?{urlencode({'next': spa_url_for(request)})}"
    )


def _creds_or_reauth(request):
    """Return the Google creds dict for request.user, or raise
    GoogleReauthRequired when stored creds exist but are unusable —
    the API equivalent of views.reauth_redirect()."""
    creds = views.get_creds_dict(request.user)
    if creds is None:
        from google_api.models import GoogleOAuthCredentials
        if GoogleOAuthCredentials.objects.filter(
            user=request.user
        ).exists():
            raise GoogleReauthRequired(_reauth_url(request))
    return creds


def _order_active(qs, order_by, field='task_order',
                  completed_orders=True):
    """Ordering branches shared by the dashboard-style views.

    `completed_orders=False` mirrors views.archived_tasks, which only
    honours the order/created orderings for its active bucket — there
    completed_* values leave the model Meta ordering in place."""
    if order_by == 'order_desc':
        return qs.order_by(F(field).desc(nulls_last=True), '-updated')
    if order_by == 'order_asc':
        return qs.order_by(F(field).asc(nulls_last=True), 'updated')
    if order_by == 'created_desc':
        return qs.order_by(F('created').desc(nulls_last=True), '-updated')
    if order_by == 'created_asc':
        return qs.order_by(F('created').asc(nulls_last=True), 'updated')
    # due_date is a nullable DateTimeField; tasks without a due date
    # always sort last so they never top the list.
    if order_by == 'due_desc':
        return qs.order_by(
            F('due_date').desc(nulls_last=True), '-updated'
        )
    if order_by == 'due_asc':
        return qs.order_by(
            F('due_date').asc(nulls_last=True), 'updated'
        )
    if order_by == 'completed_last' and completed_orders:
        return qs.order_by(
            F('completed').asc(nulls_first=True), '-updated'
        )
    if order_by == 'completed_first' and completed_orders:
        return qs.order_by(
            F('completed').desc(nulls_last=True), '-updated'
        )
    return qs


def _order_completed(qs, order_by):
    if order_by == 'completed_last':
        return qs.order_by('-completed')
    if order_by == 'completed_first':
        return qs.order_by('completed')
    return qs.order_by('-updated')


def _label_task_counts(labels, base_qs):
    """Attach per-label active-task counts like the views do for the
    client-side secondary_label filter."""
    for label in labels:
        label.task_count = base_qs.filter(
            labels__name=label.name
        ).count()


def _list_response(request, creds, tasks, completed, labels,
                   order_by, selected_list=None, selected_label=None,
                   **flags):
    task_lists = GoogleTaskList.objects.filter(user=request.user)
    selected_list_title = None
    if selected_list:
        selected_list_title = task_lists.filter(
            list_id=selected_list
        ).values_list('title', flat=True).first()
    flags['has_credentials'] = bool(creds)
    return {
        'tasks': tasks,
        'completed': completed,
        'task_lists': task_lists,
        'labels': labels,
        'selected_list': selected_list,
        'selected_list_title': selected_list_title,
        'selected_label': selected_label,
        'order_by': order_by,
        'flags': flags,
    }


def _task_queryset(user):
    return GoogleTask.objects.filter(
        user=user
    ).select_related('task_list').prefetch_related('labels')


# --- Read endpoints ---

@router.get('/dashboard/', response=DashboardOut)
def dashboard(request,
              list: Optional[str] = Query(None, max_length=255),
              label: Optional[str] = Query(None, max_length=255),
              order: str = 'order_asc'):
    creds = _creds_or_reauth(request)
    tasks = _task_queryset(request.user).filter(
        is_archived=False, is_deleted=False
    )
    if list:
        tasks = tasks.filter(task_list__list_id=list)
    if label:
        tasks = tasks.filter(labels__name=label)
    labels = TaskLabel.objects.filter(user=request.user)
    if label:
        # Mirror the dashboard view: label counts only when a label
        # filter is active (secondary_label stays client-side).
        base = _task_queryset(request.user).filter(
            is_archived=False, is_deleted=False, status='needsAction'
        )
        if list:
            base = base.filter(task_list__list_id=list)
        _label_task_counts(labels, base.filter(labels__name=label))
    return _list_response(
        request, creds,
        _order_active(tasks.filter(status='needsAction'), order),
        _order_completed(tasks.filter(status='completed'), order),
        labels, order, selected_list=list, selected_label=label,
    )


@router.get('/starred/', response=DashboardOut)
def starred(request,
            label: Optional[str] = Query(None, max_length=255),
            order: str = 'order_asc'):
    creds = _creds_or_reauth(request)
    tasks = _task_queryset(request.user).filter(
        is_starred=True, is_archived=False, is_deleted=False
    )
    if label:
        tasks = tasks.filter(labels__name=label)
    labels = TaskLabel.objects.filter(user=request.user)
    base = tasks.filter(status='needsAction')
    _label_task_counts(labels, base)
    return _list_response(
        request, creds,
        _order_active(base, order, field='starred_order'),
        _order_completed(tasks.filter(status='completed'), order),
        labels, order, selected_label=label, is_starred_view=True,
    )


@router.get('/overdue/', response=DashboardOut)
def overdue(request,
            label: Optional[str] = Query(None, max_length=255),
            order: str = 'order_asc'):
    creds = _creds_or_reauth(request)
    tasks = _task_queryset(request.user).filter(
        is_archived=False, is_deleted=False,
        due_date__lt=timezone.now().date()
    )
    if label:
        tasks = tasks.filter(labels__name=label)
    labels = TaskLabel.objects.filter(user=request.user)
    base = tasks.filter(status='needsAction')
    _label_task_counts(labels, base)
    return _list_response(
        request, creds,
        _order_active(base, order),
        _order_completed(tasks.filter(status='completed'), order),
        labels, order, selected_label=label, is_overdue_view=True,
    )


@router.get('/archived/', response=DashboardOut)
def archived(request,
             label: Optional[str] = Query(None, max_length=255),
             order: str = 'order_asc'):
    creds = _creds_or_reauth(request)
    tasks = _task_queryset(request.user).filter(
        is_archived=True, is_deleted=False
    )
    if label:
        tasks = tasks.filter(labels__name=label)
    labels = TaskLabel.objects.filter(user=request.user)
    base = tasks.filter(status='needsAction')
    _label_task_counts(labels, base)
    return _list_response(
        request, creds,
        # Parity with views.archived_tasks: completed_* orderings only
        # affect the completed bucket there, not the active list.
        _order_active(base, order, completed_orders=False),
        _order_completed(tasks.filter(status='completed'), order),
        labels, order, selected_label=label, is_archived_view=True,
    )


@router.get('/trash/', response=DashboardOut)
def trash(request,
          label: Optional[str] = Query(None, max_length=255),
          order: str = 'deleted_desc'):
    creds = _creds_or_reauth(request)
    tasks = _task_queryset(request.user).filter(is_deleted=True)
    if label:
        tasks = tasks.filter(labels__name=label)
    if order == 'deleted_asc':
        tasks = tasks.order_by('deleted_at')
    else:
        tasks = tasks.order_by('-deleted_at')
    labels = TaskLabel.objects.filter(user=request.user)
    # Parity with views.trash_tasks: per-label counts are computed over
    # the label-filtered base, like every other list endpoint.
    base = GoogleTask.objects.filter(
        user=request.user, is_deleted=True, status='needsAction'
    )
    if label:
        base = base.filter(labels__name=label)
    _label_task_counts(labels, base)
    return _list_response(
        request, creds, tasks, GoogleTask.objects.none(),
        labels, order, selected_label=label, is_trash_view=True,
    )


@router.get('/task/{task_id}/', response=TaskDetailOut)
def task_detail(request, task_id: str):
    task = get_object_or_404(
        _task_queryset(request.user),
        task_id=task_id,
    )
    creds = _creds_or_reauth(request)
    return {
        'task': task,
        'labels': TaskLabel.objects.filter(user=request.user),
        'has_credentials': bool(creds),
    }


@router.get('/search/', response=SearchOut)
def search(request, q: str = Query('', max_length=200)):
    # Deliberate redesign vs views.search_tasks: a single `q` param
    # OR-matched across title+notes returning a flat list, instead of
    # separate title/notes params AND-ed and grouped per task list.
    _creds_or_reauth(request)
    q = q.strip()
    if not q:
        return {'tasks': [], 'total_results': 0}
    tasks = _task_queryset(request.user).filter(
        is_deleted=False
    ).filter(
        Q(title__icontains=q) | Q(notes__icontains=q)
    ).order_by('-updated')
    return {'tasks': tasks, 'total_results': tasks.count()}


# --- Mutation endpoints (delegate to the existing JSON views) ---

def _adapt(request, response):
    """Map a mutation view's JsonResponse onto the API contract:
    reauth_required / missing creds → 401 google_reauth; failures →
    uniform {error, detail}. Success bodies pass through unchanged.
    """
    if not isinstance(response, JsonResponse):
        return response
    try:
        payload = json.loads(response.content)
    except ValueError:
        return response
    if payload.get('reauth_required') or (
            payload.get('error') == 'No credentials found'):
        # The view already stored OAuth state in the session when a
        # flow URL exists; otherwise bounce through /login/ (the same
        # target views.reauth_redirect uses for dead creds).
        authorization_url = (
            payload.get('authorization_url') or _reauth_url(request)
        )
        return JsonResponse({
            'error': 'google_reauth',
            'authorization_url': authorization_url,
        }, status=401)
    if 'success' in payload and not payload['success']:
        # Non-2xx keeps the view's status verbatim. A 2xx with
        # success:false is a server-side failure (e.g. sync_view emits
        # {'success': False} with status 200), so floor at 500 — a 400
        # would misreport it as a client error.
        status = response.status_code
        if status < 400:
            status = 500
        extra = {
            k: v for k, v in payload.items()
            if k not in ('success', 'error')
        }
        return JsonResponse({
            'error': error_slug(status),
            'detail': payload.get('error') or 'Operation failed',
            **extra,
        }, status=status)
    return response


@router.post('/sync/')
def sync(request):
    return _adapt(request, views.sync_view(request))


@router.post('/tasks/reorder/')
def reorder_tasks(request, payload: ReorderIn):
    return _adapt(request, views.reorder_tasks(request))


@router.post('/starred/reorder/')
def reorder_starred(request, payload: ReorderIn):
    return _adapt(request, views.reorder_starred(request))


@router.post('/task/create/')
def create_task(request, payload: TaskCreateIn):
    return _adapt(request, views.create_task_view(request))


@router.post('/task/{task_id}/toggle-star/')
def toggle_star(request, task_id: str):
    return _adapt(request, views.toggle_star(request, task_id))


@router.post('/task/{task_id}/complete/')
def complete_task(request, task_id: str):
    return _adapt(
        request, views.complete_task_view(request, task_id)
    )


@router.post('/task/{task_id}/uncomplete/')
def uncomplete_task(request, task_id: str):
    return _adapt(
        request, views.uncomplete_task_view(request, task_id)
    )


@router.post('/process-labels/')
def process_labels(request):
    return _adapt(request, views.process_labels_view(request))


@router.post('/task/{task_id}/process-label/')
def process_task_label(request, task_id: str):
    return _adapt(
        request, views.process_task_label_view(request, task_id)
    )


@router.post('/divider/create/')
def create_divider(request, payload: DividerCreateIn):
    return _adapt(request, views.create_divider(request))


@router.post('/divider/{task_id}/update/')
def update_divider(request, task_id: str, payload: DividerUpdateIn):
    return _adapt(request, views.update_divider(request, task_id))


@router.post('/divider/{task_id}/delete/')
def delete_divider(request, task_id: str):
    return _adapt(request, views.delete_divider(request, task_id))


@router.post('/task/{task_id}/archive/')
def archive_task(request, task_id: str):
    return _adapt(request, views.archive_task_view(request, task_id))


@router.post('/task/{task_id}/unarchive/')
def unarchive_task(request, task_id: str):
    return _adapt(
        request, views.unarchive_task_view(request, task_id)
    )


@router.post('/task/{task_id}/delete/')
def delete_task(request, task_id: str):
    return _adapt(request, views.delete_task_view(request, task_id))


@router.post('/task/{task_id}/restore/')
def restore_task(request, task_id: str):
    return _adapt(request, views.restore_task_view(request, task_id))


@router.post('/task/{task_id}/permanent-delete/')
def permanent_delete_task(request, task_id: str):
    return _adapt(
        request, views.permanent_delete_task_view(request, task_id)
    )


@router.post('/task/{task_id}/update/')
def update_task(request, task_id: str, payload: TaskUpdateIn):
    return _adapt(
        request, views.update_task_view(request, task_id)
    )
