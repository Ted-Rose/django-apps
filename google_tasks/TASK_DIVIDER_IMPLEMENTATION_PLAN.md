# Task Divider Implementation Plan
**Issue:** https://github.com/Ted-Rose/django-apps/issues/3  
**Date:** 2026-08-12  
**Objective:** Implement visual task dividers (empty lines) between tasks
in the task list UI

---

## Problem Statement

The user wants to visually divide tasks into groups/sections using empty
lines (dividers) in the task list. The question is: what's the best way
to store this information in the database?

### Proposed Approach
Add an `is_divider` boolean field to the `GoogleTask` model. When `True`,
the task acts as a visual divider/separator between task groups.

---

## Analysis of Proposed Solution

### Pros
1. **Simple Implementation**: Single boolean field, minimal schema change
2. **Works with Existing Ordering**: Leverages existing `task_order`
   field for positioning
3. **Drag-and-Drop Compatible**: Dividers can be moved with existing
   SortableJS implementation
4. **User-Friendly**: Easy to create/delete dividers via UI
5. **Backward Compatible**: Existing tasks unaffected (default=False)
6. **Local-Only Feature**: Like `is_starred`, doesn't sync to Google
   Tasks API

### Cons
1. **Semantic Mismatch**: A divider isn't really a "task"
2. **Google API Sync Complexity**: Need to ensure dividers aren't synced
   to Google
3. **Validation Needed**: Dividers shouldn't have titles, notes, due
   dates, etc.
4. **UI Complexity**: Need different rendering for dividers vs tasks

### Alternative Approaches Considered

#### Alternative 1: Separate `TaskDivider` Model
```python
class TaskDivider(models.Model):
    user = models.ForeignKey(...)
    position = models.PositiveIntegerField()
    task_list = models.ForeignKey(...)
```
**Rejected because:**
- More complex queries (need to merge two querysets)
- Harder to maintain ordering across two models
- More database tables

#### Alternative 2: `divider_after` Field on GoogleTask
```python
divider_after = models.BooleanField(default=False)
```
**Rejected because:**
- Less intuitive UX (divider tied to previous task)
- Harder to drag-and-drop dividers independently
- Confusing when tasks are deleted

### Recommendation
**Use the `is_divider` boolean field approach** as originally proposed.
It's the simplest solution that works well with the existing
architecture.

---

## Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Update GoogleTask Model
**File:** `google_tasks/models.py`

Add new field after line 54:
```python
is_divider = models.BooleanField(
    default=False,
    help_text='If True, this task acts as a visual divider'
)
```

**Validation considerations:**
- Dividers should have minimal data (empty title, no notes, etc.)
- Consider adding a `clean()` method to enforce this

#### 1.2 Create Migration
**Command:**
```bash
python manage.py makemigrations google_tasks -n add_is_divider_field
python manage.py migrate google_tasks
```

---

### Phase 2: Backend Updates

#### 2.1 Update Services (Sync Logic)
**File:** `google_tasks/services.py`

**Ensure dividers are NOT synced to Google:**
- In `sync_tasks()`: Skip tasks where `is_divider=True`
- In `complete_task()`: Add check to prevent completing dividers
- In `uncomplete_task()`: Add check to prevent uncompleting dividers

**Example modification:**
```python
def sync_tasks(user, creds, task_list):
    # ... existing code ...
    
    # Only sync non-divider tasks to Google
    tasks_to_sync = GoogleTask.objects.filter(
        user=user,
        task_list=task_list,
        is_divider=False  # <-- Add this filter
    )
```

#### 2.2 Add Divider Management Views
**File:** `google_tasks/views.py`

Add new views:

```python
@login_required
@require_POST
def create_divider(request):
    """Create a new task divider."""
    try:
        data = json.loads(request.body)
        task_list_id = data.get('task_list_id')
        position = data.get('position', 0)
        
        # Get task list
        task_list = get_object_or_404(
            GoogleTaskList,
            list_id=task_list_id,
            user=request.user
        )
        
        # Create divider with unique task_id
        divider = GoogleTask.objects.create(
            user=request.user,
            task_id=f'divider_{uuid.uuid4().hex[:16]}',
            task_list=task_list,
            title='',  # Empty title for dividers
            status='needsAction',
            is_divider=True,
            task_order=position
        )
        
        return JsonResponse({
            'success': True,
            'task_id': divider.task_id
        })
    except Exception as e:
        logger.error(f'Error creating divider: {e}')
        return JsonResponse({
            'success': False,
            'error': str(e)
        }, status=400)


@login_required
@require_POST
def delete_divider(request, task_id):
    """Delete a task divider."""
    divider = get_object_or_404(
        GoogleTask,
        task_id=task_id,
        user=request.user,
        is_divider=True
    )
    divider.delete()
    
    return JsonResponse({'success': True})
```

