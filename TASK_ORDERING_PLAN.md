# Task Ordering Implementation Plan

## Overview
Implement drag-and-drop task ordering functionality that persists order at the database level, allowing users to manually organize their tasks.

## Current State Analysis

### Existing Ordering
- **Starred tasks**: Already have `starred_order` field and drag-and-drop (in starred.html)
- **Regular tasks**: Currently ordered by `-updated` (most recent first)
- **Completed tasks**: Ordered by `-updated`

### What We Have
- SortableJS library already included in starred.html
- Reorder endpoint exists: `/starred/reorder/`
- Model field: `GoogleTask.starred_order` (PositiveIntegerField, nullable)

## Requirements

### Functional Requirements
1. Users can drag-and-drop tasks to reorder them
2. Order persists in database
3. Order is per-list or global (user preference)
4. Order syncs with Google Tasks API if possible
5. New tasks appear at top/bottom (configurable)
6. Completed tasks maintain separate order or use completion date

### Non-Functional Requirements
1. Smooth UI/UX with visual feedback
2. Fast reordering (optimistic UI updates)
3. Handle conflicts when tasks are added/removed
4. Mobile-friendly drag-and-drop

## Database Schema Changes

### Option 1: Single Order Field (Recommended)
```python
class GoogleTask(models.Model):
    # Existing fields...
    task_order = models.PositiveIntegerField(null=True, blank=True)
    # Per-list ordering: unique together with task_list
    # Global ordering: just the field
    
    class Meta:
        ordering = [
            F('task_order').asc(nulls_last=True),
            '-updated'
        ]
```

### Option 2: Separate Order Per List
```python
class GoogleTask(models.Model):
    # Existing fields...
    list_order = models.PositiveIntegerField(null=True, blank=True)
    
    class Meta:
        ordering = ['task_list', 'list_order', '-updated']
        # Could add: unique_together = ['task_list', 'list_order']
```

### Option 3: Use Google Tasks Position
```python
class GoogleTask(models.Model):
    # Existing fields...
    position = models.CharField(max_length=255, null=True, blank=True)
    # Google Tasks uses position strings for ordering
    
    class Meta:
        ordering = ['position', '-updated']
```

**Recommendation**: Option 1 with per-list ordering

## Implementation Steps

### Phase 1: Database & Backend (2-3 hours)

#### Step 1.1: Create Migration
```python
# google_tasks/migrations/XXXX_add_task_ordering.py
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ('google_tasks', 'XXXX_previous_migration'),
    ]

    operations = [
        migrations.AddField(
            model_name='googletask',
            name='task_order',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                help_text='Manual ordering within task list'
            ),
        ),
        migrations.AlterModelOptions(
            name='googletask',
            options={
                'ordering': [
                    models.F('task_order').asc(nulls_last=True),
                    '-updated'
                ]
            },
        ),
    ]
```

#### Step 1.2: Update Model
```python
# google_tasks/models.py
class GoogleTask(models.Model):
    # ... existing fields ...
    task_order = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text='Manual ordering within task list'
    )
    
    class Meta:
        ordering = [
            F('task_order').asc(nulls_last=True),
            '-updated'
        ]
```

#### Step 1.3: Create Reorder View
```python
# google_tasks/views.py
@login_required
@require_POST
def reorder_tasks(request):
    """Save manual ordering of tasks."""
    try:
        data = json.loads(request.body)
        ordered_ids = data.get('order', [])
        task_list_id = data.get('task_list_id')  # Optional
        
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
        
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON'
        }, status=400)
```

#### Step 1.4: Add URL Route
```python
# google_tasks/urls.py
urlpatterns = [
    # ... existing routes ...
    path('tasks/reorder/', views.reorder_tasks, name='reorder_tasks'),
]
```

#### Step 1.5: Update Dashboard View
```python
# google_tasks/views.py
@login_required
def dashboard(request):
    # ... existing code ...
    
    # Tasks now automatically ordered by task_order, then -updated
    active_tasks = tasks.filter(status='needsAction')
    completed_tasks = tasks.filter(status='completed')
    
    # ... rest of view ...
```

### Phase 2: Frontend - Dashboard (2-3 hours)

#### Step 2.1: Add SortableJS to Dashboard
```html
<!-- google_tasks/templates/google_tasks/dashboard.html -->
<script src="https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js"></script>
```

