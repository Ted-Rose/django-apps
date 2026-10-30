"""django-ninja router for google_tasks (mounted at /api/tasks/).

GET endpoints serialize tasks directly. POST operations delegate to
the JSON mutation handlers in views.py (kept there post-cutover —
they're no longer URL-routed) so mutation semantics — same service
calls, same OAuth session state, same per-user scoping — stay
identical; _adapt() maps their reauth_required / error payloads onto
the API contract (401 google_reauth, uniform {error, detail}).
"""
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional

from django.db.models import Count, F, Q
from django.db.models.functions import TruncMonth, TruncWeek
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Query, Router, Schema
from pydantic import Field

from django_apps.api import GoogleReauthRequired, _adapt, _reauth_url
from google_tasks import views
from google_tasks.models import (
    GoogleTask,
    GoogleTaskList,
    NoteCategory,
    TaskLabel,
)

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


class NoteCategoryRef(Schema):
    id: int
    name: str
    slug: str
    parent_id: Optional[int] = None


class TaskOut(Schema):
    """One task as the SPA consumes it — local-only fields included
    (needs_push lets the UI show pending vs synced state)."""
    task_id: str
    title: str
    notes: Optional[str] = None
    # Local-only TipTap doc-JSON mirror of notes — never synced
    # to Google; the SPA falls back to markdown-parsing `notes`.
    notes_doc: Optional[str] = None
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
    is_note: bool
    note_category: Optional[NoteCategoryRef] = None

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
    # Rich description as TipTap doc-JSON — the stored `notes`
    # becomes its markdown projection.
    notes_doc: Optional[str] = None
    is_starred: bool = False
    task_list_id: Optional[str] = None
    label_ids: List[int] = Field(default_factory=list, max_length=50)


class TaskUpdateIn(Schema):
    title: str
    notes: Optional[str] = None
    notes_doc: Optional[str] = None
    label_ids: Optional[List[int]] = Field(default=None, max_length=50)
    # Local-only float positions. Absent key = unchanged; the view
    # additionally accepts explicit null for starred_order (clears it).
    task_order: Optional[float] = None
    starred_order: Optional[float] = None


class LabelsOut(Schema):
    labels: List[LabelOut]


class LabelUpdateIn(Schema):
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')


class StatsLabelOut(Schema):
    """Legend entry — the label colors the bucket stacks are drawn
    with come from here, not from per-bucket data."""
    id: int
    name: str
    color: str


class StatsBucketOut(Schema):
    """One zero-filled UTC week/month. `by_label` counts a
    multi-labeled task once per label, so its values need not sum to
    `total`. `by_list` keys are task-list titles; the '' key is the
    NULL task_list group (the SPA renders it as "Unlisted")."""
    start: date
    total: int
    by_label: Dict[str, int]
    unlabeled: int
    by_list: Dict[str, int]


class StatsSummaryOut(Schema):
    this_week: int
    last_week: int
    this_month: int
    last_month: int
    all_time: int
    unknown_date: int


class StatsOut(Schema):
    labels: List[StatsLabelOut]
    weekly: List[StatsBucketOut]
    monthly: List[StatsBucketOut]
    summary: StatsSummaryOut


# --- Shared helpers ---
#
# `_adapt` / `_reauth_url` now live in django_apps.api (shared with
# gmail and future feature apps — google_features must not import
# each other).

