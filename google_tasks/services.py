import logging
from datetime import datetime
from django.utils import timezone
from google_api.utils import google_auth
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_tasks.models import GoogleTaskList, GoogleTask

logger = logging.getLogger('django')

TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'


def get_tasks_service(creds):
    """
    Build Google Tasks API service with proper authentication.
    Returns service object or auth dict if reauth is needed.
    """
    scopes = [TASKS_SCOPE]
    credentials = google_auth(creds, scopes)

    if isinstance(credentials, dict) and 'authorization_url' in credentials:
        return credentials

    return build('tasks', 'v1', credentials=credentials)


def parse_datetime(date_string):
    """Parse RFC 3339 datetime string to Django datetime."""
    if not date_string:
        return None
    try:
        dt = datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt)
        return dt
    except (ValueError, AttributeError):
        return None


def sync_task_lists(user, creds):
    """
    Sync Google Task Lists for the user.
    Returns True on success, or auth dict if reauth needed.
    """
    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            return service

        results = service.tasklists().list(maxResults=100).execute()
        task_lists = results.get('items', [])

        for task_list_data in task_lists:
            GoogleTaskList.objects.update_or_create(
                user=user,
                list_id=task_list_data['id'],
                defaults={
                    'title': task_list_data.get('title', 'Untitled'),
                    'updated': parse_datetime(
                        task_list_data.get('updated')
                    ),
                }
            )

        logger.info(
            f'Synced {len(task_lists)} task lists for user {user.username}'
        )
        return True

    except HttpError as error:
        logger.error(f'Error syncing task lists: {error}')
        return False


def sync_tasks(user, creds, task_list_id=None):
    """
    Sync tasks from Google Tasks API.
    If task_list_id is provided, sync only that list.
    Otherwise, sync all lists for the user.
    Returns True on success, or auth dict if reauth needed.
    """
    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            return service

        if task_list_id:
            task_lists = [
                GoogleTaskList.objects.get(user=user, list_id=task_list_id)
            ]
        else:
            task_lists = GoogleTaskList.objects.filter(user=user)

        total_synced = 0

        for task_list in task_lists:
            results = service.tasks().list(
                tasklist=task_list.list_id,
                maxResults=100,
                showCompleted=True,
                showHidden=True
            ).execute()

            tasks = results.get('items', [])

            for task_data in tasks:
                task, created = GoogleTask.objects.update_or_create(
                    user=user,
                    task_id=task_data['id'],
                    defaults={
                        'task_list': task_list,
                        'title': task_data.get('title', 'Untitled'),
                        'notes': task_data.get('notes', ''),
                        'due_date': parse_datetime(
                            task_data.get('due')
                        ),
                        'status': task_data.get('status', 'needsAction'),
                        'completed': parse_datetime(
                            task_data.get('completed')
                        ),
                        'updated': parse_datetime(
                            task_data.get('updated')
                        ),
                    }
                )
                total_synced += 1

        logger.info(
            f'Synced {total_synced} tasks for user {user.username}'
        )
        return True

    except HttpError as error:
        logger.error(f'Error syncing tasks: {error}')
        return False
    except GoogleTaskList.DoesNotExist:
        logger.error(
            f'Task list {task_list_id} not found for user {user.username}'
        )
        return False


def sync_all(user, creds):
    """
    Sync both task lists and tasks.
    Returns True on success, or auth dict if reauth needed.
    """
    lists_result = sync_task_lists(user, creds)

    if isinstance(lists_result, dict) and 'authorization_url' in lists_result:
        return lists_result

    if not lists_result:
        return False

    tasks_result = sync_tasks(user, creds)

    if isinstance(tasks_result, dict) and 'authorization_url' in tasks_result:
        return tasks_result

    return tasks_result