#### Step 2.2: Add Drag Handle to Task Cards
```html
<!-- In task card template -->
<div class="card task-card mb-3" data-task-id="{{ task.task_id }}">
    <div class="card-body">
        <div class="d-flex justify-content-between align-items-start">
            <!-- Add drag handle -->
            <span class="drag-handle me-2">
                <i class="bi bi-grip-vertical"></i>
            </span>
            
            <div class="flex-grow-1">
                <!-- Existing task content -->
            </div>
        </div>
    </div>
</div>
```

#### Step 2.3: Add CSS for Drag Handle
```css
.drag-handle {
    color: #adb5bd;
    cursor: grab;
    font-size: 1.1rem;
}

.drag-handle:active {
    cursor: grabbing;
}

.task-card.sortable-ghost {
    opacity: 0.4;
    background: #e9ecef;
}

.task-card.sortable-chosen {
    box-shadow: 0 8px 16px rgba(0,0,0,0.2);
}

.task-card {
    cursor: grab;
    transition: box-shadow 0.2s ease;
}

.task-card:active {
    cursor: grabbing;
}
```

#### Step 2.4: Initialize SortableJS
```javascript
// In dashboard.html <script> section
const taskList = document.getElementById('task-list');
if (taskList) {
    Sortable.create(taskList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        handle: '.drag-handle',
        onEnd: function () {
            const order = Array.from(
                taskList.querySelectorAll('[data-task-id]')
            ).map(el => el.dataset.taskId);
            
            // Get current list filter if any
            const params = new URLSearchParams(window.location.search);
            const taskListId = params.get('list');
            
            fetch('{% url "google_tasks:reorder_tasks" %}', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    order: order,
                    task_list_id: taskListId
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Optional: show success indicator
                    showSaveIndicator();
                }
            });
        }
    });
}

function showSaveIndicator() {
    const indicator = document.getElementById('save-indicator');
    if (indicator) {
        indicator.style.display = 'block';
        setTimeout(() => {
            indicator.style.display = 'none';
        }, 2000);
    }
}
```

#### Step 2.5: Add Save Indicator
```html
<!-- Add to dashboard.html -->
<div id="save-indicator" style="display: none;">
    <span class="badge bg-success fs-6 px-3 py-2">
        <i class="bi bi-check-circle"></i> Order saved
    </span>
</div>
```

```css
#save-indicator {
    position: fixed;
    bottom: 1.5rem;
    right: 1.5rem;
    z-index: 1000;
}
```

#### Step 2.6: Wrap Tasks in Sortable Container
```html
<!-- Update dashboard.html task list section -->
<div id="task-list">
    {% for task in tasks %}
    <div class="card task-card mb-3" data-task-id="{{ task.task_id }}">
        <!-- Task content -->
    </div>
    {% endfor %}
</div>
```

### Phase 3: Google Tasks API Integration (Optional, 2-4 hours)

#### Step 3.1: Research Google Tasks Position API
- Google Tasks uses `position` field for ordering
- Position is a string-based ordering system
- Moving tasks requires calling `tasks.move()` API

#### Step 3.2: Implement Sync with Google
```python
# google_tasks/services.py
def update_task_position(user, creds, task_id, previous_task_id=None):
    """
    Update task position in Google Tasks.
    
    Args:
        task_id: ID of task to move
        previous_task_id: ID of task that should come before this one
                         (None = move to top)
    """
    try:
        service = get_tasks_service(creds)
        
        if isinstance(service, dict) and 'authorization_url' in service:
            return service
        
        task = GoogleTask.objects.get(user=user, task_id=task_id)
        
        # Move task in Google Tasks
        service.tasks().move(
            tasklist=task.task_list.list_id,
            task=task_id,
            previous=previous_task_id
        ).execute()
        
        logger.info(f'Moved task {task_id} in Google Tasks')
        return True
        
    except HttpError as error:
        logger.error(f'Error moving task: {error}')
        return False
```

#### Step 3.3: Update Reorder View to Sync
```python
@login_required
@require_POST
def reorder_tasks(request):
    # ... existing validation ...
    
    # Update local order
    for position, task_id in enumerate(ordered_ids):
        GoogleTask.objects.filter(
            task_id=task_id,
            user=request.user
        ).update(task_order=position)
    
    # Optionally sync with Google Tasks
    sync_to_google = request.POST.get('sync_to_google', False)
    if sync_to_google:
        creds = request.session.get('google_credentials')
        if creds:
            for i, task_id in enumerate(ordered_ids):
                previous_id = ordered_ids[i-1] if i > 0 else None
                update_task_position(
                    request.user,
                    creds,
                    task_id,
                    previous_id
                )
    
    return JsonResponse({'success': True})
```

