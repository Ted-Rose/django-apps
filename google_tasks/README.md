# Google Tasks Integration

This Django app provides integration with Google Tasks API, allowing
users to sync, view, and manage their Google Tasks with additional
local features like starring.

## Features

- **Task Synchronization**: Sync task lists and tasks from Google
  Tasks API
- **Starred Tasks**: Mark tasks as starred for quick access
  (local-only feature)
- **Task Dividers**: Add visual dividers (horizontal lines) to organize
  tasks into groups (local-only feature)
- **Task Lists**: View and filter tasks by their native Google Task
  Lists
- **Bootstrap UI**: Modern, responsive interface using Bootstrap 5
- **Drag & Drop Reordering**: Reorder starred tasks with drag-and-drop
- **Task Completion**: Mark tasks as complete/incomplete with sync to
  Google
- **Label Movement**: Automatically process hashtags in task notes to
  move tasks to matching task lists and star them

## Architecture

This app follows a decoupled architecture:
- **google_api**: Handles OAuth2 authentication and provides reusable
  utilities
- **google_tasks**: Manages task-specific logic, models, and UI

### Key Components

- **Models** (`models.py`): Data models for task lists and tasks
- **Services** (`services.py`): Business logic for Google Tasks API
  integration
- **Views** (`views.py`): Request handlers for all user interactions
- **Templates**: Bootstrap 5-based responsive UI with AJAX
  functionality

## Models

### GoogleTaskList
Caches user's Google Task Lists locally.
- `user`: ForeignKey to User model
- `list_id`: Google's unique identifier (unique)
- `title`: List name
- `updated`: Last update timestamp
- **Ordering**: By title alphabetically
- **Unique constraint**: (user, list_id)

### GoogleTask
Mirrors individual tasks from Google Tasks with local enhancements.
- `user`: ForeignKey to User model
- `task_id`: Google's unique identifier (unique)
- `task_list`: ForeignKey to GoogleTaskList
- `title`: Task title (max 500 chars)
- `notes`: Task notes/description (optional)
- `due_date`: Due date/time (optional)
- `status`: 'needsAction' or 'completed'
- `completed`: Completion timestamp (optional)
- `updated`: Last update timestamp
- `is_starred`: Local-only starred status (default: False)
- `is_divider`: Local-only divider status (default: False)
- `task_order`: Custom manual ordering for all tasks (optional)
- **Ordering**: By task_order (nulls last), then updated (descending)
- **Unique constraint**: (user, task_id)

## URL Structure

| URL Pattern | View | Method | Description |
|------------|------|--------|-------------|
| `/tasks/` | `dashboard` | GET | Main dashboard with all tasks |
| `/tasks/starred/` | `starred_tasks` | GET | Starred tasks view |
| `/tasks/starred/reorder/` | `reorder_starred` | POST | Save drag-drop order (starred) |
| `/tasks/tasks/reorder/` | `reorder_tasks` | POST | Save drag-drop order (all tasks) |
| `/tasks/sync/` | `sync_view` | GET | Manual sync endpoint |
| `/tasks/task/<task_id>/toggle-star/` | `toggle_star` | POST | Toggle star status |
| `/tasks/task/<task_id>/complete/` | `complete_task_view` | POST | Mark task complete |
| `/tasks/task/<task_id>/uncomplete/` | `uncomplete_task_view` | POST | Mark task incomplete |
| `/tasks/process-labels/` | `process_labels_view` | POST | Process labels for all active tasks |
| `/tasks/task/<task_id>/process-label/` | `process_task_label_view` | POST | Process label for specific task |
| `/tasks/divider/create/` | `create_divider` | POST | Create a new task divider |
| `/tasks/divider/<task_id>/delete/` | `delete_divider` | POST | Delete a task divider |

## Behavior Details

### Authentication & Authorization
- All views require login (`@login_required`)
- OAuth2 credentials stored in session as `google_credentials`
- Automatic re-authentication flow when credentials expire
- Required scope: `https://www.googleapis.com/auth/tasks`

