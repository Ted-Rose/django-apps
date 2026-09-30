import json
import math
import uuid
from django.shortcuts import render, redirect, get_object_or_404
from django.urls import reverse
from django.contrib.auth.decorators import login_required
from django.db import IntegrityError, transaction
from django.db.models import F
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.utils import timezone
from google_tasks.models import GoogleTask, GoogleTaskList, TaskLabel
from google_tasks.services import (
    sync_all,
    create_task,
    complete_task,
    uncomplete_task,
    process_task_labels,
    delete_task_google,
    match_task_list,
    UnmatchedHashtagsError,
    remove_starred_hashtags,
    get_tasks_service
)
from google_api.utils import get_user_credentials

# Maximum number of position updates accepted by a single reorder
# request (task lists exceed bible's 100-note scale).
REORDER_CAP = 500

ORDER_CONSTRAINT_NAMES = (
    'unique_task_order_per_user',
    'unique_starred_order_per_user',
)


def get_creds_dict(user):
    """
    Helper function to get credentials dict for backward compatibility.
    """
    creds = get_user_credentials(
        user,
        scopes=['https://www.googleapis.com/auth/tasks']
    )
    if creds:
        return {
            'token': creds.token,
            'refresh_token': creds.refresh_token,
            'expiry': creds.expiry.isoformat(),
            'scopes': list(creds.scopes or []),
        }
    return None


def reauth_redirect(request):
    """
    Redirect to the Google OAuth flow when the user has stored
    credentials that are no longer usable (e.g. a revoked refresh
    token). Returns None when Google was never connected, so callers
    can still render the page with a "Login with Google" option.
    """
    from google_api.models import GoogleOAuthCredentials
    if GoogleOAuthCredentials.objects.filter(user=request.user).exists():
        return redirect(
            f"{reverse('google_api:login')}?next={request.get_full_path()}"
        )
    return None


def get_dashboard_js_config(context):
    """
    Build a JSON-serializable config consumed by the dashboard's static
    JS files via {{ dashboard_js_config|json_script:"dashboard-config" }}.
    """
    is_starred_view = bool(context.get('is_starred_view'))
    task_lists = context.get('task_lists')
    first_list = task_lists[0] if task_lists else None
    return {
        'urls': {
            'reorder': reverse(
                'google_tasks:reorder_starred' if is_starred_view
                else 'google_tasks:reorder_tasks'
            ),
            'createDivider': reverse('google_tasks:create_divider'),
            'sync': reverse('google_tasks:sync'),
            'processLabels': reverse('google_tasks:process_labels'),
            'dashboard': reverse('google_tasks:dashboard'),
        },
        'flags': {
            'is_starred_view': is_starred_view,
            'is_overdue_view': bool(context.get('is_overdue_view')),
            'is_archived_view': bool(context.get('is_archived_view')),
            'is_trash_view': bool(context.get('is_trash_view')),
            'has_credentials': bool(context.get('has_credentials')),
        },
        'order_by': context.get('order_by'),
        'first_list_id': first_list.list_id if first_list else None,
    }


