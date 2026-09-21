import logging
import re
import socket
from datetime import datetime
from difflib import SequenceMatcher
from django.utils import timezone
from google_api.utils import google_auth
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_tasks.models import GoogleTaskList, GoogleTask, TaskLabel

logger = logging.getLogger('django')

TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'

# Set default socket timeout to prevent indefinite hangs
socket.setdefaulttimeout(30)

# Label matching configuration
LABEL_SIMILARITY_THRESHOLD = 0.80  # 80% similarity required
LABEL_AUTO_CREATE = False          # Auto-create new labels
LABEL_MIN_PREFIX_LENGTH = 4        # Min chars for prefix match
LABEL_CAPITALIZE_NEW = True        # Capitalize new label names


class UnmatchedHashtagsError(Exception):
    """Raised when hashtags cannot be matched to existing labels."""

    def __init__(self, unmatched):
        self.unmatched = unmatched
        details = '; '.join(
            f'#{u["hashtag"]} (task: "{u["task_title"]}")'
            for u in unmatched
        )
        super().__init__(f'Unmatched hashtags: {details}')


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
    try:
        # Use cache_discovery=False to avoid potential hanging
        # on discovery document fetch
        # Build with credentials directly (google-auth handles timeout)
        service = build(
            'tasks', 'v1',
            credentials=credentials,
            cache_discovery=False
        )
        logger.info('Service built successfully')
        return service
    except Exception as e:
        logger.error(
            f'Error building Google Tasks service: '
            f'{type(e).__name__}: {str(e)}'
        )
        raise


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

        logger.info(f'Fetching task lists for user {user.username}')
        results = service.tasklists().list(maxResults=100).execute()
        task_lists = results.get('items', [])
        logger.info(f'Retrieved {len(task_lists)} task lists from API')

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

    except socket.timeout:
        logger.error(
            f'Timeout syncing task lists for user {user.username}'
        )
        return False
    except HttpError as error:
        logger.error(
            f'HttpError syncing task lists: '
            f'Status={error.resp.status}, Content={error.content}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error syncing task lists: '
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
        )
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
            logger.info(
                f'Syncing tasks for specific list: {task_list_id}'
            )
        else:
            task_lists = GoogleTaskList.objects.filter(user=user)
            logger.info(
                f'Syncing tasks for all {task_lists.count()} lists'
            )

        total_synced = 0

        for task_list in task_lists:
            logger.info(
                f'Fetching tasks from list: {task_list.title} '
                f'({task_list.list_id})'
            )
            page_token = None
            list_task_count = 0
            while True:
                results = service.tasks().list(
                    tasklist=task_list.list_id,
                    maxResults=100,
                    showCompleted=True,
                    showHidden=True,
                    pageToken=page_token
                ).execute()

                tasks = results.get('items', [])
                list_task_count += len(tasks)

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
                f'Synced {list_task_count} tasks from '
                f'{task_list.title}'
            )

        logger.info(
            f'Synced {total_synced} tasks for user {user.username}'
        )
        return True

    except socket.timeout:
        logger.error(
            f'Timeout syncing tasks for user {user.username}'
        )
        return False
    except HttpError as error:
        logger.error(
            f'HttpError syncing tasks: '
            f'Status={error.resp.status}, Content={error.content}'
        )
        return False
    except GoogleTaskList.DoesNotExist:
        logger.error(
            f'Task list {task_list_id} not found for user {user.username}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error syncing tasks: '
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
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
            # Try to find "Reminders" list first, otherwise use first
            default_list = GoogleTaskList.objects.filter(
                user=user,
                title__iexact='Reminders'
            ).first()

            if not default_list:
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

    except socket.timeout:
        logger.error(
            f'Timeout creating task "{title}" for user {user.username}'
        )
        return None
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
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
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

    except socket.timeout:
        logger.error(
            f'Timeout completing task {task_id} for user {user.username}'
        )
        return False
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
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
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

    except socket.timeout:
        logger.error(
            f'Timeout uncompleting task {task_id} '
            f'for user {user.username}'
        )
        return False
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
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
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


def match_label(hashtag, user, create_if_missing=None):
    """
    Smart label matching for voice-to-text input.

    Matching priority:
    1. Exact match (case-insensitive)
    2. Starts-with match (first 4+ chars)
    3. Fuzzy match using similarity ratio (>80%)
    4. Starts-with match (first 3 chars) - fallback for short names
    5. Create new label if no match found and creation allowed

    Args:
        hashtag: String hashtag (without #)
        user: User object
        create_if_missing: Auto-create label if no match.
            Defaults to LABEL_AUTO_CREATE setting.

    Returns: TaskLabel object (existing or newly created),
        or None if no match and creation not allowed
    """
    if create_if_missing is None:
        create_if_missing = LABEL_AUTO_CREATE

    hashtag_lower = hashtag.lower()
    user_labels = TaskLabel.objects.filter(user=user)

    # 1. Exact match (case-insensitive)
    exact_match = user_labels.filter(name__iexact=hashtag).first()
    if exact_match:
        logger.info(f'Exact match: #{hashtag} -> {exact_match.name}')
        return exact_match

    # 2. Starts-with match (first 4+ chars)
    if len(hashtag_lower) >= LABEL_MIN_PREFIX_LENGTH:
        for label in user_labels:
            if label.name.lower().startswith(
                hashtag_lower[:LABEL_MIN_PREFIX_LENGTH]
            ):
                logger.info(
                    f'Prefix match: #{hashtag} -> {label.name}'
                )
                return label

    # 3. Fuzzy match using similarity ratio
    best_match = None
    best_ratio = 0.0

    for label in user_labels:
        ratio = SequenceMatcher(
            None,
            hashtag_lower,
            label.name.lower()
        ).ratio()

        if ratio > best_ratio:
            best_ratio = ratio
            best_match = label

    if best_ratio >= LABEL_SIMILARITY_THRESHOLD:
        logger.info(
            f'Fuzzy match ({best_ratio:.0%}): '
            f'#{hashtag} -> {best_match.name}'
        )
        return best_match

    # 4. Fallback: 3-letter prefix match (for short hashtags)
    if len(hashtag_lower) >= 3:
        for label in user_labels:
            if label.name.lower().startswith(hashtag_lower[:3]):
                logger.info(
                    f'3-letter prefix match: #{hashtag} -> {label.name}'
                )
                return label

    # 5. Create new label if no match and creation allowed
    if create_if_missing:
        label_name = (
            hashtag.capitalize()
            if LABEL_CAPITALIZE_NEW
            else hashtag
        )
        new_label = TaskLabel.objects.create(
            user=user,
            name=label_name
        )
        logger.info(f'Created new label: {new_label.name}')
        return new_label

    logger.info(f'No match found for #{hashtag}')
    return None


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
            logger.warning('Reauth required in move_task_to_list')
            return service

        # Validate task list IDs before making API calls
        if not task.task_list or not task.task_list.list_id:
            logger.error(
                f'Task {task.task_id} has no valid source list'
            )
            return False

        if not target_list or not target_list.list_id:
            logger.error(
                f'Target list is invalid for task {task.task_id}'
            )
            return False

        # Get full task data from source list
        logger.info(
            f'Fetching task {task.task_id} from source list '
            f'{task.task_list.list_id}'
        )
        try:
            source_task = service.tasks().get(
                tasklist=task.task_list.list_id,
                task=task.task_id
            ).execute()
            logger.info(
                f'Successfully fetched source task: {source_task.get("title")}'
            )
        except HttpError as e:
            if e.resp.status == 404:
                logger.error(
                    f'Task {task.task_id} not found in Google Tasks '
                    f'(may have been deleted). Marking as deleted locally.'
                )
                task.is_deleted = True
                task.save()
                return False
            raise

        # Create task in target list
        new_task_body = {
            'title': source_task.get('title', ''),
            'notes': source_task.get('notes', ''),
            'status': source_task.get('status', 'needsAction'),
        }

        if 'due' in source_task:
            new_task_body['due'] = source_task['due']

        logger.info(
            f'Creating task in target list {target_list.list_id}'
        )
        new_task = service.tasks().insert(
            tasklist=target_list.list_id,
            body=new_task_body
        ).execute()
        logger.info(
            f'Successfully created task in target list, '
            f'new ID: {new_task["id"]}'
        )

        # Delete task from source list
        logger.info(
            f'Deleting task {task.task_id} from source list '
            f'{task.task_list.list_id}'
        )
        service.tasks().delete(
            tasklist=task.task_list.list_id,
            task=task.task_id
        ).execute()
        logger.info('Successfully deleted task from source list')

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

    except socket.timeout:
        logger.error(
            f'Timeout moving task {task.task_id} from '
            f'{task.task_list.title} to {target_list.title}'
        )
        return False
    except HttpError as error:
        logger.error(
            f'HttpError moving task {task.task_id}: '
            f'Status={error.resp.status}, '
            f'Reason={error.resp.reason}, '
            f'Content={error.content}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error moving task {task.task_id}: '
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
        )
        return False


def delete_task_google(user, creds, task):
    """
    Delete a task via Google Tasks API.

    Args:
        user: User object
        creds: Google credentials
        task: GoogleTask object

    Returns: True on success, False or auth dict on failure
    """
    logger.info(
        f'Deleting task {task.task_id} from Google Tasks API'
    )

    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            logger.warning('Reauth required in delete_task_google')
            return service

        # Validate task list ID before making API call
        if not task.task_list or not task.task_list.list_id:
            logger.error(
                f'Task {task.task_id} has no valid task list'
            )
            return False

        # Try to delete task from expected list
        logger.info(
            f'Deleting task {task.task_id} from list '
            f'{task.task_list.list_id} ({task.task_list.title})'
        )
        try:
            service.tasks().delete(
                tasklist=task.task_list.list_id,
                task=task.task_id
            ).execute()
            logger.info(
                'Successfully deleted task from Google Tasks API'
            )
            return True
        except HttpError as e:
            if e.resp.status == 404:
                # Task not found in expected list
                # Try to find it in other lists
                logger.warning(
                    f'Task {task.task_id} not found in expected list '
                    f'{task.task_list.title}. '
                    f'Searching in other lists...'
                )

                # Get all task lists for this user
                all_lists = GoogleTaskList.objects.filter(user=user)
                for task_list in all_lists:
                    if task_list.list_id == task.task_list.list_id:
                        continue  # Already tried this one

                    try:
                        # Try to get the task from this list
                        service.tasks().get(
                            tasklist=task_list.list_id,
                            task=task.task_id
                        ).execute()

                        # Task found! Delete it from this list
                        logger.info(
                            f'Found task in list {task_list.title}, '
                            f'deleting...'
                        )
                        service.tasks().delete(
                            tasklist=task_list.list_id,
                            task=task.task_id
                        ).execute()
                        logger.info(
                            f'Successfully deleted task from '
                            f'{task_list.title}'
                        )

                        # Update local task list reference
                        task.task_list = task_list
                        task.save()

                        return True
                    except HttpError as inner_e:
                        if inner_e.resp.status == 404:
                            continue  # Not in this list, try next
                        raise

                # Task not found in any list
                logger.warning(
                    f'Task {task.task_id} not found in any list '
                    f'(may have been already deleted). '
                    f'Continuing with local deletion.'
                )
                return True
            raise

    except socket.timeout:
        logger.error(
            f'Timeout deleting task {task.task_id} from Google Tasks'
        )
        return False
    except HttpError as error:
        logger.error(
            f'HttpError deleting task {task.task_id}: '
            f'Status={error.resp.status}, '
            f'Reason={error.resp.reason}, '
            f'Content={error.content}'
        )
        return False
    except Exception as e:
        logger.error(
            f'Unexpected error deleting task {task.task_id}: '
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
        )
        return False


def process_task_labels(user, creds, task_id=None):
    """
    Check if notes contain multiple hashtags - if they do then assign
    multiple labels to the tasks.

    For each task:
    1. Extract ALL hashtags from title and notes
    2. Match hashtags to existing TaskLabels (many-to-many)
    3. Use FIRST hashtag to determine GoogleTaskList (for Google sync)
    4. Move task to GoogleTaskList if needed (Google API)
    5. Star the task

    Args:
        user: User object
        creds: Google credentials
        task_id: Optional specific task ID to process

    Raises:
        UnmatchedHashtagsError: If any hashtag cannot be matched
            to an existing label. No tasks are modified in this case.

    Returns: Dict with stats
        {
            'processed': int,
            'moved': int,
            'starred': int,
            'labels_assigned': int,
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
        'labels_assigned': 0,
        'errors': 0,
        'details': []
    }

    # Get tasks to process (exclude dividers)
    if task_id:
        tasks = GoogleTask.objects.filter(
            user=user,
            task_id=task_id,
            is_divider=False
        )
    else:
        tasks = GoogleTask.objects.filter(
            user=user,
            status='needsAction',
            is_divider=False
        )

    # Get all task lists for matching
    task_lists = GoogleTaskList.objects.filter(user=user)

    # Pre-calculate max starred_order to avoid repeated queries
    from django.db.models import Max
    max_starred_order = GoogleTask.objects.filter(
        user=user, is_starred=True
    ).aggregate(Max('starred_order'))['starred_order__max'] or 0

    # Pre-pass: match all hashtags to existing labels before
    # modifying anything. Collect unmatched hashtags so they can
    # be reported all at once.
    task_labels_map = {}
    unmatched = []

    for task in tasks:
        hashtags = extract_hashtags(task.title)
        hashtags += extract_hashtags(task.notes or '')

        # Skip if no hashtags
        if not hashtags:
            continue

        labels = []
        for hashtag in dict.fromkeys(hashtags):
            # Skip starred-related hashtags
            hashtag_lower = hashtag.lower()
            if (hashtag_lower == 'starred' or
                    hashtag_lower == 'star' or
                    hashtag_lower == 'start' or
                    hashtag_lower.startswith('starr')):
                continue

            label = match_label(
                hashtag, user, create_if_missing=False
            )
            if label:
                labels.append(label)
            else:
                unmatched.append({
                    'task_title': task.title,
                    'hashtag': hashtag
                })

        task_labels_map[task.task_id] = labels

    if unmatched:
        raise UnmatchedHashtagsError(unmatched)

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

        # Check if any hashtag is starred-related (fuzzy match)
        should_star = False
        for hashtag in hashtags:
            hashtag_lower = hashtag.lower()
            if (hashtag_lower == 'starred' or
                    hashtag_lower == 'star' or
                    hashtag_lower == 'start' or
                    hashtag_lower.startswith('starr')):
                should_star = True
                logger.info(
                    f'Special keyword #{hashtag} found, will mark '
                    f'task as starred'
                )
                break

        # Filter out starred-related hashtags for label processing
        non_starred_hashtags = [
            h for h in hashtags
            if not (h.lower() == 'starred' or
                    h.lower() == 'star' or
                    h.lower() == 'start' or
                    h.lower().startswith('starr'))
        ]

        # Assign pre-matched TaskLabels for ALL non-starred hashtags
        assigned_labels = []
        for label in task_labels_map.get(task.task_id, []):
            task.labels.add(label)
            assigned_labels.append(label.name)
            stats['labels_assigned'] += 1

        if assigned_labels:
            logger.info(
                f'Task "{task.title}" assigned labels: {assigned_labels}'
            )

        # If only starred keyword and no other hashtags, just star it
        if should_star and not non_starred_hashtags:
            if not task.is_starred:
                max_starred_order += 1
                task.is_starred = True
                task.starred_order = max_starred_order
                task.save()
                stats['starred'] += 1
                detail['action'] = 'starred'
                detail['message'] = (
                    f'Marked as starred with priority '
                    f'{task.starred_order}'
                )
            else:
                detail['message'] = 'Already starred'
            stats['details'].append(detail)
            continue

        # Use first non-starred hashtag for GoogleTaskList (Google sync)
        if not non_starred_hashtags:
            detail['message'] = 'No hashtags for list matching'
            stats['details'].append(detail)
            continue

        target_list = match_task_list(non_starred_hashtags[0], task_lists)

        if not target_list:
            detail['message'] = (
                f'No matching list for #{non_starred_hashtags[0]}'
            )
            stats['details'].append(detail)
            continue

        # Check if task is already in target list
        if task.task_list.list_id == target_list.list_id:
            logger.info(
                f'Task already in {target_list.title}'
            )
            # Star it only if should_star flag is set
            if should_star and not task.is_starred:
                max_starred_order += 1
                task.is_starred = True
                task.starred_order = max_starred_order
                task.save()
                stats['starred'] += 1
                detail['action'] = 'starred'
                detail['message'] = (
                    f'Already in {target_list.title}, starred with '
                    f'priority {task.starred_order}'
                )
            elif should_star and task.is_starred:
                detail['message'] = (
                    f'Already in {target_list.title} and starred'
                )
            else:
                detail['message'] = (
                    f'Already in {target_list.title}, labels assigned'
                )
            stats['details'].append(detail)
            continue

        # Move task to target list
        result = move_task_to_list(user, creds, task, target_list)

        if isinstance(result, dict) and 'authorization_url' in result:
            logger.warning('Reauth required during label processing')
            return result

        if result:
            stats['moved'] += 1
            # Star the task only if should_star flag is set
            if should_star:
                max_starred_order += 1
                task.is_starred = True
                task.starred_order = max_starred_order
                task.save()
                stats['starred'] += 1
                detail['action'] = 'moved_and_starred'
                detail['message'] = (
                    f'Moved to {target_list.title} and starred with '
                    f'priority {task.starred_order}'
                )
            else:
                detail['action'] = 'moved'
                detail['message'] = (
                    f'Moved to {target_list.title}, labels assigned'
                )
        else:
            stats['errors'] += 1
            detail['action'] = 'error'
            detail['message'] = 'Failed to move task'

        stats['details'].append(detail)

    logger.info(
        f'Label processing complete: {stats["processed"]} processed, '
        f'{stats["moved"]} moved, {stats["starred"]} starred, '
        f'{stats["labels_assigned"]} labels assigned, '
        f'{stats["errors"]} errors'
    )

    return stats