### Task Synchronization
**Sync Process** (`sync_all` in services.py):
1. Sync task lists from Google (up to 100 lists)
2. For each list, sync all tasks using pagination (fetches all tasks
   regardless of count)
3. Updates existing tasks or creates new ones
4. Preserves local-only fields (is_starred, task_order)

**Triggered by**:
- Clicking "Sync Now" button (adds `?sync=true` to URL)
- Manual call to `/tasks/sync/` endpoint

**Data Flow**:
- Google API → `sync_task_lists()` → GoogleTaskList model
- Google API → `sync_tasks()` → GoogleTask model
- Uses `update_or_create()` to prevent duplicates

### Task Filtering
**Dashboard View** supports task list filtering:
- **Task List Filter**: `?list=<list_id>` - Show tasks from specific
  list
- Active and completed tasks shown separately

### Task Ordering
**Drag-and-Drop Reordering**:
- Available in all views (dashboard, starred, list-filtered)
- Uses SortableJS library for smooth drag-and-drop
- Custom ordering saved in `task_order` field
- Ordered by: task_order (nulls last), then updated (descending)
- Visual drag handle with grip icon on all task cards
- Auto-save indicator on reorder
- Per-list ordering when viewing a specific list
- Global ordering when viewing all tasks

**Toggle Behavior**:
- AJAX POST to toggle star on/off
- Returns JSON with new state
- Updates UI without page reload
- Star icon changes color (yellow when starred)

### Task Completion
**Complete Task**:
- AJAX POST to `/tasks/task/<task_id>/complete/`
- Updates Google Tasks API via `tasks().patch()`
- Sets status='completed' and completed=now()
- Shows confirmation modal before completing
- Moves task to "Completed Tasks" section

**Uncomplete Task**:
- AJAX POST to `/tasks/task/<task_id>/uncomplete/`
- Updates Google Tasks API via `tasks().patch()`
- Sets status='needsAction' and clears completed timestamp
- Moves task back to active tasks

**Error Handling**:
- Comprehensive logging at each step
- Returns JSON with success/error status
- Handles re-authentication if needed
- User-friendly error messages

### Label Movement
**Hashtag Detection**:
- Scans task title and notes for hashtags (e.g., `#Phys`, `#Work`)
- Pattern: `#` followed by 3+ letters
- Case-insensitive matching

**Task List Matching**:
- Exact match: `#Physical` → "Physical" task list
- Partial match (4 chars): `#Phys` → "Physical" task list
- Partial match (3 chars): `#Phy` → "Physical" task list
- Uses first matched hashtag if multiple found

**Processing**:
- Click "Process Labels" button in navbar
- Processes all active (non-completed) tasks
- Moves tasks to matched task lists via Google Tasks API
- Automatically stars moved tasks
- Shows summary of processed, moved, starred, and errors

**Task Movement**:
- Since Google Tasks API has no direct move operation:
  1. Gets full task data from source list
  2. Creates new task in target list
  3. Deletes task from source list
  4. Updates local database with new task ID
- Preserves: title, notes, due date, status
- Updates: task_id, task_list, is_starred

**Edge Cases**:
- Task already in correct list: Just stars it
- No hashtag found: Skips task
- No matching list: Skips task, logs for review
- Multiple hashtags: Uses first matched hashtag

### Task Dividers
**Visual Organization**:
- Add horizontal dividers (dashed lines) between tasks
- Organize tasks into logical groups or sections
- Local-only feature (does not sync to Google Tasks)

**Creating Dividers**:
- Click "Add Divider" button in filter bar
- Divider appears at bottom of task list
- Drag to desired position between tasks
- Unique task_id format: `divider_{uuid}`

**Managing Dividers**:
- Drag and drop to reorder (uses same ordering as tasks)
- Hover to reveal delete button
- Click X to remove divider
- Confirmation dialog prevents accidental deletion