@login_required
def dashboard(request):
    """Main dashboard showing all tasks."""
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth

    if 'sync' in request.GET and creds:
        result = sync_all(request.user, creds)

        if isinstance(result, dict) and 'authorization_url' in result:
            request.session['state'] = result['state']
            request.session['oauth_scopes'] = result.get('scopes', [])
            # Preserve current URL with parameters
            current_url = request.get_full_path()
            request.session['oauth_redirect_url'] = current_url
            return redirect(result['authorization_url'])

        # Automatically process labels after successful sync
        if result:
            try:
                process_task_labels(request.user, creds)
            except UnmatchedHashtagsError:
                # Silently ignore unmatched hashtags during auto-processing
                pass
            except Exception:
                # Silently ignore other errors during auto-processing
                pass

    task_list_filter = request.GET.get('list')
    label_filter = request.GET.get('label')
    secondary_label_filter = request.GET.get('secondary_label')
    order_by = request.GET.get('order', 'order_asc')

    tasks = GoogleTask.objects.filter(
        user=request.user, is_archived=False, is_deleted=False
    ).select_related('task_list').prefetch_related('labels')

    if task_list_filter:
        tasks = tasks.filter(task_list__list_id=task_list_filter)

    if label_filter:
        tasks = tasks.filter(labels__name=label_filter)

    # Note: secondary_label_filter is handled client-side for
    # performance. We still pass it to template for initial
    # client-side filtering

    active_tasks = tasks.filter(status='needsAction')
    completed_tasks = tasks.filter(status='completed')

    # Apply ordering
    if order_by == 'order_desc':
        active_tasks = active_tasks.order_by(
            F('task_order').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'order_asc':
        active_tasks = active_tasks.order_by(
            F('task_order').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'created_desc':
        active_tasks = active_tasks.order_by(
            F('created').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'created_asc':
        active_tasks = active_tasks.order_by(
            F('created').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'completed_last':
        active_tasks = active_tasks.order_by(
            F('completed').asc(nulls_first=True), '-updated'
        )
    elif order_by == 'completed_first':
        active_tasks = active_tasks.order_by(
            F('completed').desc(nulls_last=True), '-updated'
        )

    # Apply ordering to completed tasks
    if order_by == 'completed_last':
        completed_tasks = completed_tasks.order_by('-completed')
    elif order_by == 'completed_first':
        completed_tasks = completed_tasks.order_by('completed')
    else:
        completed_tasks = completed_tasks.order_by('-updated')

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    # Calculate task counts for each label (for secondary filter)
    if label_filter:
        # Get base queryset without secondary label filter
        # Only count uncompleted tasks
        base_tasks = GoogleTask.objects.filter(
            user=request.user,
            is_archived=False,
            is_deleted=False,
            status='needsAction'
        )
        if task_list_filter:
            base_tasks = base_tasks.filter(
                task_list__list_id=task_list_filter
            )
        if label_filter:
            base_tasks = base_tasks.filter(labels__name=label_filter)

        # Add task count to each label (uncompleted only)
        for label in labels:
            label.task_count = base_tasks.filter(
                labels__name=label.name
            ).count()

    selected_list_title = None
    selected_label_name = None

    if task_list_filter:
        selected_list_title = task_lists.filter(
            list_id=task_list_filter
        ).values_list('title', flat=True).first()

    if label_filter:
        selected_label_name = label_filter

    # Build sync URL preserving current parameters
    from urllib.parse import urlencode
    sync_params = {'sync': 'true'}
    if task_list_filter:
        sync_params['list'] = task_list_filter
    if label_filter:
        sync_params['label'] = label_filter
    if secondary_label_filter:
        sync_params['secondary_label'] = secondary_label_filter
    if order_by:
        sync_params['order'] = order_by
    sync_url = f'?{urlencode(sync_params)}'

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Add Divider', 'onclick': 'createDivider()',
         'icon': 'dash-lg', 'btn_class': 'btn-primary'},
        {'label': 'Process Labels', 'onclick': 'processLabels()',
         'icon': 'tags', 'btn_class': 'btn-success'},
        {'label': 'Sync Now', 'url': sync_url,
         'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
    ]

    # Add login/logout option
    if creds:
        burger_menu_items.append({
            'label': f'Logout ({request.user.email or request.user.username})',
            'url': '/admin/logout/',
            'icon': 'box-arrow-right',
            'btn_class': 'btn-outline-light'
        })
    else:
        burger_menu_items.append({
            'label': 'Login with Google',
            'url': f"/login/?next={request.get_full_path()}",
            'icon': 'google',
            'btn_class': 'btn-warning'
        })

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'labels': labels,
        'selected_list': task_list_filter,
        'selected_list_title': selected_list_title,
        'selected_label': label_filter,
        'selected_label_name': selected_label_name,
        'secondary_label': secondary_label_filter,
        'has_credentials': bool(creds),
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }
    context['dashboard_js_config'] = get_dashboard_js_config(context)

    return render(request, 'google_tasks/dashboard.html', context)


@login_required
def starred_tasks(request):
    """View showing only starred tasks."""
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth

    if 'sync' in request.GET and creds:
        result = sync_all(request.user, creds)

        if isinstance(result, dict) and 'authorization_url' in result:
            request.session['state'] = result['state']
            request.session['oauth_scopes'] = result.get('scopes', [])
            # Preserve current URL with parameters
            current_url = request.get_full_path()
            request.session['oauth_redirect_url'] = current_url
            return redirect(result['authorization_url'])

        # Automatically process labels after successful sync
        if result:
            try:
                process_task_labels(request.user, creds)
            except UnmatchedHashtagsError:
                # Silently ignore unmatched hashtags during auto-processing
                pass
            except Exception:
                # Silently ignore other errors during auto-processing
                pass

    label_filter = request.GET.get('label')
    secondary_label_filter = request.GET.get('secondary_label')
    order_by = request.GET.get('order', 'order_asc')

    starred_tasks_qs = GoogleTask.objects.filter(
        user=request.user, is_starred=True, is_archived=False,
        is_deleted=False
    ).select_related('task_list').prefetch_related('labels')

    if label_filter:
        starred_tasks_qs = starred_tasks_qs.filter(labels__name=label_filter)

    # Note: secondary_label_filter is handled client-side for
    # performance. We still pass it to template for initial
    # client-side filtering

    active_tasks = starred_tasks_qs.filter(status='needsAction')
    completed_tasks = starred_tasks_qs.filter(status='completed')

    # Apply ordering (use starred_order for starred view)
    if order_by == 'order_desc':
        active_tasks = active_tasks.order_by(
            F('starred_order').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'order_asc':
        active_tasks = active_tasks.order_by(
            F('starred_order').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'created_desc':
        active_tasks = active_tasks.order_by(
            F('created').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'created_asc':
        active_tasks = active_tasks.order_by(
            F('created').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'completed_last':
        active_tasks = active_tasks.order_by(
            F('completed').asc(nulls_first=True), '-updated'
        )
    elif order_by == 'completed_first':
        active_tasks = active_tasks.order_by(
            F('completed').desc(nulls_last=True), '-updated'
        )

    # Apply ordering to completed tasks
    if order_by == 'completed_last':
        completed_tasks = completed_tasks.order_by('-completed')
    elif order_by == 'completed_first':
        completed_tasks = completed_tasks.order_by('completed')
    else:
        completed_tasks = completed_tasks.order_by('-updated')

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    # Calculate task counts for each label (for secondary filter)
    # Always show counts in starred view (uncompleted only)
    base_tasks = GoogleTask.objects.filter(
        user=request.user,
        is_starred=True,
        is_archived=False,
        is_deleted=False,
        status='needsAction'
    )
    if label_filter:
        base_tasks = base_tasks.filter(labels__name=label_filter)

    # Add task count to each label (uncompleted only)
    for label in labels:
        label.task_count = base_tasks.filter(
            labels__name=label.name
        ).count()

    # Build sync URL preserving current parameters
    from urllib.parse import urlencode
    sync_params = {'sync': 'true'}
    if label_filter:
        sync_params['label'] = label_filter
    if secondary_label_filter:
        sync_params['secondary_label'] = secondary_label_filter
    if order_by:
        sync_params['order'] = order_by
    sync_url = f'?{urlencode(sync_params)}'

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Add Divider', 'onclick': 'createDivider()',
         'icon': 'dash-lg', 'btn_class': 'btn-primary'},
        {'label': 'Process Labels', 'onclick': 'processLabels()',
         'icon': 'tags', 'btn_class': 'btn-success'},
        {'label': 'Sync Now', 'url': sync_url,
         'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
    ]

    # Add login/logout option
    if creds:
        burger_menu_items.append({
            'label': f'Logout ({request.user.email or request.user.username})',
            'url': '/admin/logout/',
            'icon': 'box-arrow-right',
            'btn_class': 'btn-outline-light'
        })
    else:
        burger_menu_items.append({
            'label': 'Login with Google',
            'url': f"/login/?next={request.get_full_path()}",
            'icon': 'google',
            'btn_class': 'btn-warning'
        })

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'labels': labels,
        'selected_list': None,
        'selected_list_title': None,
        'selected_label': label_filter,
        'selected_label_name': label_filter,
        'secondary_label': secondary_label_filter,
        'has_credentials': bool(creds),
        'is_starred_view': True,
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }
    context['dashboard_js_config'] = get_dashboard_js_config(context)

    return render(request, 'google_tasks/dashboard.html', context)


@login_required
def overdue_tasks(request):
    """View showing only overdue tasks (due_date < today)."""
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth

    if 'sync' in request.GET and creds:
        result = sync_all(request.user, creds)

        if isinstance(result, dict) and 'authorization_url' in result:
            request.session['state'] = result['state']
            request.session['oauth_scopes'] = result.get('scopes', [])
            current_url = request.get_full_path()
            request.session['oauth_redirect_url'] = current_url
            return redirect(result['authorization_url'])

        # Automatically process labels after successful sync
        if result:
            try:
                process_task_labels(request.user, creds)
            except UnmatchedHashtagsError:
                # Silently ignore unmatched hashtags during auto-processing
                pass
            except Exception:
                # Silently ignore other errors during auto-processing
                pass

    label_filter = request.GET.get('label')
    secondary_label_filter = request.GET.get('secondary_label')
    order_by = request.GET.get('order', 'order_asc')

    today = timezone.now().date()
    overdue_tasks_qs = GoogleTask.objects.filter(
        user=request.user,
        is_archived=False,
        is_deleted=False,
        due_date__lt=today
    ).select_related('task_list').prefetch_related('labels')

    if label_filter:
        overdue_tasks_qs = overdue_tasks_qs.filter(labels__name=label_filter)

    # Note: secondary_label_filter is handled client-side for
    # performance. We still pass it to template for initial
    # client-side filtering

    active_tasks = overdue_tasks_qs.filter(status='needsAction')
    completed_tasks = overdue_tasks_qs.filter(status='completed')

    # Apply ordering
    if order_by == 'order_desc':
        active_tasks = active_tasks.order_by(
            F('task_order').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'order_asc':
        active_tasks = active_tasks.order_by(
            F('task_order').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'created_desc':
        active_tasks = active_tasks.order_by(
            F('created').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'created_asc':
        active_tasks = active_tasks.order_by(
            F('created').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'completed_last':
        active_tasks = active_tasks.order_by(
            F('completed').asc(nulls_first=True), '-updated'
        )
    elif order_by == 'completed_first':
        active_tasks = active_tasks.order_by(
            F('completed').desc(nulls_last=True), '-updated'
        )

    # Apply ordering to completed tasks
    if order_by == 'completed_last':
        completed_tasks = completed_tasks.order_by('-completed')
    elif order_by == 'completed_first':
        completed_tasks = completed_tasks.order_by('completed')
    else:
        completed_tasks = completed_tasks.order_by('-updated')

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    # Calculate task counts for each label (for secondary filter)
    # Always show counts in overdue view (uncompleted only)
    today = timezone.now().date()
    base_tasks = GoogleTask.objects.filter(
        user=request.user,
        is_archived=False,
        is_deleted=False,
        due_date__lt=today,
        status='needsAction'
    )
    if label_filter:
        base_tasks = base_tasks.filter(labels__name=label_filter)

    # Add task count to each label (uncompleted only)
    for label in labels:
        label.task_count = base_tasks.filter(
            labels__name=label.name
        ).count()

    # Build sync URL preserving current parameters
    from urllib.parse import urlencode
    sync_params = {'sync': 'true'}
    if label_filter:
        sync_params['label'] = label_filter
    if secondary_label_filter:
        sync_params['secondary_label'] = secondary_label_filter
    if order_by:
        sync_params['order'] = order_by
    sync_url = f'?{urlencode(sync_params)}'

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Add Divider', 'onclick': 'createDivider()',
         'icon': 'dash-lg', 'btn_class': 'btn-primary'},
        {'label': 'Process Labels', 'onclick': 'processLabels()',
         'icon': 'tags', 'btn_class': 'btn-success'},
        {'label': 'Sync Now', 'url': sync_url,
         'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
    ]

    # Add login/logout option
    if creds:
        burger_menu_items.append({
            'label': f'Logout ({request.user.email or request.user.username})',
            'url': '/admin/logout/',
            'icon': 'box-arrow-right',
            'btn_class': 'btn-outline-light'
        })
    else:
        burger_menu_items.append({
            'label': 'Login with Google',
            'url': f"/login/?next={request.get_full_path()}",
            'icon': 'google',
            'btn_class': 'btn-warning'
        })

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'labels': labels,
        'selected_list': None,
        'selected_list_title': None,
        'selected_label': label_filter,
        'selected_label_name': label_filter,
        'secondary_label': secondary_label_filter,
        'has_credentials': bool(creds),
        'is_overdue_view': True,
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }
    context['dashboard_js_config'] = get_dashboard_js_config(context)

    return render(request, 'google_tasks/dashboard.html', context)


def _apply_reorder(request, order_field, list_id=None):
    """Validate a positional reorder payload and apply it with a
    two-phase bulk update.

    Payload: {"updates": [{"task_id": ..., "position": ...}, ...],
              "task_list_id": optional validation scope}

    Phase 1 assigns temporary negative positions so two rows swapping
    positions cannot trip the per-user unique constraint mid-flight;
    phase 2 writes the final positions.
    """
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse(
            {'success': False, 'error': 'Invalid JSON'}, status=400
        )

    updates = data.get('updates')
    task_list_id = list_id or data.get('task_list_id')

    if not isinstance(updates, list) or not updates:
        return JsonResponse({
            'success': False,
            'error': 'updates must be a non-empty list'
        }, status=400)

    if len(updates) > REORDER_CAP:
        return JsonResponse({
            'success': False,
            'error': f'Too many updates (max {REORDER_CAP})'
        }, status=400)

    position_map = {}
    positions = set()
    for item in updates:
        if not isinstance(item, dict):
            return JsonResponse({
                'success': False,
                'error': 'Each update must be an object'
            }, status=400)
        task_id = item.get('task_id')
        position = item.get('position')
        if (not isinstance(task_id, str) or not task_id or
                isinstance(position, bool) or
                not isinstance(position, (int, float)) or
                not math.isfinite(position)):
            return JsonResponse({
                'success': False,
                'error': 'Each update requires a task_id and a '
                         'numeric position'
            }, status=400)
        if task_id in position_map:
            return JsonResponse({
                'success': False,
                'error': 'Duplicate task IDs'
            }, status=400)
        if position in positions:
            return JsonResponse({
                'success': False,
                'error': 'Duplicate positions'
            }, status=400)
        position_map[task_id] = float(position)
        positions.add(position)

    tasks_qs = GoogleTask.objects.filter(
        user=request.user,
        task_id__in=position_map.keys()
    )
    if order_field == 'starred_order':
        tasks_qs = tasks_qs.filter(is_starred=True)
    if task_list_id:
        tasks_qs = tasks_qs.filter(task_list__list_id=task_list_id)

    try:
        with transaction.atomic():
            tasks = list(tasks_qs.select_for_update())
            if len(tasks) != len(position_map):
                return JsonResponse({
                    'success': False,
                    'error': 'Invalid task IDs'
                }, status=400)

            # Phase 1: temporary negative positions avoid transient
            # unique-constraint violations when rows swap positions.
            for idx, task in enumerate(tasks):
                setattr(task, order_field, -(idx + 1))
            GoogleTask.objects.bulk_update(tasks, [order_field])

            # Phase 2: final positions.
            for task in tasks:
                setattr(task, order_field, position_map[task.task_id])
            GoogleTask.objects.bulk_update(tasks, [order_field])
    except IntegrityError as e:
        if any(name in str(e) for name in ORDER_CONSTRAINT_NAMES):
            return JsonResponse({
                'success': False,
                'error': 'position_conflict'
            }, status=409)
        raise

    return JsonResponse({'success': True})


@login_required
@require_POST
def reorder_starred(request):
    """Save local ordering of starred tasks."""
    return _apply_reorder(request, 'starred_order')


@login_required
@require_POST
def reorder_tasks(request):
    """Save manual ordering of tasks."""
    return _apply_reorder(request, 'task_order')


@login_required
@require_POST
def toggle_star(request, task_id):
    """Toggle the starred status of a task."""
    from django.db.models import Max
    import logging

    logger = logging.getLogger('django')
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    task.is_starred = not task.is_starred

    if task.is_starred:
        # Get max starred_order and add 1 to put at top
        max_order = GoogleTask.objects.filter(
            user=request.user, is_starred=True
        ).aggregate(Max('starred_order'))['starred_order__max']
        task.starred_order = (max_order or 0) + 1
    else:
        # Unstarring: leave the starred ordering scope so the
        # conditional unique constraint stays clean.
        task.starred_order = None
        # Remove hashtags with words starting with 'sta'
        if task.notes:
            cleaned_notes = remove_starred_hashtags(task.notes)
            if cleaned_notes != task.notes:
                logger.info(
                    f'Removing starred hashtags from task {task_id}'
                )
                task.notes = cleaned_notes
                task.needs_push = True

                # Update notes in Google Tasks API
                creds = get_creds_dict(request.user)
                if creds and task.task_list:
                    try:
                        service = get_tasks_service(creds)
                        if not (isinstance(service, dict) and
                                'authorization_url' in service):
                            task_body = {
                                'id': task.task_id,
                                'notes': cleaned_notes
                            }
                            service.tasks().patch(
                                tasklist=task.task_list.list_id,
                                task=task.task_id,
                                body=task_body
                            ).execute()
                            task.needs_push = False
                            logger.info(
                                f'Updated notes in Google Tasks API '
                                f'for task {task_id}'
                            )
                    except Exception as e:
                        logger.error(
                            f'Failed to update notes in Google Tasks '
                            f'API: {type(e).__name__}: {str(e)}'
                        )
                        # Continue anyway - local update is more
                        # important; needs_push stays True for retry

    task.save()

    return JsonResponse({
        'success': True,
        'is_starred': task.is_starred
    })


@login_required
@require_POST
def sync_view(request):
    """Manual sync endpoint."""
    creds = get_creds_dict(request.user)

    if not creds:
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        })

    result = sync_all(request.user, creds)

    if isinstance(result, dict) and 'authorization_url' in result:
        request.session['state'] = result['state']
        request.session['oauth_scopes'] = result.get('scopes', [])
        request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    # Automatically process labels after successful sync
    if result:
        try:
            process_task_labels(request.user, creds)
        except UnmatchedHashtagsError:
            # Silently ignore unmatched hashtags during auto-processing
            pass
        except Exception:
            # Silently ignore other errors during auto-processing
            pass

    return JsonResponse({'success': result})


@login_required
@require_POST
def complete_task_view(request, task_id):
    """Mark a task as completed."""
    import logging
    logger = logging.getLogger('django')

    logger.info(
        f'complete_task_view called by user {request.user.username} '
        f'for task {task_id}'
    )

    creds = get_creds_dict(request.user)

    if not creds:
        logger.error(
            f'No credentials found for user {request.user.username}'
        )
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        }, status=401)

    logger.info(f'Credentials found: {bool(creds)}')

    get_object_or_404(
        GoogleTask,
        task_id=task_id,
        user=request.user
    )

    result = complete_task(request.user, creds, task_id)

    if isinstance(result, dict) and 'authorization_url' in result:
        logger.warning('Reauth required, returning authorization URL')
        request.session['state'] = result['state']
        request.session['oauth_scopes'] = result.get('scopes', [])
        request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    if result:
        logger.info(f'Task {task_id} completed successfully')
        return JsonResponse({
            'success': True,
            'task_id': task_id
        })
    else:
        logger.error(f'Failed to complete task {task_id}')
        return JsonResponse({
            'success': False,
            'error': 'Failed to complete task'
        }, status=500)


@login_required
@require_POST
def uncomplete_task_view(request, task_id):
    """Mark a task as not completed (needsAction)."""
    import logging
    logger = logging.getLogger('django')

    logger.info(
        f'uncomplete_task_view called by user {request.user.username} '
        f'for task {task_id}'
    )

    creds = get_creds_dict(request.user)

    if not creds:
        logger.error(
            f'No credentials found for user {request.user.username}'
        )
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        }, status=401)

    logger.info(f'Credentials found: {bool(creds)}')

    get_object_or_404(
        GoogleTask,
        task_id=task_id,
        user=request.user
    )

    result = uncomplete_task(request.user, creds, task_id)

    if isinstance(result, dict) and 'authorization_url' in result:
        logger.warning('Reauth required, returning authorization URL')
        request.session['state'] = result['state']
        request.session['oauth_scopes'] = result.get('scopes', [])
        request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    if result:
        logger.info(f'Task {task_id} uncompleted successfully')
        return JsonResponse({
            'success': True,
            'task_id': task_id
        })
    else:
        logger.error(f'Failed to uncomplete task {task_id}')
        return JsonResponse({
            'success': False,
            'error': 'Failed to uncomplete task'
        }, status=500)


