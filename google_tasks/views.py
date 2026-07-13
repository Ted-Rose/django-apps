from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from google_tasks.models import GoogleTask, GoogleTaskList, TaskLabel
from google_tasks.services import sync_all


@login_required
def dashboard(request):
    """Main dashboard showing all tasks."""
    creds = request.session.get('google_credentials')

    if 'sync' in request.GET and creds:
        result = sync_all(request.user, creds)

        if isinstance(result, dict) and 'authorization_url' in result:
            request.session['state'] = result['state']
            request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
            return redirect(result['authorization_url'])

    task_list_filter = request.GET.get('list')
    label_filter = request.GET.get('label')

    tasks = GoogleTask.objects.filter(user=request.user)

    if task_list_filter:
        tasks = tasks.filter(task_list__list_id=task_list_filter)

    if label_filter:
        tasks = tasks.filter(local_labels__id=label_filter)

    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)

    context = {
        'tasks': tasks,
        'task_lists': task_lists,
        'labels': labels,
        'selected_list': task_list_filter,
        'selected_label': label_filter,
        'has_credentials': bool(creds),
    }

    return render(request, 'google_tasks/dashboard.html', context)


@login_required
def starred_tasks(request):
    """View showing only starred tasks."""
    tasks = GoogleTask.objects.filter(user=request.user, is_starred=True)
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
        request.session['oauth_redirect_url'] = 'google_tasks:dashboard'
        return JsonResponse({
            'success': False,
            'reauth_required': True,
            'authorization_url': result['authorization_url']
        })

    return JsonResponse({'success': result})
