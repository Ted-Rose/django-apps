import json
import uuid
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.db.models import F
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from google_tasks.models import GoogleTask, GoogleTaskList
from google_tasks.services import (
    sync_all,
    complete_task,
    uncomplete_task,
    process_task_labels
)


@login_required
def dashboard(request):
    """Main dashboard showing all tasks."""
    creds = request.session.get('google_credentials')

    if 'sync' in request.GET and creds:
        result = sync_all(request.user, creds)

        if isinstance(result, dict) and 'authorization_url' in result:
            request.session['state'] = result['state']
            request.session['oauth_scopes'] = result.get('scopes', [])
            request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
            return redirect(result['authorization_url'])

    task_list_filter = request.GET.get('list')
    order_by = request.GET.get('order', 'order_desc')

    tasks = GoogleTask.objects.filter(user=request.user)

    if task_list_filter:
        tasks = tasks.filter(task_list__list_id=task_list_filter)

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
        active_tasks = active_tasks.order_by('-updated')
    elif order_by == 'created_asc':
        active_tasks = active_tasks.order_by('updated')
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

    selected_list_title = None
    if task_list_filter:
        selected_list_title = task_lists.filter(
            list_id=task_list_filter
        ).values_list('title', flat=True).first()

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Add Divider', 'onclick': 'createDivider()',
         'icon': 'dash-lg', 'btn_class': 'btn-primary'},
        {'label': 'Process Labels', 'onclick': 'processLabels()',
         'icon': 'tags', 'btn_class': 'btn-success'},
        {'label': 'Sync Now', 'url': '?sync=true',
         'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
    ]

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'selected_list': task_list_filter,
        'selected_list_title': selected_list_title,
        'has_credentials': bool(creds),
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }

    return render(request, 'google_tasks/dashboard.html', context)


@login_required
def starred_tasks(request):
    """View showing only starred tasks."""
    creds = request.session.get('google_credentials')
    order_by = request.GET.get('order', 'order_desc')

    starred_tasks_qs = GoogleTask.objects.filter(
        user=request.user, is_starred=True
    )
    active_tasks = starred_tasks_qs.filter(status='needsAction')
    completed_tasks = starred_tasks_qs.filter(status='completed')

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
        active_tasks = active_tasks.order_by('-updated')
    elif order_by == 'created_asc':
        active_tasks = active_tasks.order_by('updated')
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

    burger_menu_items = [
        {'label': 'Home', 'url': '/', 'icon': 'house',
         'btn_class': 'btn-light'},
        {'label': 'Add Divider', 'onclick': 'createDivider()',
         'icon': 'dash-lg', 'btn_class': 'btn-primary'},
        {'label': 'Process Labels', 'onclick': 'processLabels()',
         'icon': 'tags', 'btn_class': 'btn-success'},
        {'label': 'Sync Now', 'url': '?sync=true',
         'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
    ]

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'selected_list': None,
        'selected_list_title': None,
        'has_credentials': bool(creds),
        'is_starred_view': True,
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }

    return render(request, 'google_tasks/dashboard.html', context)


@login_required
@require_POST
def reorder_starred(request):
    """Save local ordering of starred tasks."""
    try:
        data = json.loads(request.body)
        ordered_ids = data.get('order', [])
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse(
            {'success': False, 'error': 'Invalid JSON'}, status=400
        )

    for position, task_id in enumerate(ordered_ids):
        GoogleTask.objects.filter(
            task_id=task_id, user=request.user
        ).update(task_order=position)

    return JsonResponse({'success': True})


@login_required
@require_POST
def reorder_tasks(request):
    """Save manual ordering of tasks."""
    try:
        data = json.loads(request.body)
        ordered_ids = data.get('order', [])
        task_list_id = data.get('task_list_id')
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse(
            {'success': False, 'error': 'Invalid JSON'}, status=400
        )

    # Validate all tasks belong to user
    tasks = GoogleTask.objects.filter(
        task_id__in=ordered_ids,
        user=request.user
    )

    if task_list_id:
        tasks = tasks.filter(task_list__list_id=task_list_id)

    if tasks.count() != len(ordered_ids):
        return JsonResponse({
            'success': False,
            'error': 'Invalid task IDs'
        }, status=400)

    # Update order
    for position, task_id in enumerate(ordered_ids):
        GoogleTask.objects.filter(
            task_id=task_id,
            user=request.user
        ).update(task_order=position)

    return JsonResponse({'success': True})


@login_required
@require_POST
def toggle_star(request, task_id):
    """Toggle the starred status of a task."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    task.is_starred = not task.is_starred
    task.save()

    return JsonResponse({
        'success': True,
        'is_starred': task.is_starred
    })


@login_required
def sync_view(request):
    """Manual sync endpoint."""
    creds = request.session.get('google_credentials')

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

    creds = request.session.get('google_credentials')

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

    creds = request.session.get('google_credentials')

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

    creds = request.session.get('google_credentials')

    if not creds:
        logger.error(
            f'No credentials found for user {request.user.username}'
        )
        return JsonResponse({
            'success': False,
            'error': 'No credentials found'
        }, status=401)

    result = process_task_labels(request.user, creds)

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

    creds = request.session.get('google_credentials')

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

    result = process_task_labels(request.user, creds, task_id=task_id)

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
        position = data.get('position', 0)

        logger.info(
            f'Creating divider for user {request.user.username} '
            f'in list {task_list_id} at position {position}'
        )

        task_list = get_object_or_404(
            GoogleTaskList,
            list_id=task_list_id,
            user=request.user
        )

        divider = GoogleTask.objects.create(
            user=request.user,
            task_id=f'divider_{uuid.uuid4().hex[:16]}',
            task_list=task_list,
            title='',
            status='needsAction',
            is_divider=True,
            task_order=position
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