@login_required
@require_POST
def process_labels_view(request):
    """Process labels for all active tasks."""
    import logging
    logger = logging.getLogger('django')

    logger.info(
        f'process_labels_view called by user {request.user.username}'
    )

    creds = get_creds_dict(request.user)

    if not creds:
        logger.error(
            f'No credentials found for user {request.user.username}'
        )
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        }, status=401)

    try:
        result = process_task_labels(request.user, creds)
    except UnmatchedHashtagsError as e:
        logger.warning(f'Unmatched hashtags: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e),
            'unmatched': e.unmatched
        }, status=400)

    if isinstance(result, dict) and 'authorization_url' in result:
        logger.warning('Reauth required, returning authorization URL')
        request.session['state'] = result['state']
        request.session['oauth_scopes'] = result.get('scopes', [])
        request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    logger.info(
        f'Label processing complete: {result["processed"]} processed, '
        f'{result["moved"]} moved, {result["starred"]} starred'
    )
    return JsonResponse({
        'success': True,
        'stats': result
    })


@login_required
@require_POST
def process_task_label_view(request, task_id):
    """Process labels for a specific task."""
    import logging
    logger = logging.getLogger('django')

    logger.info(
        f'process_task_label_view called by user '
        f'{request.user.username} for task {task_id}'
    )

    creds = get_creds_dict(request.user)

    if not creds:
        logger.error(
            f'No credentials found for user {request.user.username}'
        )
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        }, status=401)

    # Verify task belongs to user
    get_object_or_404(
        GoogleTask,
        task_id=task_id,
        user=request.user
    )

    try:
        result = process_task_labels(
            request.user, creds, task_id=task_id
        )
    except UnmatchedHashtagsError as e:
        logger.warning(f'Unmatched hashtags: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e),
            'unmatched': e.unmatched
        }, status=400)

    if isinstance(result, dict) and 'authorization_url' in result:
        logger.warning('Reauth required, returning authorization URL')
        request.session['state'] = result['state']
        request.session['oauth_scopes'] = result.get('scopes', [])
        request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    logger.info(
        f'Label processing for task {task_id} complete: '
        f'{result["moved"]} moved, {result["starred"]} starred'
    )
    return JsonResponse({
        'success': True,
        'stats': result
    })