def _creds_or_reauth(request):
    """Return the Google creds dict for request.user, or raise
    GoogleReauthRequired when stored creds exist but are unusable —
    the API equivalent of the removed views.reauth_redirect() (a
    GoogleOAuthCredentials row with dead creds bounced page views
    into OAuth instead of rendering a dead dashboard)."""
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

    `completed_orders=False` mirrors the removed views.archived_tasks,
    which only honoured the order/created orderings for its active
    bucket — there completed_* values leave the model Meta ordering in
    place."""
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
    ).select_related(
        'task_list', 'note_category'
    ).prefetch_related('labels')


def _stats_buckets(qs, trunc, starts):
    """Zero-filled StatsBucketOut rows over `starts` (date objects,
    chronological). Three aggregate passes over the dated queryset:
    per-bucket totals, per (bucket, label) — the M2M LEFT JOIN lands
    label-less tasks in the labels__name=None group — and per
    (bucket, task-list title) where NULL lands under the '' key."""
    totals, by_label, unlabeled, by_list = {}, {}, {}, {}
    for row in qs.annotate(b=trunc('completed')).values('b').annotate(
        n=Count('pk')
    ):
        totals[row['b'].date()] = row['n']
    for row in qs.annotate(b=trunc('completed')).values(
        'b', 'labels__name'
    ).annotate(n=Count('pk')):
        bucket = row['b'].date()
        if row['labels__name'] is None:
            unlabeled[bucket] = row['n']
        else:
            by_label.setdefault(
                bucket, {}
            )[row['labels__name']] = row['n']
    for row in qs.annotate(b=trunc('completed')).values(
        'b', 'task_list__title'
    ).annotate(n=Count('pk')):
        by_list.setdefault(row['b'].date(), {})[
            row['task_list__title'] or ''
        ] = row['n']
    return [
        {
            'start': start,
            'total': totals.get(start, 0),
            'by_label': by_label.get(start, {}),
            'unlabeled': unlabeled.get(start, 0),
            'by_list': by_list.get(start, {}),
        }
        for start in starts
    ]


# --- Read endpoints ---

@router.get('/dashboard/', response=DashboardOut)
def dashboard(request,
              list: Optional[str] = Query(None, max_length=255),
              label: Optional[str] = Query(None, max_length=255),
              order: str = 'order_asc'):
    creds = _creds_or_reauth(request)
    tasks = _task_queryset(request.user).filter(
        is_archived=False, is_deleted=False, is_note=False
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
            is_archived=False, is_deleted=False, is_note=False,
            status='needsAction'
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
        is_starred=True, is_archived=False, is_deleted=False,
        is_note=False
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
        is_archived=False, is_deleted=False, is_note=False,
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
        # Parity with the removed views.archived_tasks: completed_*
        # orderings only affect the completed bucket there, not the
        # active list.
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
    # Parity with the removed views.trash_tasks: per-label counts are
    # computed over the label-filtered base, like every other list
    # endpoint.
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


@router.get('/labels/', response=LabelsOut)
def labels(request):
    """Label list for the /labels management page — per-label counts
    over the same active-task base the dashboard uses."""
    _creds_or_reauth(request)
    user_labels = TaskLabel.objects.filter(user=request.user)
    base = _task_queryset(request.user).filter(
        is_archived=False, is_deleted=False, is_note=False,
        status='needsAction'
    )
    _label_task_counts(user_labels, base)
    return {'labels': user_labels}


@router.get('/search/', response=SearchOut)
def search(request, q: str = Query('', max_length=200)):
    # Deliberate redesign vs the removed views.search_tasks: a single `q` param
    # OR-matched across title+notes returning a flat list, instead of
    # separate title/notes params AND-ed and grouped per task list.
    _creds_or_reauth(request)
    q = q.strip()
    if not q:
        return {'tasks': [], 'total_results': 0}
    tasks = _task_queryset(request.user).filter(
        is_deleted=False, is_note=False
    ).filter(
        Q(title__icontains=q) | Q(notes__icontains=q)
    ).order_by('-updated')
    return {'tasks': tasks, 'total_results': tasks.count()}


@router.get('/stats/', response=StatsOut)
def stats(request,
          weeks: int = Query(12, ge=1, le=52),
          months: int = Query(12, ge=1, le=36),
          list: Optional[str] = Query(None, max_length=255)):
    """Completed-tasks productivity stats — a pure DB read over the
    local mirror (sync already persists `completed` timestamps).
    TIME_ZONE is UTC: buckets are UTC ISO weeks (Mon start) and
    calendar months. `completed IS NULL` rows never fall into dated
    buckets — they surface only in summary.unknown_date."""
    _creds_or_reauth(request)
    qs = GoogleTask.objects.filter(
        user=request.user, status='completed',
        is_deleted=False, is_divider=False, is_note=False,
    )
    if list:
        qs = qs.filter(task_list__list_id=list)
    dated = qs.exclude(completed=None)

    today = timezone.now().date()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    prev_month_start = (
        date(month_start.year - 1, 12, 1)
        if month_start.month == 1
        else date(month_start.year, month_start.month - 1, 1)
    )
    week_starts = [
        week_start - timedelta(weeks=i)
        for i in range(weeks - 1, -1, -1)
    ]
    month_starts = []
    year, month = month_start.year, month_start.month
    for _ in range(months):
        month_starts.append(date(year, month, 1))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    month_starts.reverse()

    summary = {
        'this_week': dated.filter(
            completed__date__gte=week_start
        ).count(),
        'last_week': dated.filter(
            completed__date__gte=week_start - timedelta(weeks=1),
            completed__date__lt=week_start,
        ).count(),
        'this_month': dated.filter(
            completed__date__gte=month_start
        ).count(),
        'last_month': dated.filter(
            completed__date__gte=prev_month_start,
            completed__date__lt=month_start,
        ).count(),
        # all_time counts every finished task — including the
        # unknown_date rows that never land in a dated bucket.
        'all_time': qs.count(),
        'unknown_date': qs.filter(completed=None).count(),
    }
    return {
        'labels': TaskLabel.objects.filter(user=request.user),
        'weekly': _stats_buckets(dated, TruncWeek, week_starts),
        'monthly': _stats_buckets(dated, TruncMonth, month_starts),
        'summary': summary,
    }


# --- Mutation endpoints (delegate to the existing JSON views) ---

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


@router.post('/label/{label_id}/update/')
def update_label(request, label_id: int, payload: LabelUpdateIn):
    return _adapt(
        request, views.update_label_view(request, label_id)
    )
