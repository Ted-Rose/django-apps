import logging
import re
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from difflib import SequenceMatcher
from django.db import transaction
from django.db.models import F
from django.utils import timezone
from google_api.utils import google_auth
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from google_tasks.models import (
    GoogleTaskList,
    GoogleTask,
    NoteCategory,
    TaskLabel,
)

logger = logging.getLogger('django')

TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'

# Set default socket timeout to prevent indefinite hangs
socket.setdefaulttimeout(30)

# Label matching configuration
LABEL_SIMILARITY_THRESHOLD = 0.80  # 80% similarity required
LABEL_AUTO_CREATE = False          # Auto-create new labels
LABEL_MIN_PREFIX_LENGTH = 4        # Min chars for prefix match
LABEL_CAPITALIZE_NEW = True        # Capitalize new label names


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

        # Same classify-then-bulk-write pattern as the task pull:
        # one snapshot read plus two bulk statements instead of two
        # queries per list.
        existing = {
            task_list.list_id: task_list
            for task_list in GoogleTaskList.objects.filter(user=user)
        }
        to_create, to_update = [], []
        pending = {}  # list_id -> unsaved row already in to_create
        queued = set()  # pks already in to_update
        for task_list_data in task_lists:
            defaults = {
                'title': task_list_data.get('title', 'Untitled'),
                'updated': parse_datetime(
                    task_list_data.get('updated')
                ),
            }
            list_id = task_list_data['id']
            task_list = existing.get(list_id)
            if task_list is None:
                task_list = pending.get(list_id)
            if task_list is not None:
                for field, value in defaults.items():
                    setattr(task_list, field, value)
                # A repeated remote id mutates the already-queued row
                # in place (last wins) instead of appending a second
                # CASE branch that Postgres would ignore.
                if task_list.pk is not None \
                        and task_list.pk not in queued:
                    to_update.append(task_list)
                    queued.add(task_list.pk)
            else:
                task_list = GoogleTaskList(
                    user=user,
                    list_id=list_id,
                    **defaults,
                )
                to_create.append(task_list)
                pending[list_id] = task_list

        # Sync writes bypass save()/signals — see _write_remote_tasks.
        if to_create:
            GoogleTaskList.objects.bulk_create(
                to_create,
                batch_size=500,
                update_conflicts=True,
                unique_fields=['user', 'list_id'],
                update_fields=['title', 'updated'],
            )
        if to_update:
            GoogleTaskList.objects.bulk_update(
                to_update,
                fields=['title', 'updated'],
                batch_size=500,
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


def push_local_changes(user, creds):
    """
    Push local task changes to Google Tasks API.
    Finds tasks where needs_push=True and pushes changes.

    Handles:
    - Field changes (title, notes, due, status)
    - Task deletions (is_deleted=True)
    - Tasks deleted remotely are recreated via insert (e.g. restores)
    - Note: Archived tasks are app-level only, not synced to Google

    Args:
        user: User object
        creds: Google credentials

    Returns: Dict with push stats or auth dict if reauth needed
    """
    logger.info(f'Pushing local changes for user {user.username}')

    stats = {
        'pushed': 0,
        'deleted': 0,
        'completed': 0,
        'uncompleted': 0,
        'recreated': 0,
        'errors': 0
    }

    try:
        service = get_tasks_service(creds)

        if isinstance(service, dict) and 'authorization_url' in service:
            return service

        # Find tasks with local changes not yet pushed to Google
        tasks_to_push = GoogleTask.objects.filter(
            user=user,
            is_divider=False,
            needs_push=True
        )

        logger.info(
            f'Found {tasks_to_push.count()} tasks with local changes'
        )

        for task in tasks_to_push:
            try:
                # Handle deleted tasks
                if task.is_deleted:
                    logger.info(
                        f'Deleting task {task.task_id} from Google Tasks'
                    )
                    result = delete_task_google(user, creds, task)
                    if isinstance(result, dict) and \
                            'authorization_url' in result:
                        return result
                    if result:
                        stats['deleted'] += 1
                        stats['pushed'] += 1
                        task.needs_push = False
                        task.last_synced_at = timezone.now()
                        task.save(update_fields=[
                            'needs_push', 'last_synced_at'
                        ])
                    else:
                        stats['errors'] += 1
                    continue

                # Handle field changes for existing tasks
                if not task.task_list or not task.task_list.list_id:
                    logger.warning(
                        f'Task {task.task_id} has no valid task list, '
                        f'skipping'
                    )
                    continue

                task_body = {
                    'id': task.task_id,
                    'title': task.title,
                    'status': task.status
                }
                if task.notes:
                    task_body['notes'] = task.notes
                if task.due_date:
                    task_body['due'] = task.due_date.isoformat()

                logger.info(
                    f'Pushing local changes for task {task.task_id} '
                    f'to Google Tasks'
                )

                try:
                    service.tasks().patch(
                        tasklist=task.task_list.list_id,
                        task=task.task_id,
                        body=task_body
                    ).execute()

                    if task.status == 'completed':
                        stats['completed'] += 1
                    else:
                        stats['uncompleted'] += 1

                    stats['pushed'] += 1
                    task.needs_push = False
                    task.last_synced_at = timezone.now()
                    task.save(update_fields=[
                        'needs_push', 'last_synced_at'
                    ])

                    logger.info(
                        f'Successfully pushed changes for task '
                        f'{task.task_id}'
                    )

                except HttpError as e:
                    if e.resp.status == 404:
                        # Task missing remotely (e.g. was deleted on
                        # Google while locally restored). App is the
                        # source of truth, so recreate it.
                        logger.warning(
                            f'Task {task.task_id} not found in Google '
                            f'Tasks. Recreating via insert.'
                        )
                        insert_body = {
                            k: v for k, v in task_body.items()
                            if k != 'id'
                        }
                        new_task = service.tasks().insert(
                            tasklist=task.task_list.list_id,
                            body=insert_body
                        ).execute()
                        task.task_id = new_task['id']
                        task.updated = parse_datetime(
                            new_task.get('updated')
                        )
                        task.needs_push = False
                        task.last_synced_at = timezone.now()
                        task.save(update_fields=[
                            'task_id', 'updated', 'needs_push',
                            'last_synced_at'
                        ])
                        stats['recreated'] += 1
                        stats['pushed'] += 1
                    else:
                        raise

            except Exception as e:
                logger.error(
                    f'Error pushing task {task.task_id}: '
                    f'{type(e).__name__}: {str(e)}'
                )
                stats['errors'] += 1
                continue

        logger.info(
            f'Push complete: {stats["pushed"]} pushed, '
            f'{stats["deleted"]} deleted, {stats["completed"]} completed, '
            f'{stats["uncompleted"]} uncompleted, '
            f'{stats["recreated"]} recreated, '
            f'{stats["errors"]} errors'
        )
        return stats

    except socket.timeout:
        logger.error(
            f'Timeout pushing local changes for user {user.username}'
        )
        return {'error': 'timeout'}
    except HttpError as error:
        logger.error(
            f'HttpError pushing local changes: '
            f'Status={error.resp.status}, Content={error.content}'
        )
        return {'error': 'http_error'}
    except Exception as e:
        logger.error(
            f'Unexpected error pushing local changes: '
            f'{type(e).__name__}: {str(e)}',
            exc_info=True
        )
        return {'error': 'unexpected'}


# Fields bulk_update writes for known remote ids and recurring merges.
# task_id is included so a merge can rewrite it in the same statement;
# created is written back with its unchanged value on normal updates
# (harmless) and set on merges; updated_at is stamped in memory since
# auto_now is not bumped by bulk_update.
TASK_BULK_UPDATE_FIELDS = [
    'task_id', 'task_list', 'title', 'notes', 'notes_doc',
    'due_date', 'status',
    'completed', 'updated', 'last_synced_at', 'created', 'updated_at',
]

# Fields written on ON CONFLICT for raced bulk_create inserts; created
# is deliberately excluded so an existing row keeps its original
# first-synced timestamp.
TASK_CREATE_UPSERT_FIELDS = [
    'task_list', 'title', 'notes', 'due_date', 'status',
    'completed', 'updated', 'last_synced_at', 'updated_at',
]


def _write_remote_tasks(user, pulls, remote_ids):
    """
    Mirror the remote pull into local GoogleTask rows.

    Every remote item classifies against one in-memory snapshot of the
    user's tasks, then all rows flush via bulk_create / bulk_update —
    the per-item update_or_create this replaced cost 2-4 queries per
    task (hundreds of WAN round-trips to Postgres), which pushed syncs
    past Vercel's 300s function cap.

    NOTE: bulk writes bypass save()/signals — a future save()
    override or signal receiver on GoogleTask will not run here.

    Recurring tasks: Google spawns a brand-new remote entity per
    occurrence and suppresses the previous one from tasks().list. If
    the remote id is unknown locally but exactly one open,
    same-titled local task in this list was dropped from the remote
    pull, treat the remote task as the next occurrence of the series
    and merge into that row (rewriting task_id) so stars, labels,
    ordering and pending edits carry over. With zero or several
    candidates the ambiguity resolves toward creating.

    Returns the local task snapshot (post-merge task_ids), reused by
    the ghost-cleanup pass so it does not re-select the table.
    """
    local_tasks = list(GoogleTask.objects.filter(user=user))
    by_task_id = {t.task_id: t for t in local_tasks}
    pending = {}  # task_id -> unsaved row already queued in to_create

    # Recurring-succession candidates, mirroring the old per-item ORM
    # filter. 'task_id not in remote_ids' is NOT baked into the index —
    # it is re-checked on the live object at consume time, because a
    # merged row's rewritten id IS remote and must stop matching later
    # same-titled items.
    candidates = {}
    for task in local_tasks:
        if (task.status == 'needsAction'
                and not task.is_deleted
                and not task.is_divider):
            key = (task.task_list_id, task.title)
            candidates.setdefault(key, []).append(task)

    sync_time = timezone.now()
    to_create, to_update = [], []
    queued = set()  # pks already in to_update

    for task_list, remote_items in pulls:
        for task_data in remote_items:
            defaults = {
                'task_list': task_list,
                'title': task_data.get('title', 'Untitled'),
                'notes': task_data.get('notes', ''),
                'due_date': parse_datetime(task_data.get('due')),
                'status': task_data.get('status', 'needsAction'),
                'completed': parse_datetime(task_data.get('completed')),
                'updated': parse_datetime(task_data.get('updated')),
                'last_synced_at': sync_time,
            }
            task_id = task_data['id']

            task = by_task_id.get(task_id)
            if task is None:
                task = pending.get(task_id)
            if task is not None:
                previous_notes = task.notes
                for field, value in defaults.items():
                    setattr(task, field, value)
                # A body rewritten on the Google side clears the
                # rich-text mirror — notes_doc is the doc for the
                # notes text we last synced, not for new remote
                # text. Matching remote text keeps the doc.
                if defaults['notes'] != (previous_notes or ''):
                    task.notes_doc = None
                task.updated_at = sync_time
                # A repeated remote id mutates the already-queued row
                # in place (last wins) instead of appending a second
                # CASE branch that Postgres would ignore.
                if task.pk is not None and task.pk not in queued:
                    to_update.append(task)
                    queued.add(task.pk)
                continue

            key = (task_list.pk, defaults['title'])
            open_candidates = [
                c for c in candidates.get(key, [])
                if c.task_id not in remote_ids
            ]

            if len(open_candidates) == 1:
                task = open_candidates[0]
                old_id = task.task_id
                del by_task_id[old_id]
                task.task_id = task_id
                by_task_id[task_id] = task
                previous_notes = task.notes
                for field, value in defaults.items():
                    setattr(task, field, value)
                if defaults['notes'] != (previous_notes or ''):
                    task.notes_doc = None
                task.created = sync_time
                task.updated_at = sync_time
                to_update.append(task)
                queued.add(task.pk)
                logger.info(
                    f'Recurring task: rewrote {old_id} -> '
                    f'{task_id} for \'{defaults["title"]}\''
                )
            else:
                task = GoogleTask(
                    user=user,
                    task_id=task_id,
                    created=sync_time,
                    updated_at=sync_time,
                    **defaults,
                )
                to_create.append(task)
                pending[task_id] = task

    if to_create:
        # update_conflicts heals rows raced in by a concurrent sync
        # (same remote id inserted after classification) instead of
        # failing the whole batch on the unique task_id constraint —
        # global by design since Google task ids are globally unique.
        GoogleTask.objects.bulk_create(
            to_create,
            batch_size=500,
            update_conflicts=True,
            unique_fields=['task_id'],
            update_fields=TASK_CREATE_UPSERT_FIELDS,
        )
    if to_update:
        GoogleTask.objects.bulk_update(
            to_update,
            fields=TASK_BULK_UPDATE_FIELDS,
            batch_size=500,
        )

    return local_tasks


def _trash_ghost_tasks(pulls, remote_ids, local_tasks):
    """
    Trash local rows whose remote entity vanished from tasks().list
    while a same-titled remote task still exists in the same list.

    These are the superseded occurrences of recurring series (Google
    parks them at position INT32_MAX, invisible to list). They are
    marked is_deleted + needs_push so the next push issues real remote
    deletes — invisible cleanup consistent with "app is source of
    truth". Completed and open ghosts alike are trashed; dividers are
    never remote entities and are excluded.

    Detection is pure in-memory over the snapshot _write_remote_tasks
    already loaded — merged rows carry their rewritten remote id by
    now, so they correctly stop matching. One UPDATE per sync instead
    of a SELECT+UPDATE per list (each query is a fresh connection
    under CONN_MAX_AGE=0 on cloud deploys).
    """
    remote_titles = {
        task_list.pk: {t.get('title', 'Untitled') for t in items}
        for task_list, items in pulls
    }
    ghost_pks = [
        task.pk for task in local_tasks
        if not task.is_deleted
        and not task.is_divider
        and task.task_id not in remote_ids
        and task.title in remote_titles.get(task.task_list_id, ())
    ]
    if not ghost_pks:
        return 0

    count = GoogleTask.objects.filter(pk__in=ghost_pks).update(
        is_deleted=True,
        deleted_at=timezone.now(),
        needs_push=True,
    )
    logger.info(
        f'Trashed {count} ghost task(s) '
        f'(superseded recurring occurrences)'
    )
    return count


def _pull_list_pages(creds, task_list):
    """
    Fetch every tasks().list page for one task list (read-only).

    Builds its own service — httplib2.Http is not thread-safe, so
    parallel pulls cannot share one. Returns the item list, or the
    auth dict when get_tasks_service signals reauth.
    """
    service = get_tasks_service(creds)
    if isinstance(service, dict) and 'authorization_url' in service:
        return service

    remote_items = []
    page_token = None
    while True:
        results = service.tasks().list(
            tasklist=task_list.list_id,
            maxResults=100,
            showCompleted=True,
            showHidden=True,
            pageToken=page_token
        ).execute()
        remote_items.extend(results.get('items', []))
        page_token = results.get('nextPageToken')
        if not page_token:
            break
    logger.info(
        f'Fetched {len(remote_items)} tasks from {task_list.title}'
    )
    return remote_items


def sync_tasks(user, creds, task_list_id=None):
    """
    Bidirectional sync between local DB and Google Tasks API.

    Process:
    1. Push local changes to Google (field changes, deletions)
    2. Pull updates from Google Tasks API

    Sync tracking:
    - needs_push: Local changes pending push to Google
    - last_synced_at: When we last synced with Google

    Args:
        user: User object
        creds: Google credentials
        task_list_id: Optional - sync only this list, else sync all

    Returns: True on success, or auth dict if reauth needed
    """
    try:
        started = time.monotonic()

        # First, push any local changes to Google
        logger.info('Step 1: Pushing local changes to Google Tasks')
        push_result = push_local_changes(user, creds)

        if isinstance(push_result, dict) and 'authorization_url' in \
                push_result:
            return push_result
        push_elapsed = time.monotonic() - started

        # Now pull updates from Google
        logger.info('Step 2: Pulling updates from Google Tasks')

        if task_list_id:
            task_lists = [
                GoogleTaskList.objects.get(user=user, list_id=task_list_id)
            ]
            logger.info(
                f'Syncing tasks for specific list: {task_list_id}'
            )
        else:
            task_lists = list(GoogleTaskList.objects.filter(user=user))
            logger.info(
                f'Syncing tasks for all {len(task_lists)} lists'
            )

        # Fetch every list's pages before writing: recurring-
        # succession detection and ghost cleanup need the complete
        # remote id set, and a task moved between lists remotely must
        # not look like a suppressed occurrence in its old list.
        # Lists pull in parallel — each page is a ~0.2-0.5s remote
        # round-trip and pages within a list must stay sequential
        # (nextPageToken), so serial pulls dominated sync wall-time.
        pull_started = time.monotonic()
        pulls = []
        with ThreadPoolExecutor(
            max_workers=min(8, max(1, len(task_lists)))
        ) as pool:
            for task_list, remote_items in pool.map(
                lambda tl: (tl, _pull_list_pages(creds, tl)),
                task_lists
            ):
                if isinstance(remote_items, dict) and \
                        'authorization_url' in remote_items:
                    return remote_items
                pulls.append((task_list, remote_items))
        pull_elapsed = time.monotonic() - pull_started

        write_started = time.monotonic()
        remote_ids = {
            t['id'] for _, items in pulls for t in items
        }
        local_tasks = _write_remote_tasks(user, pulls, remote_ids)
        write_elapsed = time.monotonic() - write_started

        # Ghost detection runs on the post-merge snapshot: merged rows
        # already carry their new remote task_id in memory, so they do
        # not look like superseded occurrences.
        ghost_started = time.monotonic()
        _trash_ghost_tasks(pulls, remote_ids, local_tasks)
        ghost_elapsed = time.monotonic() - ghost_started

        total_synced = sum(len(items) for _, items in pulls)
        logger.info(
            f'Synced {total_synced} tasks for user {user.username} '
            f'in {time.monotonic() - started:.1f}s '
            f'(push={push_elapsed:.1f}s pull={pull_elapsed:.1f}s '
            f'write={write_elapsed:.1f}s ghosts={ghost_elapsed:.1f}s)'
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

        # Update local DB and mark as synced since we just pushed to
        # Google. needs_push is left untouched: if other local field
        # changes were pending, they still need to be pushed.
        sync_time = timezone.now()
        task.status = 'completed'
        task.completed = sync_time
        task.updated = parse_datetime(response.get('updated'))
        task.last_synced_at = sync_time
        task.save(update_fields=[
            'status', 'completed', 'updated', 'last_synced_at'
        ])

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

        # Update local DB and mark as synced since we just pushed to
        # Google. needs_push is left untouched: if other local field
        # changes were pending, they still need to be pushed.
        sync_time = timezone.now()
        task.status = 'needsAction'
        task.completed = None
        task.updated = parse_datetime(response.get('updated'))
        task.last_synced_at = sync_time
        task.save(update_fields=[
            'status', 'completed', 'updated', 'last_synced_at'
        ])

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


def remove_starred_hashtags(notes):
    """
    Remove starred-related hashtags from notes.
    Matches: #star, #starred, #start, #starr (and variations)

    This prevents auto-starring when periodic hashtag checks run.

    Args:
        notes: String containing task notes

    Returns: String with starred-related hashtags removed
    """
    if not notes:
        return notes

    # Pattern matches the same starred-related hashtags that
    # process_task_labels checks for:
    # - #star (exactly)
    # - #starred (exactly)
    # - #start (exactly)
    # - #starr* (starr followed by any letters)
    pattern = r'#(star(?:red)?|start|starr[a-z]*)\b'
    cleaned_notes = re.sub(pattern, '', notes, flags=re.IGNORECASE)

    # Clean up any double spaces left by removal
    cleaned_notes = re.sub(r'\s+', ' ', cleaned_notes).strip()

    return cleaned_notes


# --- Quick notes (#notes-<path> markers) ---
#
# A `#notes` marker anywhere in the title or body turns a task into
# a note filed under an auto-created category tree of arbitrary
# depth. The dedicated hyphen-aware pattern below owns marker
# detection — the shared extract_hashtags regex splits on hyphens
# and must stay untouched, or '#notes-projects-django-apps' would
# extract as four unrelated tags. Spelling convention: EVERY '-'
# separates one category level ('#notes-a-b-c' → a → b → c), and
# '_' is the ONLY word-joiner inside a segment — multi-word names
# MUST spell 'django_apps', since 'django-apps' nests deeper.
# Classification strips matched text BEFORE hashtag extraction, so
# marker fragments can never reach label matching, unmatched-tag
# warnings, list moves, or star keywords — which is also what
# keeps notes in their original Google list.
NOTE_TAG_RE = re.compile(
    # Segments may be empty (`*`, not `+`) so separators still match
    # — '#notes--x', '#notes-abc-', '#notes-' parse like their
    # canonical spellings and the segment parser drops the empties.
    # The lookahead still rejects '#notebook-x'/'#notesx', and a
    # trailing dash is part of the match so stripping removes it.
    r'#notes(?:-[a-z0-9_]*)*(?![a-z0-9_-])',
    re.IGNORECASE,
)


def find_note_marker(title, notes):
    """First #notes marker in the title or body, else None."""
    match = NOTE_TAG_RE.search(title or '')
    if match is None:
        match = NOTE_TAG_RE.search(notes or '')
    return match


def note_marker_segments(marker_text):
    """'#notes-bible_research-gen-1' → ['bible_research', 'gen', '1'].

    Every '-' separates ONE category level — the returned list is
    the category path. Segments are lowercased and KEEP their
    underscores ('_' is the only in-segment word-joiner, so a
    composed marker re-parses to the identical chain); repeated
    '_' collapse and edge '_' trim; empties drop out
    ('#notes--x' ≡ '#notes-x').
    """
    tail = marker_text[len('#notes'):]
    segments = []
    for segment in tail.split('-'):
        slug = re.sub(r'_+', '_', segment.lower()).strip('_')
        if slug:
            segments.append(slug)
    return segments


def slugify_note_segment(name):
    """'Bible Research!' → 'bible_research' — the canonical slug a
    user-typed category name folds to. Word runs join with '_' so
    the composed marker re-parses as ONE segment ('-' would mean
    another level)."""
    return re.sub(r'[^a-z0-9]+', '_', name.lower()).strip('_')


def note_display_name(slug):
    """'bible_research' → 'Bible Research' — display name for
    auto-created categories."""
    return slug.replace('_', ' ').title()


def note_category_path(category):
    """The slug chain from the tree root down to `category` —
    ['projects', 'world_of_bible', 'easter_eggs']; [] for the
    uncategorized bucket (None). Each ancestor dereference is one
    lazy query, fine at category-manage call sites."""
    slugs = []
    node = category
    # A corrupted parent cycle would loop forever — the seen set
    # truncates it (mirrors the frontend tree builders). Unsaved
    # instances have pk=None and are keyed by identity instead.
    seen = set()
    while node is not None:
        key = node.pk if node.pk is not None else ('obj', id(node))
        if key in seen:
            break
        seen.add(key)
        slugs.append(node.slug)
        node = getattr(node, 'parent', None)
    slugs.reverse()
    return slugs


def _marker_for_segments(segments):
    """'#notes-a-b' for ['a', 'b']; bare '#notes' for []."""
    if not segments:
        return '#notes'
    return '#notes-' + '-'.join(segments)


def note_marker_for(category):
    """Canonical '#notes-<path>' marker text for a category; the
    bare '#notes' marker for the uncategorized bucket (None)."""
    return _marker_for_segments(note_category_path(category))


def note_category_index(user):
    """{(parent_id, slug): NoteCategory} covering the user's whole
    tree — the single prefetch processing runs share."""
    return {
        (category.parent_id, category.slug): category
        for category in NoteCategory.objects.filter(user=user)
    }


def resolve_note_category(user, segments, index=None):
    """Resolve a marker path to a NoteCategory, auto-creating
    missing nodes for `user`.

    [] → None (uncategorized); ['x'] → top-level x;
    ['x', 'y', 'z', …] → the nested chain x → y → z — one
    NoteCategory per segment, the last is returned. `index` is an
    optional note_category_index() dict — pass it in hot loops so
    the user's categories are prefetched once instead of
    re-queried per task.
    """
    if not segments:
        return None
    if index is None:
        index = note_category_index(user)
    parent = None
    for slug in segments:
        key = (parent.pk if parent is not None else None, slug)
        node = index.get(key)
        if node is None:
            node = NoteCategory.objects.create(
                user=user,
                slug=slug,
                name=note_display_name(slug),
                parent=parent,
            )
            index[key] = node
        parent = node
    return parent


def _collapse_marker_whitespace(text):
    """Collapse the whitespace a stripped marker leaves behind.

    Only HORIZONTAL whitespace collapses — `[ \t]+` runs fold to a
    single space and each line is stripped. Newlines are paragraph
    breaks in note bodies and must survive; collapsing all `\s+`
    flattened multi-paragraph bodies into one line on every retag.
    """
    lines = (
        re.sub(r'[ \t]+', ' ', line).strip(' \t')
        for line in text.split('\n')
    )
    return '\n'.join(lines).strip()


def strip_note_marker(title, notes):
    """Remove every #notes marker occurrence from title/notes.

    Returns (title, notes) — in-memory only: the stored text keeps
    the marker, which is the source of truth the next processing
    run reclassifies from.
    """
    return (
        _collapse_marker_whitespace(
            NOTE_TAG_RE.sub('', title or '')
        ),
        _collapse_marker_whitespace(
            NOTE_TAG_RE.sub('', notes or '')
        ),
    )


def rewrite_note_marker(task, new_marker):
    """Replace the first #notes marker wherever it lives (title or
    body) with `new_marker` and drop any further occurrences.
    Returns True when the stored text changed."""
    changed = False
    written = False
    for field in ('title', 'notes'):
        text = getattr(task, field) or ''
        if not NOTE_TAG_RE.search(text):
            continue

        def _sub(match):
            nonlocal written
            if written:
                return ''
            written = True
            return new_marker

        new_text = _collapse_marker_whitespace(
            NOTE_TAG_RE.sub(_sub, text)
        )
        if new_text != text:
            setattr(task, field, new_text)
            changed = True
    return changed


def retag_notes(user, source_path, path_for):
    """Rewrite the first #notes marker in each of `user`'s notes
    filed under `source_path`'s subtree.

    A note matches when its marker's leading segments equal
    `source_path` — so a mid-chain path like
    ['projects', 'world_of_bible'] covers both the direct members
    and the deeper '#notes-projects-world_of_bible-easter_eggs'
    descendants. `path_for` maps the note's current segment list
    to its new segment list ([] → the bare '#notes' marker).
    Returns [(note, new_segments)] for rows whose text actually
    changed — a marker already carrying the target text (e.g. a
    name-only rename whose slug did not move) must not inflate the
    count or get flagged for a no-op push. The caller flushes
    title/notes/needs_push (plus note_category when it also
    repoints notes) via bulk_update.
    """
    retagged = []
    prefix = list(source_path)
    notes = GoogleTask.objects.filter(user=user, is_note=True)
    for note in notes:
        match = find_note_marker(note.title, note.notes)
        if match is None:
            continue
        segments = note_marker_segments(match.group(0))
        if segments[:len(prefix)] != prefix:
            continue
        new_segments = path_for(segments)
        if rewrite_note_marker(
                note, _marker_for_segments(new_segments)):
            note.needs_push = True
            retagged.append((note, new_segments))
    return retagged


def rename_note_category(category, new_slug, new_name):
    """Rename a category and retag member markers.

    The marker is the source of truth the next processing run
    reclassifies from, so every note filed under the old path gets
    its marker rewritten (and flagged for push) — a typo category
    collapses permanently, in Google too. Members keep their
    depth: renaming 'projects/world_of_bible' to 'bible' retags
    '…-world_of_bible-easter_eggs' → '…-bible-easter_eggs'.
    Returns the number of notes retagged.
    """
    old_path = note_category_path(category)
    new_path = old_path[:-1] + [new_slug]

    def path_for(segs):
        return new_path + segs[len(old_path):]

    # One transaction: a mid-retag failure must not leave the
    # category renamed while its members keep the old markers.
    with transaction.atomic():
        category.slug = new_slug
        category.name = new_name
        category.save(update_fields=['slug', 'name'])
        retagged = retag_notes(category.user, old_path, path_for)
        if retagged:
            GoogleTask.objects.bulk_update(
                [note for note, _ in retagged],
                ['title', 'notes', 'needs_push'],
                batch_size=500,
            )
    return len(retagged)


def retarget_note_category(user, source, target):
    """Fold `source`'s whole subtree into `target` (None →
    uncategorized): member markers are retagged to the target
    path, KEEPING the tail below the source ('x-src-a-b' merges
    into 'tgt' as 'tgt-a-b', or 'a-b' at the top level when the
    target is uncategorized). note_category is repointed —
    resolving the new path so deeper members land on recreated
    tail categories — and the source plus its descendant
    categories are deleted. Backs both category merge and category
    delete — the marker stays accurate either way. Returns the
    number of notes retagged.
    """
    source_path = note_category_path(source)
    target_path = note_category_path(target)

    def path_for(segs):
        return target_path + segs[len(source_path):]

    # One transaction: a mid-retag failure must not leave member
    # markers half-rewritten or the source deleted with stale
    # markers still pointing at it.
    with transaction.atomic():
        retagged = retag_notes(user, source_path, path_for)
        category_index = note_category_index(user)
        for note, new_segments in retagged:
            note.note_category = resolve_note_category(
                user, new_segments, index=category_index
            )
        if retagged:
            GoogleTask.objects.bulk_update(
                [note for note, _ in retagged],
                ['title', 'notes', 'needs_push', 'note_category'],
                batch_size=500,
            )
        source.delete()
    return len(retagged)


def match_label(hashtag, user, create_if_missing=None, labels=None):
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
        labels: Optional prefetched iterable of the user's TaskLabels.
            Fetched when not provided; pass it in hot loops so
            matching does not re-query per hashtag.

    Returns: TaskLabel object (existing or newly created),
        or None if no match and creation not allowed
    """
    if create_if_missing is None:
        create_if_missing = LABEL_AUTO_CREATE

    hashtag_lower = hashtag.lower()
    if labels is None:
        labels = list(TaskLabel.objects.filter(user=user))

    # 1. Exact match (case-insensitive)
    for label in labels:
        if label.name.lower() == hashtag_lower:
            logger.info(f'Exact match: #{hashtag} -> {label.name}')
            return label

    # 2. Starts-with match (first 4+ chars)
    if len(hashtag_lower) >= LABEL_MIN_PREFIX_LENGTH:
        for label in labels:
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

    for label in labels:
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
        for label in labels:
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

        # Update local database. needs_push is left untouched: any
        # pending local field changes still need to be pushed to the
        # task's new remote ID.
        task.task_id = new_task['id']
        task.task_list = target_list
        task.updated = parse_datetime(new_task.get('updated'))
        task.last_synced_at = timezone.now()
        task.save(update_fields=[
            'task_id', 'task_list', 'updated', 'last_synced_at'
        ])

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


def _star_task_at_top(task):
    """
    Star a task and place it at the top of the starred view:
    existing starred tasks shift down one position and the new
    task takes starred_order 1.
    """
    with transaction.atomic():
        GoogleTask.objects.filter(
            user=task.user, is_starred=True
        ).update(starred_order=F('starred_order') + 1)
        task.is_starred = True
        task.starred_order = 1
        task.save()


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

    Hashtags that match no existing label are skipped (no label
    assigned) and reported in stats['unmatched'] — they never abort
    processing of the remaining tasks.

    Args:
        user: User object
        creds: Google credentials
        task_id: Optional specific task ID to process

    Returns: Dict with stats
        {
            'processed': int,
            'moved': int,
            'starred': int,
            'labels_assigned': int,
            'errors': int,
            'unmatched': [{'task_title': str, 'hashtag': str}, ...],
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
        'notes': 0,
        'unmatched': [],
        'details': []
    }

    started = time.monotonic()

    # Get tasks to process (exclude dividers). task_list is
    # select_related'd: the move check below dereferences it for
    # every hashtag-bearing task.
    if task_id:
        tasks = GoogleTask.objects.filter(
            user=user,
            task_id=task_id,
            is_divider=False
        ).select_related('task_list')
    else:
        tasks = GoogleTask.objects.filter(
            user=user,
            status='needsAction',
            is_divider=False
        ).select_related('task_list')

    # Get all task lists and labels once — per-item ORM calls in this
    # loop cost one fresh connection each on cloud deploys
    # (CONN_MAX_AGE=0), which dominated sync wall-time.
    task_lists = list(GoogleTaskList.objects.filter(user=user))
    user_labels = list(TaskLabel.objects.filter(user=user))
    through_model = GoogleTask.labels.through

    # Notes pre-pass: a #notes marker classifies the task as a note
    # (resolving/auto-creating its category path) and its text is
    # stripped before hashtag extraction, so marker fragments can
    # never reach match_label / match_task_list / star keywords.
    # One category prefetch keeps the pass flat — is_note and
    # note_category writes flush through the single bulk_update
    # below, not per-task saves. The marker itself stays in the
    # stored title/notes: it is the source of truth the next run
    # reclassifies from.
    category_index = note_category_index(user)
    note_updates = []
    stripped_text = {}
    for task in tasks:
        marker = find_note_marker(task.title, task.notes)
        if marker is not None:
            segments = note_marker_segments(marker.group(0))
            category = resolve_note_category(
                user, segments, index=category_index
            )
            category_id = category.pk if category else None
            if (not task.is_note
                    or task.note_category_id != category_id):
                note_updates.append(task)
            task.is_note = True
            task.note_category = category
            stats['notes'] += 1
            stripped_text[task.pk] = strip_note_marker(
                task.title, task.notes
            )
        elif task.is_note or task.note_category_id is not None:
            # Marker removed since the last run → plain task again.
            task.is_note = False
            task.note_category = None
            note_updates.append(task)
    if note_updates:
        GoogleTask.objects.bulk_update(
            note_updates,
            ['is_note', 'note_category'],
            batch_size=500,
        )

    def _texts(task):
        """Title/notes for hashtag extraction — the marker-stripped
        version for notes, the stored text otherwise."""
        return stripped_text.get(
            task.pk, (task.title, task.notes or '')
        )

    # Pre-pass: match all hashtags to existing labels before
    # modifying anything. Collect unmatched hashtags so they can
    # be reported all at once — they only forfeit their own label
    # assignment, never the rest of the run.
    task_labels_map = {}
    unmatched = []
    through_rows = []

    for task in tasks:
        proc_title, proc_notes = _texts(task)
        hashtags = extract_hashtags(proc_title)
        hashtags += extract_hashtags(proc_notes)

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
                hashtag, user,
                create_if_missing=False,
                labels=user_labels,
            )
            if label:
                labels.append(label)
            else:
                unmatched.append({
                    'task_title': task.title,
                    'hashtag': hashtag
                })

        task_labels_map[task.task_id] = labels

    stats['unmatched'] = unmatched
    if unmatched:
        logger.warning(
            'Unmatched hashtags during label processing: %s',
            '; '.join(
                f'#{u["hashtag"]} (task: "{u["task_title"]}")'
                for u in unmatched
            )
        )

    for task in tasks:
        stats['processed'] += 1
        detail = {
            'task_id': task.task_id,
            'title': task.title,
            'action': 'none',
            'message': ''
        }

        # Extract hashtags from title and notes (marker text was
        # already stripped for notes in the pre-pass above).
        proc_title, proc_notes = _texts(task)
        hashtags = []
        hashtags.extend(extract_hashtags(proc_title))
        hashtags.extend(extract_hashtags(proc_notes))

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

        # Assign pre-matched TaskLabels for ALL non-starred hashtags.
        # Through rows are queued and bulk-inserted after the loop —
        # one write instead of one per (task, label) pair.
        assigned_labels = []
        for label in task_labels_map.get(task.task_id, []):
            through_rows.append(through_model(
                googletask_id=task.pk,
                tasklabel_id=label.pk,
            ))
            assigned_labels.append(label.name)
            stats['labels_assigned'] += 1

        if assigned_labels:
            logger.info(
                f'Task "{task.title}" assigned labels: {assigned_labels}'
            )

        # If only starred keyword and no other hashtags, just star it
        if should_star and not non_starred_hashtags:
            if not task.is_starred:
                _star_task_at_top(task)
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
                _star_task_at_top(task)
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
                _star_task_at_top(task)
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

    if through_rows:
        # ignore_conflicts mirrors labels.add() idempotency — rows
        # already linked are skipped instead of erroring the batch.
        through_model.objects.bulk_create(
            through_rows, ignore_conflicts=True
        )

    logger.info(
        f'Label processing complete: {stats["processed"]} processed, '
        f'{stats["moved"]} moved, {stats["starred"]} starred, '
        f'{stats["labels_assigned"]} labels assigned, '
        f'{stats["errors"]} errors, '
        f'{len(stats["unmatched"])} unmatched hashtags, '
        f'{time.monotonic() - started:.1f}s'
    )

    return stats
