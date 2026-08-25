import logging
import re
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
                    defaults = {
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

                    task, created = GoogleTask.objects.update_or_create(
                        user=user,
                        task_id=task_data['id'],
                        defaults=defaults
                    )

                    if created and not task.created:
                        task.created = timezone.now()
                        task.save(update_fields=['created'])

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


def create_task(user, creds, title, notes=None, task_list_id=None):
    """
    Create a new task in Google Tasks API.
    Returns task data on success, or auth dict if reauth needed.
    """
    logger.info(
        f'Attempting to create task "{title}" for user {user.username}'
    )
    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            logger.warning(
                f'Reauth required for user {user.username} '
                f'when creating task'
            )
            return service

        if not task_list_id:
            default_list = GoogleTaskList.objects.filter(
                user=user
            ).first()
            if not default_list:
                logger.error(
                    f'No task list found for user {user.username}'
                )
                return None
            task_list_id = default_list.list_id
            logger.info(
                f'Using default task list: {default_list.title}'
            )

        task_body = {
            'title': title,
            'status': 'needsAction'
        }

        if notes:
            task_body['notes'] = notes

        logger.info(
            f'Calling Google API to create task in tasklist {task_list_id}'
        )
        response = service.tasks().insert(
            tasklist=task_list_id,
            body=task_body
        ).execute()
        logger.info(f'Google API response: {response}')

        logger.info(
            'Successfully created task in Google Tasks API'
        )
        return response

    except HttpError as error:
        logger.error(
            f'HttpError creating task: '
            f'Status={error.resp.status}, '
            f'Reason={error.resp.reason}, '
            f'Content={error.content}'
        )
        return None
    except Exception as e:
        logger.error(
            f'Unexpected error creating task: '
            f'{type(e).__name__}: {str(e)}'
        )
        return None


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

        if task.is_divider:
            logger.warning(
                f'Cannot complete divider {task_id}'
            )
            return False
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

        if task.is_divider:
            logger.warning(
                f'Cannot uncomplete divider {task_id}'
            )
            return False

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


def extract_hashtags(text):
    """
    Extract hashtags from text.
    Pattern: # followed by letters (3+ chars)
    Returns: List of hashtag strings (without #)
    """
    if not text:
        return []
    pattern = r'#([A-Za-z]{3,})'
    matches = re.findall(pattern, text)
    return [match.lower() for match in matches]


def match_task_list(hashtag, task_lists):
    """
    Match hashtag with task list.
    Priority:
    1. Exact match (case-insensitive)
    2. Partial match (first 4 letters)
    3. Partial match (first 3 letters)

    Args:
        hashtag: String hashtag (without #)
        task_lists: QuerySet of GoogleTaskList objects

    Returns: GoogleTaskList object or None
    """
    hashtag_lower = hashtag.lower()

    # Exact match
    for task_list in task_lists:
        if task_list.title.lower() == hashtag_lower:
            logger.info(
                f'Exact match found: #{hashtag} -> {task_list.title}'
            )
            return task_list

    # Partial match (first 4 letters)
    if len(hashtag_lower) >= 4:
        for task_list in task_lists:
            title_lower = task_list.title.lower()
            if title_lower.startswith(hashtag_lower[:4]):
                logger.info(
                    f'Partial match (4 chars): '
                    f'#{hashtag} -> {task_list.title}'
                )
                return task_list

    # Partial match (first 3 letters)
    if len(hashtag_lower) >= 3:
        for task_list in task_lists:
            title_lower = task_list.title.lower()
            if title_lower.startswith(hashtag_lower[:3]):
                logger.info(
                    f'Partial match (3 chars): '
                    f'#{hashtag} -> {task_list.title}'
                )
                return task_list

    logger.info(f'No match found for #{hashtag}')
    return None


def move_task_to_list(user, creds, task, target_list):
    """
    Move task to a different task list via Google Tasks API.

    Since Google Tasks API doesn't have a direct move operation
    between lists, we:
    1. Get full task data from source list
    2. Create new task in target list
    3. Delete task from source list
    4. Update local database

    Args:
        user: User object
        creds: Google credentials
        task: GoogleTask object
        target_list: GoogleTaskList object

    Returns: True on success, False or auth dict on failure
    """
    logger.info(
        f'Moving task {task.task_id} from {task.task_list.title} '
        f'to {target_list.title}'
    )

    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            return service

        # Get full task data from source list
        source_task = service.tasks().get(
            tasklist=task.task_list.list_id,
            task=task.task_id
        ).execute()

        # Create task in target list
        new_task_body = {
            'title': source_task.get('title', ''),
            'notes': source_task.get('notes', ''),
            'status': source_task.get('status', 'needsAction'),
        }

        if 'due' in source_task:
            new_task_body['due'] = source_task['due']

        new_task = service.tasks().insert(
            tasklist=target_list.list_id,
            body=new_task_body
        ).execute()

        # Delete task from source list
        service.tasks().delete(
            tasklist=task.task_list.list_id,
            task=task.task_id
        ).execute()

        # Update local database
        task.task_id = new_task['id']
        task.task_list = target_list
        task.updated = parse_datetime(new_task.get('updated'))
        task.save()

        logger.info(
            f'Successfully moved task to {target_list.title}, '
            f'new ID: {new_task["id"]}'
        )
        return True

    except HttpError as error:
        logger.error(
            f'HttpError moving task: '
            f'Status={error.resp.status}, '
            f'Content={error.content}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error moving task: '
            f'{type(e).__name__}: {str(e)}'
        )
        return False


def process_task_labels(user, creds, task_id=None):
    """
    Process labels for one or all tasks.

    For each task:
    1. Extract hashtags from title and notes
    2. Match hashtags with task lists
    3. Move task if match found and not already in target list
    4. Star the task
    5. Log the action

    Args:
        user: User object
        creds: Google credentials
        task_id: Optional specific task ID to process

    Returns: Dict with stats
        {
            'processed': int,
            'moved': int,
            'starred': int,
            'errors': int,
            'details': [...]
        }
    """
    logger.info(
        f'Starting label processing for user {user.username}, '
        f'task_id={task_id}'
    )

    stats = {
        'processed': 0,
        'moved': 0,
        'starred': 0,
        'errors': 0,
        'details': []
    }

    # Get tasks to process
    if task_id:
        tasks = GoogleTask.objects.filter(user=user, task_id=task_id)
    else:
        tasks = GoogleTask.objects.filter(
            user=user,
            status='needsAction'
        )

    # Get all task lists for matching
    task_lists = GoogleTaskList.objects.filter(user=user)

    for task in tasks:
        stats['processed'] += 1
        detail = {
            'task_id': task.task_id,
            'title': task.title,
            'action': 'none',
            'message': ''
        }

        # Extract hashtags from title and notes
        hashtags = []
        hashtags.extend(extract_hashtags(task.title))
        hashtags.extend(extract_hashtags(task.notes or ''))

        if not hashtags:
            detail['message'] = 'No hashtags found'
            stats['details'].append(detail)
            continue

        logger.info(
            f'Task "{task.title}" has hashtags: {hashtags}'
        )

        # Try to match first hashtag
        target_list = match_task_list(hashtags[0], task_lists)

        if not target_list:
            detail['message'] = (
                f'No matching list for #{hashtags[0]}'
            )
            stats['details'].append(detail)
            continue

        # Check if task is already in target list
        if task.task_list.list_id == target_list.list_id:
            logger.info(
                f'Task already in {target_list.title}, '
                f'just starring it'
            )
            if not task.is_starred:
                task.is_starred = True
                task.save()
                stats['starred'] += 1
                detail['action'] = 'starred'
                detail['message'] = (
                    f'Already in {target_list.title}, starred'
                )
            else:
                detail['message'] = (
                    f'Already in {target_list.title} and starred'
                )
            stats['details'].append(detail)
            continue

        # Move task to target list
        result = move_task_to_list(user, creds, task, target_list)

        if isinstance(result, dict) and 'authorization_url' in result:
            logger.warning('Reauth required during label processing')
            return result

        if result:
            # Star the task
            task.is_starred = True
            task.save()
            stats['moved'] += 1
            stats['starred'] += 1
            detail['action'] = 'moved_and_starred'
            detail['message'] = (
                f'Moved to {target_list.title} and starred'
            )
        else:
            stats['errors'] += 1
            detail['action'] = 'error'
            detail['message'] = 'Failed to move task'

        stats['details'].append(detail)

    logger.info(
        f'Label processing complete: {stats["processed"]} processed, '
        f'{stats["moved"]} moved, {stats["starred"]} starred, '
        f'{stats["errors"]} errors'
    )

    return stats