@login_required
@require_POST
def create_divider(request):
    """Create a new task divider."""
    import logging
    logger = logging.getLogger('django')

    try:
        data = json.loads(request.body)
        task_list_id = data.get('task_list_id')
        is_starred = data.get('is_starred', False)

        logger.info(
            f'Creating divider for user {request.user.username} '
            f'in list {task_list_id}, starred={is_starred}'
        )

        task_list = None
        if task_list_id:
            task_list = get_object_or_404(
                GoogleTaskList,
                list_id=task_list_id,
                user=request.user
            )

        # task_order uses the timestamp default (lands at the
        # bottom); starred dividers get max+1 for the starred view.
        starred_order = None
        if is_starred:
            from django.db.models import Max
            max_order = GoogleTask.objects.filter(
                user=request.user, is_starred=True
            ).aggregate(Max('starred_order'))['starred_order__max']
            starred_order = (max_order or 0) + 1

        divider = GoogleTask.objects.create(
            user=request.user,
            task_id=f'divider_{uuid.uuid4().hex[:16]}',
            task_list=task_list,
            title='',
            status='needsAction',
            is_divider=True,
            is_starred=is_starred,
            starred_order=starred_order,
            created=timezone.now()
        )

        logger.info(
            f'Successfully created divider {divider.task_id}'
        )

        return JsonResponse({
            'success': True,
            'task_id': divider.task_id
        })
    except Exception as e:
        logger.error(f'Error creating divider: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=400)


@login_required
@require_POST
def delete_divider(request, task_id):
    """Delete a task divider."""
    import logging
    logger = logging.getLogger('django')

    logger.info(
        f'Deleting divider {task_id} for user {request.user.username}'
    )

    divider = get_object_or_404(
        GoogleTask,
        task_id=task_id,
        user=request.user,
        is_divider=True
    )
    divider.delete()

    logger.info(f'Successfully deleted divider {task_id}')

    return JsonResponse({'success': True})


@login_required
@require_POST
def update_divider(request, task_id):
    """Update a task divider's text."""
    import logging
    logger = logging.getLogger('django')

    try:
        data = json.loads(request.body)
        new_title = data.get('title', '')

        logger.info(
            f'Updating divider {task_id} for user '
            f'{request.user.username} with title: {new_title}'
        )

        divider = get_object_or_404(
            GoogleTask,
            task_id=task_id,
            user=request.user,
            is_divider=True
        )

        divider.title = new_title
        divider.save()

        logger.info(f'Successfully updated divider {task_id}')

        return JsonResponse({'success': True})
    except Exception as e:
        logger.error(f'Error updating divider: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=400)


@login_required
@require_POST
def archive_task_view(request, task_id):
    """Archive a task (hide from main view but keep accessible)."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    task.is_archived = True
    task.save()

    return JsonResponse({
        'success': True,
        'task_id': task_id
    })


@login_required
@require_POST
def unarchive_task_view(request, task_id):
    """Unarchive a task (restore to main view)."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    task.is_archived = False
    task.save()

    return JsonResponse({
        'success': True,
        'task_id': task_id
    })


@login_required
@require_POST
def delete_task_view(request, task_id):
    """Move task to trash (soft delete)."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)

    # Delete from Google Tasks API
    creds = get_creds_dict(request.user)
    result = delete_task_google(request.user, creds, task)

    # Check if reauth is needed
    if isinstance(result, dict) and 'authorization_url' in result:
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    # Mark as deleted locally (soft delete). Only mark as synced if the
    # remote delete succeeded; otherwise flag for retry on next sync.
    sync_time = timezone.now()
    task.is_deleted = True
    task.deleted_at = sync_time
    task.needs_push = not result
    if result:
        task.last_synced_at = sync_time
    task.save(update_fields=[
        'is_deleted', 'deleted_at', 'needs_push', 'last_synced_at'
    ])

    return JsonResponse({
        'success': True,
        'task_id': task_id
    })


@login_required
@require_POST
def restore_task_view(request, task_id):
    """Restore task from trash."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    task.is_deleted = False
    task.deleted_at = None
    # Flag for push: if the task was already deleted on Google,
    # push_local_changes will recreate it via insert.
    task.needs_push = True
    task.save()

    return JsonResponse({
        'success': True,
        'task_id': task_id
    })


@login_required
@require_POST
def permanent_delete_task_view(request, task_id):
    """Permanently delete a task from database."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    task.delete()

    return JsonResponse({
        'success': True,
        'task_id': task_id
    })


@login_required
def archived_tasks(request):
    """View showing archived tasks."""
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth
    label_filter = request.GET.get('label')
    secondary_label_filter = request.GET.get('secondary_label')
    order_by = request.GET.get('order', 'order_asc')

    archived_tasks_qs = GoogleTask.objects.filter(
        user=request.user, is_archived=True, is_deleted=False
    ).select_related('task_list').prefetch_related('labels')

    if label_filter:
        archived_tasks_qs = archived_tasks_qs.filter(labels__name=label_filter)

    # Note: secondary_label_filter is handled client-side for
    # performance. We still pass it to template for initial
    # client-side filtering

    active_tasks = archived_tasks_qs.filter(status='needsAction')
    completed_tasks = archived_tasks_qs.filter(status='completed')

    if order_by == 'order_desc':
        active_tasks = active_tasks.order_by(
            F('task_order').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'order_asc':
        active_tasks = active_tasks.order_by(
            F('task_order').asc(nulls_last=True), 'updated'
        )
    elif order_by == 'created_desc':
        active_tasks = active_tasks.order_by(
            F('created').desc(nulls_last=True), '-updated'
        )
    elif order_by == 'created_asc':
        active_tasks = active_tasks.order_by(
            F('created').asc(nulls_last=True), 'updated'
        )

    if order_by == 'completed_last':
        completed_tasks = completed_tasks.order_by('-completed')
    elif order_by == 'completed_first':
        completed_tasks = completed_tasks.order_by('completed')
    else:
        completed_tasks = completed_tasks.order_by('-updated')

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    # Calculate task counts for each label (for secondary filter)
    # Always show counts in archived view (uncompleted only)
    base_tasks = GoogleTask.objects.filter(
        user=request.user,
        is_archived=True,
        is_deleted=False,
        status='needsAction'
    )
    if label_filter:
        base_tasks = base_tasks.filter(labels__name=label_filter)

    # Add task count to each label (uncompleted only)
    for label in labels:
        label.task_count = base_tasks.filter(
            labels__name=label.name
        ).count()

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Dashboard', 'url': '/tasks/', 'icon': 'list-task',
         'btn_class': 'btn-primary'},
    ]

    # Add logout option
    burger_menu_items.append({
        'label': f'Logout ({request.user.email or request.user.username})',
        'url': '/admin/logout/',
        'icon': 'box-arrow-right',
        'btn_class': 'btn-outline-light'
    })

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'labels': labels,
        'selected_label': label_filter,
        'selected_label_name': label_filter,
        'secondary_label': secondary_label_filter,
        'has_credentials': bool(creds),
        'is_archived_view': True,
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }

    return render(request, 'google_tasks/archived.html', context)


@login_required
def trash_tasks(request):
    """View showing deleted tasks (trash)."""
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth
    label_filter = request.GET.get('label')
    secondary_label_filter = request.GET.get('secondary_label')
    order_by = request.GET.get('order', 'deleted_desc')

    deleted_tasks_qs = GoogleTask.objects.filter(
        user=request.user, is_deleted=True
    ).select_related('task_list').prefetch_related('labels')

    if label_filter:
        deleted_tasks_qs = deleted_tasks_qs.filter(labels__name=label_filter)

    # Note: secondary_label_filter is handled client-side for
    # performance. We still pass it to template for initial
    # client-side filtering

    if order_by == 'deleted_desc':
        deleted_tasks_qs = deleted_tasks_qs.order_by('-deleted_at')
    elif order_by == 'deleted_asc':
        deleted_tasks_qs = deleted_tasks_qs.order_by('deleted_at')
    else:
        deleted_tasks_qs = deleted_tasks_qs.order_by('-deleted_at')

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    # Calculate task counts for each label (for secondary filter)
    # Always show counts in trash view (uncompleted only)
    base_tasks = GoogleTask.objects.filter(
        user=request.user, is_deleted=True, status='needsAction'
    )
    if label_filter:
        base_tasks = base_tasks.filter(labels__name=label_filter)

    # Add task count to each label (uncompleted only)
    for label in labels:
        label.task_count = base_tasks.filter(
            labels__name=label.name
        ).count()

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Dashboard', 'url': '/tasks/', 'icon': 'list-task',
         'btn_class': 'btn-primary'},
    ]

    # Add logout option
    burger_menu_items.append({
        'label': f'Logout ({request.user.email or request.user.username})',
        'url': '/admin/logout/',
        'icon': 'box-arrow-right',
        'btn_class': 'btn-outline-light'
    })

    context = {
        'tasks': deleted_tasks_qs,
        'task_lists': task_lists,
        'labels': labels,
        'selected_label': label_filter,
        'selected_label_name': label_filter,
        'secondary_label': secondary_label_filter,
        'has_credentials': bool(creds),
        'is_trash_view': True,
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }

    return render(request, 'google_tasks/trash.html', context)


@login_required
def task_detail(request, task_id):
    """View showing task details with edit capability."""
    task = get_object_or_404(
        GoogleTask.objects.select_related('task_list').prefetch_related(
            'labels'
        ),
        task_id=task_id,
        user=request.user
    )
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth
    labels = TaskLabel.objects.filter(user=request.user)

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Dashboard', 'url': '/tasks/', 'icon': 'list-task',
         'btn_class': 'btn-primary'},
    ]

    # Add logout option
    burger_menu_items.append({
        'label': f'Logout ({request.user.email or request.user.username})',
        'url': '/admin/logout/',
        'icon': 'box-arrow-right',
        'btn_class': 'btn-outline-light'
    })

    context = {
        'task': task,
        'labels': labels,
        'has_credentials': bool(creds),
        'burger_menu_items': burger_menu_items,
    }

    return render(request, 'google_tasks/task_detail.html', context)


@login_required
@require_POST
def create_task_view(request):
    """Create a new task with title, notes, labels, and starred
    status."""
    import logging
    logger = logging.getLogger('django')

    creds = get_creds_dict(request.user)

    if not creds:
        logger.error(
            f'No credentials found for user {request.user.username}'
        )
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        }, status=401)

    try:
        data = json.loads(request.body)
        title = data.get('title', '').strip()
        notes_raw = data.get('notes')
        notes = notes_raw.strip() if notes_raw else ''
        is_starred = data.get('is_starred', False)
        task_list_id = data.get('task_list_id')
        label_ids = data.get('label_ids', [])

        logger.info(
            f'Creating task for user {request.user.username}: '
            f'title={title}, starred={is_starred}, '
            f'labels={label_ids}'
        )

        if not title:
            return JsonResponse({
                'success': False,
                'error': 'Title cannot be empty'
            }, status=400)

        # If no task_list_id provided but labels are selected,
        # try to match the first label to a task list
        if not task_list_id and label_ids:
            try:
                first_label = TaskLabel.objects.get(
                    id=label_ids[0],
                    user=request.user
                )
                task_lists = GoogleTaskList.objects.filter(
                    user=request.user
                )
                matched_list = match_task_list(
                    first_label.name,
                    task_lists
                )
                if matched_list:
                    task_list_id = matched_list.list_id
                    logger.info(
                        f'Matched label "{first_label.name}" to '
                        f'task list "{matched_list.title}"'
                    )
            except TaskLabel.DoesNotExist:
                logger.warning(
                    f'Label ID {label_ids[0]} not found for user '
                    f'{request.user.username}'
                )

        result = create_task(
            request.user,
            creds,
            title,
            notes=notes if notes else None,
            task_list_id=task_list_id
        )

        if isinstance(result, dict) and 'authorization_url' in result:
            logger.warning('Reauth required, returning authorization URL')
            request.session['state'] = result['state']
            request.session['oauth_scopes'] = result.get('scopes', [])
            request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
            return JsonResponse({
                'success': False,
                'reauth_required': True,
                'authorization_url': result['authorization_url']
            })

        if not result:
            logger.error('Failed to create task in Google Tasks API')
            return JsonResponse({
                'success': False,
                'error': 'Failed to create task in Google Tasks'
            }, status=500)

        task_list = None
        if task_list_id:
            task_list = GoogleTaskList.objects.filter(
                list_id=task_list_id,
                user=request.user
            ).first()
        else:
            task_list = GoogleTaskList.objects.filter(
                user=request.user
            ).first()

        # Calculate starred_order if task is starred; non-starred
        # tasks stay NULL (outside the conditional constraint).
        starred_order = None
        if is_starred:
            from django.db.models import Max
            max_order = GoogleTask.objects.filter(
                user=request.user, is_starred=True
            ).aggregate(Max('starred_order'))['starred_order__max']
            starred_order = (max_order or 0) + 1

        task = GoogleTask.objects.create(
            user=request.user,
            task_id=result['id'],
            task_list=task_list,
            title=result.get('title', title),
            notes=result.get('notes'),
            status=result.get('status', 'needsAction'),
            is_starred=is_starred,
            starred_order=starred_order,
            is_divider=False,
            updated=timezone.now(),
            last_synced_at=timezone.now(),
            created=timezone.now()
        )

        # Associate labels with the task
        if label_ids:
            labels = TaskLabel.objects.filter(
                id__in=label_ids,
                user=request.user
            )
            task.labels.set(labels)
            logger.info(
                f'Associated {labels.count()} labels with task '
                f'{task.task_id}'
            )

        logger.info(
            f'Successfully created task {task.task_id} in Google Tasks'
        )

        # Prepare task data for frontend
        task_data = {
            'task_id': task.task_id,
            'title': task.title,
            'notes': task.notes or '',
            'status': task.status,
            'is_starred': task.is_starred,
            'starred_order': task.starred_order,
            'task_order': task.task_order,
            'due_date': task.due_date.isoformat() if task.due_date else None,
            'labels': [
                {
                    'id': label.id,
                    'name': label.name,
                    'color': label.color
                }
                for label in task.labels.all()
            ],
            'task_list': {
                'list_id': task.task_list.list_id,
                'title': task.task_list.title
            } if task.task_list else None
        }

        return JsonResponse({
            'success': True,
            'task_id': task.task_id,
            'task': task_data
        })
    except Exception as e:
        logger.error(f'Error creating task: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=400)


@login_required
@require_POST
def update_task_view(request, task_id):
    """Update task title, notes, and labels."""
    import logging
    logger = logging.getLogger('django')

    try:
        data = json.loads(request.body)
        title = data.get('title', '').strip()
        notes = data.get('notes', '').strip()
        label_ids = data.get('label_ids', None)

        logger.info(
            f'Updating task {task_id} for user {request.user.username}'
        )

        task = get_object_or_404(
            GoogleTask,
            task_id=task_id,
            user=request.user
        )

        if not title:
            return JsonResponse({
                'success': False,
                'error': 'Title cannot be empty'
            }, status=400)

        new_notes = notes if notes else None
        if title != task.title or new_notes != task.notes:
            task.needs_push = True
        task.title = title
        task.notes = new_notes

        # Update labels if provided
        if label_ids is not None:
            # Validate that all label IDs belong to the user
            user_labels = TaskLabel.objects.filter(
                id__in=label_ids,
                user=request.user
            )
            if len(user_labels) != len(label_ids):
                return JsonResponse({
                    'success': False,
                    'error': 'Invalid label IDs'
                }, status=400)

            task.labels.set(user_labels)
            logger.info(
                f'Updated labels for task {task_id}: {label_ids}'
            )

        task.save()

        logger.info(f'Successfully updated task {task_id}')

        return JsonResponse({
            'success': True,
            'task_id': task_id
        })
    except Exception as e:
        logger.error(f'Error updating task: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=400)


@login_required
def search_tasks(request):
    """Search tasks by title and/or notes."""
    creds = get_creds_dict(request.user)
    if creds is None:
        reauth = reauth_redirect(request)
        if reauth:
            return reauth

    title_query = request.GET.get('title', '').strip()
    notes_query = request.GET.get('notes', '').strip()

    # Start with all non-deleted tasks
    tasks = GoogleTask.objects.filter(
        user=request.user,
        is_deleted=False
    ).select_related('task_list').prefetch_related('labels')

    # Apply filters
    if title_query:
        tasks = tasks.filter(title__icontains=title_query)

    if notes_query:
        tasks = tasks.filter(notes__icontains=notes_query)

    # Only show results if at least one search parameter is provided
    if not title_query and not notes_query:
        tasks = GoogleTask.objects.none()

    # Group tasks by task list
    task_lists = GoogleTaskList.objects.filter(user=request.user)
    grouped_tasks = {}

    for task_list in task_lists:
        list_tasks = tasks.filter(
            task_list__list_id=task_list.list_id
        ).order_by('-updated')
        if list_tasks.exists():
            grouped_tasks[task_list] = list_tasks

    # Build sync URL
    from urllib.parse import urlencode
    sync_params = {'sync': 'true'}
    sync_url = f'?{urlencode(sync_params)}'

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Dashboard', 'url': '/google-tasks/',
         'icon': 'list-task', 'btn_class': 'btn-light'},
        {'label': 'Sync Now', 'url': sync_url,
         'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
    ]

    # Add login/logout option
    if creds:
        burger_menu_items.append({
            'label': f'Logout ({request.user.email or request.user.username})',
            'url': '/admin/logout/',
            'icon': 'box-arrow-right',
            'btn_class': 'btn-outline-light'
        })
    else:
        burger_menu_items.append({
            'label': 'Login with Google',
            'url': f"/login/?next={request.get_full_path()}",
            'icon': 'google',
            'btn_class': 'btn-warning'
        })

    context = {
        'grouped_tasks': grouped_tasks,
        'title_query': title_query,
        'notes_query': notes_query,
        'has_credentials': creds is not None,
        'burger_menu_items': burger_menu_items,
        'total_results': tasks.count(),
    }

    return render(request, 'google_tasks/search.html', context)
