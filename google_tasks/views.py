import json
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.db.models import F
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from google_tasks.models import GoogleTask, GoogleTaskList, TaskLabel
from google_tasks.services import (
    sync_all,
    complete_task,
    uncomplete_task
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
    label_filter = request.GET.getlist('label')

    tasks = GoogleTask.objects.filter(user=request.user)

    if task_list_filter:
        tasks = tasks.filter(task_list__list_id=task_list_filter)

    if label_filter:
        tasks = tasks.filter(
            local_labels__id__in=label_filter
        ).distinct()

    active_tasks = tasks.filter(status='needsAction')
    completed_tasks = tasks.filter(status='completed')

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    selected_list_title = None
    if task_list_filter:
        selected_list_title = task_lists.filter(
            list_id=task_list_filter
        ).values_list('title', flat=True).first()

    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'labels': labels,
        'selected_list': task_list_filter,
        'selected_list_title': selected_list_title,
        'selected_labels': label_filter,
        'has_credentials': bool(creds),
    }

    return render(request, 'google_tasks/dashboard.html', context)


@login_required
def starred_tasks(request):
    """View showing only starred tasks."""
    tasks = GoogleTask.objects.filter(
        user=request.user, is_starred=True
    ).order_by(F('starred_order').asc(nulls_last=True), '-updated')
    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    context = {
        'tasks': tasks,
        'task_lists': task_lists,
        'labels': labels,
        'is_starred_view': True,
    }

    return render(request, 'google_tasks/starred.html', context)


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
        ).update(starred_order=position)

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
@require_POST
def add_label(request, task_id):
    """Add a label to a task."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    label_id = request.POST.get('label_id')

    if label_id:
        label = get_object_or_404(
            TaskLabel,
            id=label_id,
            user=request.user
        )
        task.local_labels.add(label)

        return JsonResponse({
            'success': True,
            'label_name': label.name,
            'label_color': label.color
        })

    return JsonResponse({'success': False, 'error': 'No label specified'})


@login_required
@require_POST
def remove_label(request, task_id, label_id):
    """Remove a label from a task."""
    task = get_object_or_404(GoogleTask, task_id=task_id, user=request.user)
    label = get_object_or_404(TaskLabel, id=label_id, user=request.user)

    task.local_labels.remove(label)

    return JsonResponse({'success': True})


@login_required
@require_POST
def create_label(request):
    """Create a new custom label."""
    name = request.POST.get('name')
    color = request.POST.get('color', '#007bff')

    if name:
        label, created = TaskLabel.objects.get_or_create(
            user=request.user,
            name=name,
            defaults={'color': color}
        )

        return JsonResponse({
            'success': True,
            'label_id': label.id,
            'label_name': label.name,
            'label_color': label.color,
            'created': created
        })

    return JsonResponse({'success': False, 'error': 'Name is required'})


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