#### 2.3 Update URL Configuration
**File:** `google_tasks/urls.py`

Add new URL patterns:
```python
path('divider/create/', views.create_divider, name='create_divider'),
path(
    'divider/<str:task_id>/delete/',
    views.delete_divider,
    name='delete_divider'
),
```

---

### Phase 3: Frontend Updates

#### 3.1 Update Template - Divider Rendering
**File:** `google_tasks/templates/google_tasks/dashboard.html`

**Modify task card rendering** (around line 210):

```html
{% for task in tasks %}
    {% if task.is_divider %}
        <!-- Divider Card -->
        <div class="card task-card divider-card mb-2"
             data-task-id="{{ task.task_id }}">
            <div class="card-body divider-body">
                <div class="d-flex align-items-center">
                    <i class="bi bi-grip-vertical text-muted me-2"></i>
                    <hr class="flex-grow-1 my-0">
                    <button class="btn btn-sm btn-link text-danger
                                   delete-divider-btn"
                            data-task-id="{{ task.task_id }}"
                            title="Delete divider">
                        <i class="bi bi-x-circle"></i>
                    </button>
                </div>
            </div>
        </div>
    {% else %}
        <!-- Regular Task Card (existing code) -->
        <div class="card task-card mb-2"
             data-task-id="{{ task.task_id }}">
            <!-- ... existing task card content ... -->
        </div>
    {% endif %}
{% endfor %}
```

#### 3.2 Add CSS Styles
**File:** `google_tasks/templates/google_tasks/dashboard.html`

Add to `<style>` section:
```css
.divider-card {
    background-color: transparent;
    border: none;
    cursor: grab;
}
.divider-card:active {
    cursor: grabbing;
}
.divider-body {
    padding: 0.25rem 1rem;
}
.divider-card hr {
    border-top: 2px dashed #dee2e6;
    opacity: 0.5;
}
.divider-card:hover hr {
    border-color: #0d6efd;
    opacity: 0.8;
}
.delete-divider-btn {
    opacity: 0;
    transition: opacity 0.2s;
    padding: 0.25rem 0.5rem;
}
.divider-card:hover .delete-divider-btn {
    opacity: 1;
}
```

#### 3.3 Add JavaScript for Divider Management
**File:** `google_tasks/templates/google_tasks/dashboard.html`

Add to `<script>` section:

```javascript
// Create divider button handler
document.getElementById('create-divider-btn')
    .addEventListener('click', function() {
    const taskListId = getCurrentTaskListId();
    const position = getNextPosition();
    
    fetch('{% url "google_tasks:create_divider" %}', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
            task_list_id: taskListId,
            position: position
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            location.reload();  // Reload to show new divider
        } else {
            alert('Error creating divider: ' + data.error);
        }
    });
});

// Delete divider button handlers
document.querySelectorAll('.delete-divider-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const taskId = this.dataset.taskId;
        
        if (confirm('Delete this divider?')) {
            fetch(`/tasks/divider/${taskId}/delete/`, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken')
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Remove divider from DOM
                    this.closest('.divider-card').remove();
                } else {
                    alert('Error deleting divider');
                }
            });
        }
    });
});

// Helper functions
function getCurrentTaskListId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('list') || null;
}

function getNextPosition() {
    const tasks = document.querySelectorAll('.task-card');
    return tasks.length;
}
```

#### 3.4 Add "Create Divider" Button to UI
**File:** `google_tasks/templates/google_tasks/dashboard.html`

Add button to filter bar (around line 204):
```html
<button id="create-divider-btn"
        class="btn btn-outline-secondary btn-sm"
        title="Add divider">
    <i class="bi bi-dash-lg"></i> Add Divider
</button>
```

---

### Phase 4: Admin Interface Updates

#### 4.1 Update Admin Display
**File:** `google_tasks/admin.py`

Update `GoogleTaskAdmin`:
```python
class GoogleTaskAdmin(admin.ModelAdmin):
    list_display = [
        'title',
        'task_list',
        'user',
        'status',
        'is_starred',
        'is_divider',  # <-- Add this
        'task_order',
        'updated'
    ]
    list_filter = [
        'status',
        'is_starred',
        'is_divider',  # <-- Add this
        'task_list'
    ]
    search_fields = ['title', 'notes', 'task_id']
    readonly_fields = ['task_id', 'updated']
```

---

### Phase 5: Testing & Validation

