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
    logger.info(f'get_tasks_service called with creds type: {type(creds)}')
    scopes = [TASKS_SCOPE]
    logger.info(f'Requesting scopes: {scopes}')

    credentials = google_auth(creds, scopes)

    if isinstance(credentials, dict) and 'authorization_url' in credentials:
        logger.warning(
            'google_auth returned authorization_url, reauth needed'
        )
        return credentials

    logger.info('Successfully obtained credentials, building service')
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
            page_token = None
            while True:
                results = service.tasks().list(
                    tasklist=task_list.list_id,
                    maxResults=100,
                    showCompleted=True,
                    showHidden=True,
                    pageToken=page_token
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
                            'status': task_data.get(
                                'status', 'needsAction'
                            ),
                            'completed': parse_datetime(
                                task_data.get('completed')
                            ),
                            'updated': parse_datetime(
                                task_data.get('updated')
                            ),
                        }
                    )
                    total_synced += 1

                page_token = results.get('nextPageToken')
                if not page_token:
                    break

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


def complete_task(user, creds, task_id):
    """
    Mark a task as completed in Google Tasks API.
    Returns True on success, or auth dict if reauth needed.
    """
    logger.info(
        f'Attempting to complete task {task_id} for user {user.username}'
    )
    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            logger.warning(
                f'Reauth required for user {user.username} '
                f'when completing task {task_id}'
            )
            return service

        task = GoogleTask.objects.get(user=user, task_id=task_id)
        logger.info(
            f'Found task: {task.title} in list {task.task_list.list_id}'
        )

        task_body = {
            'id': task.task_id,
            'status': 'completed'
        }

        logger.info(
            f'Calling Google API to complete task {task_id} '
            f'in tasklist {task.task_list.list_id}'
        )
        response = service.tasks().patch(
            tasklist=task.task_list.list_id,
            task=task.task_id,
            body=task_body
        ).execute()
        logger.info(f'Google API response: {response}')

        task.status = 'completed'
        task.completed = timezone.now()
        task.save()

        logger.info(
            f'Successfully completed task {task_id} '
            f'for user {user.username}'
        )
        return True

    except HttpError as error:
        logger.error(
            f'HttpError completing task {task_id}: '
            f'Status={error.resp.status}, '
            f'Reason={error.resp.reason}, '
            f'Content={error.content}'
        )
        return False
    except GoogleTask.DoesNotExist:
        logger.error(
            f'Task {task_id} not found for user {user.username}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error completing task {task_id}: '
            f'{type(e).__name__}: {str(e)}'
        )
        return False


def uncomplete_task(user, creds, task_id):
    """
    Mark a task as not completed (needsAction) in Google Tasks API.
    Returns True on success, or auth dict if reauth needed.
    """
    logger.info(
        f'Attempting to uncomplete task {task_id} '
        f'for user {user.username}'
    )
    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            logger.warning(
                f'Reauth required for user {user.username} '
                f'when uncompleting task {task_id}'
            )
            return service

        task = GoogleTask.objects.get(user=user, task_id=task_id)
        logger.info(
            f'Found task: {task.title} in list {task.task_list.list_id}'
        )

        task_body = {
            'id': task.task_id,
            'status': 'needsAction'
        }

        logger.info(
            f'Calling Google API to uncomplete task {task_id} '
            f'in tasklist {task.task_list.list_id}'
        )
        response = service.tasks().patch(
            tasklist=task.task_list.list_id,
            task=task.task_id,
            body=task_body
        ).execute()
        logger.info(f'Google API response: {response}')

        task.status = 'needsAction'
        task.completed = None
        task.save()

        logger.info(
            f'Successfully uncompleted task {task_id} '
            f'for user {user.username}'
        )
        return True

    except HttpError as error:
        logger.error(
            f'HttpError uncompleting task {task_id}: '
            f'Status={error.resp.status}, '
            f'Reason={error.resp.reason}, '
            f'Content={error.content}'
        )
        return False
    except GoogleTask.DoesNotExist:
        logger.error(
            f'Task {task_id} not found for user {user.username}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error uncompleting task {task_id}: '
            f'{type(e).__name__}: {str(e)}'
        )
        return False