### Phase 4: Handle Edge Cases (1-2 hours)

#### Step 4.1: New Tasks
```python
# In sync_tasks() service
def sync_tasks(user, creds, task_list_id=None):
    # ... existing sync code ...
    
    for task_data in tasks:
        task, created = GoogleTask.objects.update_or_create(
            user=user,
            task_id=task_data['id'],
            defaults={
                # ... existing fields ...
            }
        )
        
        # Set order for new tasks
        if created and task.task_order is None:
            # Option 1: Add to bottom
            max_order = GoogleTask.objects.filter(
                user=user,
                task_list=task.task_list
            ).aggregate(Max('task_order'))['task_order__max']
            task.task_order = (max_order or 0) + 1
            
            # Option 2: Add to top
            # task.task_order = 0
            # Increment all others
            
            task.save()
```

#### Step 4.2: Deleted Tasks
- Task deletion automatically handled by CASCADE
- Gaps in order numbers are acceptable (don't need to renumber)

#### Step 4.3: Filter Changes
```javascript
// When user changes list filter, reinitialize Sortable
function selectList(listId) {
    // ... existing code ...
    // Sortable will be reinitialized on page load
}
```

#### Step 4.4: Completed Tasks
```python
# Option 1: Keep order when completing
def complete_task(user, creds, task_id):
    # ... existing code ...
    # task_order is preserved

# Option 2: Clear order when completing
def complete_task(user, creds, task_id):
    # ... existing code ...
    task.task_order = None
    task.save()
```

## Testing Plan

### Unit Tests
1. Test reorder view with valid data
2. Test reorder view with invalid task IDs
3. Test reorder view with tasks from different users
4. Test ordering in queryset
5. Test new task order assignment

### Integration Tests
1. Test drag-and-drop UI
2. Test order persistence after page reload
3. Test order with list filters
4. Test order with completed tasks
5. Test order after sync from Google

### Manual Testing
1. Drag tasks up and down
2. Reload page and verify order
3. Switch between lists
4. Complete/uncomplete tasks
5. Add new tasks
6. Test on mobile

## Deployment Steps

1. Run migration: `python manage.py migrate`
2. Assign initial orders to existing tasks (optional):
   ```python
   # One-time script
   for task_list in GoogleTaskList.objects.all():
       tasks = GoogleTask.objects.filter(
           task_list=task_list
       ).order_by('-updated')
       for i, task in enumerate(tasks):
           task.task_order = i
           task.save()
   ```
3. Deploy frontend changes
4. Test in production
5. Monitor logs for errors

## Future Enhancements

1. **Bulk Operations**: Select multiple tasks and move together
2. **Keyboard Shortcuts**: Arrow keys to reorder
3. **Undo/Redo**: Revert order changes
4. **Templates**: Save and apply ordering templates
5. **Auto-Sort**: Options like alphabetical, by due date, by priority
6. **Sections**: Group tasks into collapsible sections
7. **Multi-List Ordering**: Drag tasks between lists

## Estimated Timeline

- **Phase 1** (Backend): 2-3 hours
- **Phase 2** (Frontend): 2-3 hours
- **Phase 3** (Google Sync): 2-4 hours (optional)
- **Phase 4** (Edge Cases): 1-2 hours
- **Testing**: 2-3 hours
- **Total**: 9-15 hours

## Dependencies

- SortableJS: Already included
- Bootstrap Icons: Already included
- Django: Current version
- Google Tasks API: Current version

## Risks & Mitigation

1. **Risk**: Order conflicts during concurrent edits
   - **Mitigation**: Use optimistic locking or last-write-wins

2. **Risk**: Performance with large task lists
   - **Mitigation**: Paginate tasks, limit drag-and-drop to current page

3. **Risk**: Google Tasks API rate limits
   - **Mitigation**: Batch updates, sync on-demand only

4. **Risk**: Mobile drag-and-drop UX issues
   - **Mitigation**: Test thoroughly, consider touch-specific library

## Success Criteria

- ✅ Users can drag-and-drop tasks
- ✅ Order persists after page reload
- ✅ Order works with list filters
- ✅ No performance degradation
- ✅ Mobile-friendly
- ✅ No data loss or corruption