#### 5.1 Manual Testing Checklist
- [ ] Create divider in "All Tasks" view
- [ ] Create divider in specific task list view
- [ ] Create divider in "Starred" view
- [ ] Drag-and-drop divider between tasks
- [ ] Drag-and-drop task across divider
- [ ] Delete divider
- [ ] Sync with Google Tasks (ensure dividers not synced)
- [ ] Reorder tasks with dividers present
- [ ] Filter by task list with dividers
- [ ] Check divider persistence after page reload
- [ ] Verify dividers appear in admin interface

#### 5.2 Edge Cases to Test
- [ ] Multiple dividers in a row
- [ ] Divider at start of list
- [ ] Divider at end of list
- [ ] Divider with no tasks around it
- [ ] Reordering when only dividers exist
- [ ] Completing tasks around dividers
- [ ] Starring tasks around dividers

#### 5.3 Data Integrity Checks
- [ ] Dividers have unique task_ids
- [ ] Dividers don't sync to Google API
- [ ] Dividers can't be completed/uncompleted
- [ ] Dividers maintain correct task_order
- [ ] Deleting task list deletes associated dividers

---

## Migration Strategy

### Step 1: Database Migration
```bash
# Create migration
python manage.py makemigrations google_tasks -n add_is_divider_field

# Review migration file
cat google_tasks/migrations/XXXX_add_is_divider_field.py

# Apply migration
python manage.py migrate google_tasks
```

### Step 2: Deploy Backend Changes
1. Update `models.py`
2. Update `services.py` (sync exclusions)
3. Update `views.py` (new endpoints)
4. Update `urls.py` (new routes)
5. Update `admin.py` (display field)

### Step 3: Deploy Frontend Changes
1. Update `dashboard.html` template
2. Add CSS styles
3. Add JavaScript handlers
4. Add "Create Divider" button

### Step 4: Testing
1. Run manual tests from checklist
2. Verify sync doesn't break
3. Test drag-and-drop functionality
4. Verify admin interface

---

## Future Enhancements (Optional)

### Enhancement 1: Divider Labels
Allow dividers to have optional text labels:
```python
divider_label = models.CharField(
    max_length=100,
    blank=True,
    help_text='Optional label for divider section'
)
```

UI would show: `--- Section Name ---`

### Enhancement 2: Divider Styles
Allow different divider styles (solid, dashed, dotted):
```python
DIVIDER_STYLE_CHOICES = [
    ('solid', 'Solid Line'),
    ('dashed', 'Dashed Line'),
    ('dotted', 'Dotted Line'),
]
divider_style = models.CharField(
    max_length=10,
    choices=DIVIDER_STYLE_CHOICES,
    default='dashed'
)
```

### Enhancement 3: Collapsible Sections
Make dividers collapsible to hide/show task groups:
- Add `is_collapsed` field
- JavaScript to toggle visibility
- Store state in localStorage

### Enhancement 4: Keyboard Shortcuts
- `Ctrl+D`: Create divider at current position
- `Delete`: Remove selected divider

---

## Risks & Mitigations

### Risk 1: Google API Sync Conflicts
**Risk:** Dividers might accidentally sync to Google Tasks API  
**Mitigation:** Add explicit `is_divider=False` filter in all sync
functions

### Risk 2: Ordering Conflicts
**Risk:** Dividers might interfere with task reordering  
**Mitigation:** Ensure SortableJS treats dividers like regular tasks
for ordering

### Risk 3: Data Migration Issues
**Risk:** Existing tasks might have issues with new field  
**Mitigation:** Use `default=False` and test migration on staging first

### Risk 4: UI Confusion
**Risk:** Users might not understand what dividers are  
**Mitigation:** Add tooltip/help text explaining divider functionality

---

## Success Criteria

1. ✅ Users can create visual dividers between tasks
2. ✅ Dividers can be repositioned via drag-and-drop
3. ✅ Dividers can be deleted easily
4. ✅ Dividers don't sync to Google Tasks API
5. ✅ Dividers work in all views (All Tasks, Starred, List-filtered)
6. ✅ Existing functionality (sync, reorder, complete) still works
7. ✅ No performance degradation
8. ✅ Clean, intuitive UI

---

## Estimated Effort

- **Database Changes:** 30 minutes
- **Backend Implementation:** 2 hours
- **Frontend Implementation:** 3 hours
- **Testing:** 2 hours
- **Documentation:** 1 hour

**Total:** ~8-9 hours

---

## Conclusion

The `is_divider` boolean field approach is the recommended solution. It:
- Minimizes schema complexity
- Works with existing ordering system
- Provides clean UX
- Maintains backward compatibility
- Doesn't interfere with Google Tasks API sync

This approach strikes the right balance between simplicity and
functionality, making it the best choice for implementing task dividers.