**Technical Details**:
- Stored as GoogleTask with `is_divider=True`
- Empty title and no notes/due dates
- Excluded from Google Tasks sync operations
- Cannot be completed/uncompleted
- Works in all views (All Tasks, Starred, List-filtered)

**Use Cases**:
- Separate tasks by priority (High/Medium/Low)
- Group by category (Work/Personal/Shopping)
- Organize by timeline (Today/This Week/Later)
- Create visual breathing room in long task lists

### UI/UX Features
**Dashboard**:
- Bootstrap 5 responsive layout
- Filter bar with dropdown for task lists
- Separate sections for active and completed tasks
- Task cards with hover effects
- Icons from Bootstrap Icons

**Task Cards Display**:
- Title with completion checkbox and star button
- Due date badge (if set)
- Notes preview (if present)
- Task list name

**Interactive Elements**:
- All actions use AJAX (no page reloads)
- JSON responses for all POST endpoints
- Visual feedback (spinners, color changes)
- Modals for confirmations (complete task)
- Toast notifications (via save indicator)

**Starred View Specifics**:
- Drag handle visible on each card
- SortableJS library for drag-and-drop
- Ghost effect during drag
- Auto-save on drop
- Save indicator (fixed bottom-right)

### Error Handling & Edge Cases
**Re-authentication**:
- Services return `{'authorization_url': '...', 'state': '...'}`
- Views detect this and redirect to OAuth flow
- Session stores redirect URL for post-auth return

**Missing Credentials**:
- Views check for `google_credentials` in session
- Returns JSON error if missing
- UI shows "No credentials" message

**API Errors**:
- HttpError caught and logged
- Returns False or JSON error response
- User sees error message in UI

**Data Integrity**:
- `unique_together` constraints prevent duplicates
- `get_object_or_404` ensures user owns the resource
- All modifications filtered by `user=request.user`

## Setup

1. Ensure `google_tasks` is in `INSTALLED_APPS`
2. Run migrations: `python manage.py migrate google_tasks`
3. Configure Google OAuth2 credentials in `google_api/app_secrets.json`
4. Add Tasks API scope: `https://www.googleapis.com/auth/tasks`
5. Include URLs: `path('tasks/', include('google_tasks.urls'))`

## Usage

1. Navigate to `/tasks/`
2. Authenticate with Google (if not already authenticated)
3. Click "Sync Now" to fetch tasks from Google
4. Use filter dropdown to filter by task lists
5. Click star icon to mark tasks as starred
6. Click checkmark to complete tasks (with confirmation)
7. Visit `/tasks/starred/` to reorder starred tasks
8. Add hashtags to task notes (e.g., `#Work`, `#Home`, `#Phys`)
9. Click "Process Labels" to automatically move and star tasks
   based on hashtags

## Admin Interface

All models are registered in Django admin with:
- **GoogleTaskList**: List display, filtering, and search
- **GoogleTask**: List display, filtering, and search

## Dependencies

All required dependencies are already in the main `requirements.txt`:
- `google-api-python-client` - Google Tasks API client
- `google-auth` - Google authentication
- `google-auth-oauthlib` - OAuth2 flow
- Bootstrap 5 (CDN) - UI framework
- Bootstrap Icons (CDN) - Icon library
- SortableJS (CDN) - Drag-and-drop functionality

## Technical Notes

### Session Management
- OAuth credentials stored in `request.session['google_credentials']`
- OAuth state stored in `request.session['state']`
- Redirect URL stored in
  `request.session['oauth_redirect_url']`

### Database Queries
- Uses `select_related()` and `prefetch_related()` where appropriate
- Efficient `update_or_create()` for sync operations

### Logging
- Uses Django's logging framework
- Logger name: 'django'
- Logs authentication, API calls, errors, and task operations

### DateTime Handling
- All datetimes stored as timezone-aware
- RFC 3339 parsing for Google API responses
- Uses Django's `timezone.now()` for local timestamps
