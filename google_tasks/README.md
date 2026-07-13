# Google Tasks Integration

This Django app provides integration with Google Tasks API, allowing users to sync, view, and manage their Google Tasks with additional local features like starring and custom labels.

## Features

- **Task Synchronization**: Sync task lists and tasks from Google Tasks API
- **Starred Tasks**: Mark tasks as starred for quick access (local-only feature)
- **Custom Labels**: Create and assign custom labels to tasks (local-only feature)
- **Task Lists**: View and filter tasks by their native Google Task Lists
- **Bootstrap UI**: Modern, responsive interface using Bootstrap 5

## Architecture

This app follows a decoupled architecture:
- **google_api**: Handles OAuth2 authentication and provides reusable utilities
- **google_tasks**: Manages task-specific logic, models, and UI

## Models

### GoogleTaskList
Caches user's Google Task Lists locally.
- `list_id`: Google's unique identifier
- `title`: List name
- `updated`: Last update timestamp

### TaskLabel
Local-only custom labels/tags.
- `name`: Label name
- `color`: Hex color code for visual distinction

### GoogleTask
Mirrors individual tasks from Google Tasks.
- `task_id`: Google's unique identifier
- `title`, `notes`: Task content
- `due_date`, `status`, `completed`: Task metadata
- `is_starred`: Local-only starred status
- `local_labels`: Many-to-many relationship with TaskLabel

## URL Structure

- `/tasks/` - Main dashboard
- `/tasks/starred/` - Starred tasks view
- `/tasks/sync/` - Manual sync endpoint
- `/tasks/task/<task_id>/toggle-star/` - Toggle star status
- `/tasks/task/<task_id>/add-label/` - Add label to task
- `/tasks/task/<task_id>/remove-label/<label_id>/` - Remove label
- `/tasks/label/create/` - Create new label

## Setup

1. Ensure `google_tasks` is in `INSTALLED_APPS`
2. Run migrations: `python manage.py migrate google_tasks`
3. Configure Google OAuth2 credentials in `google_api/app_secrets.json`
4. Add Tasks API scope: `https://www.googleapis.com/auth/tasks`

## Usage

1. Navigate to `/tasks/`
2. Authenticate with Google (if not already authenticated)
3. Click "Sync Now" to fetch tasks from Google
4. Use sidebar to filter by task lists or custom labels
5. Click star icon to mark tasks as starred
6. Create custom labels and assign them to tasks

## Dependencies

All required dependencies are already in the main `requirements.txt`:
- `google-api-python-client`
- `google-auth`
- `google-auth-oauthlib`
