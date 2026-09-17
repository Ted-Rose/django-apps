# TaskLabel Implementation Plan

## Overview
Implement a new `TaskLabel` model to enable many-to-many relationships between
tasks and labels, while keeping `GoogleTaskList` as the bridge to Google Tasks
API. This allows tasks to have multiple labels for organization within the app
ecosystem, optimized for voice-to-text input with fuzzy matching.

---

## Current Architecture

### Key Components
1. **GoogleTaskList** - Synced from Google Tasks API (1:1 with Google lists)
2. **GoogleTask** - Has ForeignKey to GoogleTaskList
3. **Hashtag Processing** (`process_task_labels` in services.py):
   - Extracts hashtags from task title/notes
   - Matches hashtags to GoogleTaskList
   - Moves task to matched list (changes `task.task_list`)
   - Stars the task
4. **Filtering** (views.py line 54-62):
   - Dashboard filters by `task_list__list_id` query parameter
   - Template shows dropdown of GoogleTaskLists

---

## Proposed Solution

### New Model Structure

```python
class TaskLabel(models.Model):
    """User-defined labels for organizing tasks (app-level only)."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE
    )
    name = models.CharField(max_length=255)
    color = models.CharField(
        max_length=7,
        default='#0d6efd',
        help_text='Hex color code for label badge'
    )
    created = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['user', 'name']
        ordering = ['name']
    
    def __str__(self):
        return f'{self.name} ({self.user.username})'


# Update to GoogleTask model
class GoogleTask(models.Model):
    # ... existing fields ...
    task_list = models.ForeignKey(
        GoogleTaskList, ...
    )  # Keep for Google sync
    labels = models.ManyToManyField(
        TaskLabel,
        blank=True,
        related_name='tasks'
    )
```

---

## Implementation Plan

### Phase 1: Model & Migration (30 mins)

**Files to modify:**
- `models.py`
- Create new migration

**Tasks:**
- [ ] Create `TaskLabel` model in models.py
- [ ] Add `labels` ManyToManyField to `GoogleTask`
- [ ] Generate migration: `python manage.py makemigrations`
- [ ] Create data migration to auto-create TaskLabels from existing
      GoogleTaskLists
- [ ] Run migrations: `python manage.py migrate`

**Data Migration Logic:**
```python
# Create TaskLabel for each GoogleTaskList
for task_list in GoogleTaskList.objects.all():
    TaskLabel.objects.get_or_create(
        user=task_list.user,
        name=task_list.title,
        defaults={'color': '#0d6efd'}
    )

# Assign labels to tasks based on current task_list
for task in GoogleTask.objects.all():
    if task.task_list:
        label = TaskLabel.objects.get(
            user=task.user,
            name=task.task_list.title
        )
        task.labels.add(label)
```

---

### Phase 2: Smart Label Matching (60 mins)

**Files to modify:**
- `services.py`

**Tasks:**
- [ ] Implement `match_or_assign_label()` function with fuzzy matching
- [ ] Update `process_task_labels()` to handle multiple labels
- [ ] Add configuration constants for matching behavior

**New Function: `match_or_assign_label()`**

```python
from difflib import SequenceMatcher

def match_or_assign_label(hashtag, user, create_if_missing=True):
    """
    Smart label matching for voice-to-text input.
    
    Matching priority:
    1. Exact match (case-insensitive)
    2. Starts-with match (first 4+ chars)
    3. Fuzzy match using similarity ratio (>80%)
    4. Create new label if no match found
    
    Args:
        hashtag: String hashtag (without #)
        user: User object
        create_if_missing: Auto-create label if no match (default True)
        
    Returns: TaskLabel object (existing or newly created)
    """
    hashtag_lower = hashtag.lower()
    user_labels = TaskLabel.objects.filter(user=user)
    
    # 1. Exact match (case-insensitive)
    exact_match = user_labels.filter(name__iexact=hashtag).first()
    if exact_match:
        logger.info(f'Exact match: #{hashtag} -> {exact_match.name}')
        return exact_match
    
    # 2. Starts-with match (first 4+ chars)
    if len(hashtag_lower) >= 4:
        for label in user_labels:
            if label.name.lower().startswith(hashtag_lower[:4]):
                logger.info(
                    f'Prefix match: #{hashtag} -> {label.name}'
                )
                return label
    
    # 3. Fuzzy match using similarity ratio
    best_match = None
    best_ratio = 0.0
    SIMILARITY_THRESHOLD = 0.80  # 80% similarity required
    
    for label in user_labels:
        ratio = SequenceMatcher(
            None,
            hashtag_lower,
            label.name.lower()
        ).ratio()
        
        if ratio > best_ratio:
            best_ratio = ratio
            best_match = label
    
    if best_ratio >= SIMILARITY_THRESHOLD:
        logger.info(
            f'Fuzzy match ({best_ratio:.0%}): '
            f'#{hashtag} -> {best_match.name}'
        )
        return best_match
    
    # 4. Create new label if no match and creation allowed
    if create_if_missing:
        new_label = TaskLabel.objects.create(
            user=user,
            name=hashtag.capitalize()
        )
        logger.info(f'Created new label: {new_label.name}')
        return new_label
    
    logger.info(f'No match found for #{hashtag}')
    return None
```

**Updated `process_task_labels()` Logic:**

```python
def process_task_labels(user, creds, task_id=None):
    """
    Process labels for one or all tasks.
    
    For each task:
    1. Extract ALL hashtags from title and notes
    2. Match/create TaskLabels for all hashtags (many-to-many)
    3. Use FIRST hashtag to determine GoogleTaskList (for Google sync)
    4. Move task to GoogleTaskList if needed (Google API)
    5. Star the task
    
    Returns: Dict with stats
    """
    # ... existing setup code ...
    
    for task in tasks:
        # Extract hashtags from title and notes
        hashtags = []
        hashtags.extend(extract_hashtags(task.title))
        hashtags.extend(extract_hashtags(task.notes or ''))
        
        if not hashtags:
            continue
        
        # Handle special keywords (#starred)
        if hashtags[0] == 'starred':
            # ... existing starred logic ...
            continue
        
        # NEW: Assign TaskLabels for ALL hashtags
        assigned_labels = []
        for hashtag in hashtags:
            label = match_or_assign_label(hashtag, user)
            if label:
                task.labels.add(label)
                assigned_labels.append(label.name)
        
        logger.info(
            f'Task "{task.title}" assigned labels: {assigned_labels}'
        )
        
        # EXISTING: Use first hashtag for GoogleTaskList (Google sync)
        target_list = match_task_list(hashtags[0], task_lists)
        
        if target_list and task.task_list.list_id != target_list.list_id:
            # Move task to target list in Google
            result = move_task_to_list(user, creds, task, target_list)
            # ... existing move logic ...
        
        # Star the task
        # ... existing star logic ...
```

---

### Phase 3: Update Views (30 mins)

**Files to modify:**
- `views.py`

**Tasks:**
- [ ] Update `dashboard()` view for label filtering
- [ ] Update `starred_tasks()` view
- [ ] Update `overdue_tasks()` view
- [ ] Update `archived_tasks()` view
- [ ] Update `trash_tasks()` view

**View Changes:**

```python
def dashboard(request):
    """Main dashboard showing all tasks."""
    creds = get_creds_dict(request.user)
    
    # ... existing sync logic ...
    
    # NEW: Support both list and label filtering
    task_list_filter = request.GET.get('list')
    label_filter = request.GET.get('label')
    order_by = request.GET.get('order', 'order_asc')
    
    tasks = GoogleTask.objects.filter(
        user=request.user,
        is_archived=False,
        is_deleted=False
    )
    
    # Filter by GoogleTaskList (existing)
    if task_list_filter:
        tasks = tasks.filter(task_list__list_id=task_list_filter)
    
    # NEW: Filter by TaskLabel
    if label_filter:
        tasks = tasks.filter(labels__name=label_filter)
    
    # ... existing ordering logic ...
    
    # NEW: Pass labels to template
    task_lists = GoogleTaskList.objects.filter(user=request.user)
    labels = TaskLabel.objects.filter(user=request.user)
    
    selected_list_title = None
    selected_label_name = None
    
    if task_list_filter:
        selected_list_title = task_lists.filter(
            list_id=task_list_filter
        ).values_list('title', flat=True).first()
    
    if label_filter:
        selected_label_name = label_filter
    
    context = {
        'tasks': active_tasks,
        'completed_tasks': completed_tasks,
        'task_lists': task_lists,
        'labels': labels,  # NEW
        'selected_list': task_list_filter,
        'selected_list_title': selected_list_title,
        'selected_label': label_filter,  # NEW
        'selected_label_name': selected_label_name,  # NEW
        'has_credentials': bool(creds),
        'order_by': order_by,
        'burger_menu_items': burger_menu_items,
    }
    
    return render(request, 'google_tasks/dashboard.html', context)
```

---

### Phase 4: Update Templates (45 mins)

**Files to modify:**
- `templates/google_tasks/dashboard.html`

**Tasks:**
- [ ] Add labels dropdown to filter bar
- [ ] Update JavaScript `selectList()` to `selectFilter()`
- [ ] Add label badges to task cards
- [ ] Add label color indicators

**Template Changes:**

```html
<!-- Filter dropdown - add labels section -->
<ul class="dropdown-menu">
    <li>
        <a class="dropdown-item {% if not selected_list and not
           selected_label %}active{% endif %}"
           href="{% url 'google_tasks:dashboard' %}">
            <i class="bi bi-list-task"></i> All Tasks
        </a>
    </li>
    <li><hr class="dropdown-divider"></li>
    
    <!-- Existing special views -->
    <li>
        <a class="dropdown-item {% if is_starred_view %}active{% endif %}"
           href="{% url 'google_tasks:starred' %}">
            <i class="bi bi-star-fill text-warning"></i> Starred
        </a>
    </li>
    <!-- ... other special views ... -->
    
    <!-- NEW: Labels section -->
    {% if labels %}
    <li><hr class="dropdown-divider"></li>
    <li><h6 class="dropdown-header">Labels</h6></li>
    {% for label in labels %}
    <li>
        <a class="dropdown-item {% if selected_label == label.name %}
           active{% endif %}"
           href="#"
           onclick="selectLabel('{{ label.name }}'); return false;">
            <span class="badge"
                  style="background-color: {{ label.color }}">
                {{ label.name }}
            </span>
        </a>
    </li>
    {% endfor %}
    {% endif %}
    
    <!-- Existing GoogleTaskLists section -->
    {% if task_lists %}
    <li><hr class="dropdown-divider"></li>
    <li><h6 class="dropdown-header">Google Lists</h6></li>
    {% for list in task_lists %}
    <li>
        <a class="dropdown-item {% if selected_list == list.list_id %}
           active{% endif %}"
           href="#"
           onclick="selectList('{{ list.list_id }}'); return false;">
            <i class="bi bi-folder"></i> {{ list.title }}
        </a>
    </li>
    {% endfor %}
    {% endif %}
</ul>

<!-- Task card - add label badges -->
<div class="card task-card">
    <div class="card-body">
        <h5 class="card-title">{{ task.title }}</h5>
        
        <!-- NEW: Label badges -->
        {% if task.labels.all %}
        <div class="mb-2">
            {% for label in task.labels.all %}
            <span class="badge me-1"
                  style="background-color: {{ label.color }}">
                {{ label.name }}
            </span>
            {% endfor %}
        </div>
        {% endif %}
        
        <!-- ... rest of task card ... -->
    </div>
</div>

<!-- JavaScript functions -->
<script>
    function selectLabel(labelName) {
        const params = new URLSearchParams(window.location.search);
        params.delete('list');
        params.delete('label');
        params.delete('sync');
        if (labelName) params.set('label', labelName);
        const url = '?' + params.toString();
        saveCurrentView();
        window.location.href = url;
    }
    
    function selectList(listId) {
        const params = new URLSearchParams(window.location.search);
        params.delete('list');
        params.delete('label');
        params.delete('sync');
        if (listId) params.set('list', listId);
        const url = '?' + params.toString();
        saveCurrentView();
        window.location.href = url;
    }
</script>
```

---

### Phase 5: Admin & Testing (20 mins)

**Files to modify:**
- `admin.py`

**Tasks:**
- [ ] Register TaskLabel in admin
- [ ] Add labels to GoogleTaskAdmin display
- [ ] Test hashtag extraction with multiple labels
- [ ] Test fuzzy matching with misspellings
- [ ] Test filtering by labels
- [ ] Verify Google sync still works

**Admin Changes:**

```python
from google_tasks.models import GoogleTaskList, GoogleTask, TaskLabel

@admin.register(TaskLabel)
class TaskLabelAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'color', 'created', 'task_count']
    list_filter = ['user', 'created']
    search_fields = ['name']
    
    def task_count(self, obj):
        return obj.tasks.count()
    task_count.short_description = 'Tasks'


@admin.register(GoogleTask)
class GoogleTaskAdmin(admin.ModelAdmin):
    list_display = [
        'title',
        'user',
        'task_list',
        'label_list',  # NEW
        'status',
        'is_starred',
        'is_divider',
        'due_date'
    ]
    list_filter = [
        'user',
        'task_list',
        'labels',  # NEW
        'status',
        'is_starred',
        'is_divider'
    ]
    search_fields = ['title', 'notes', 'task_id']
    filter_horizontal = ['labels']  # NEW
    
    def label_list(self, obj):
        return ', '.join([label.name for label in obj.labels.all()])
    label_list.short_description = 'Labels'
```

---

## Fuzzy Matching Examples (Voice-to-Text)

| Voice Input | Transcribed | Existing Label | Match Type | Result |
|-------------|-------------|----------------|------------|---------|
| "work" | `#work` | "Work" | Exact | Match "Work" |
| "groceries" | `#grocerys` | "Groceries" | Fuzzy (90%) | Match "Groceries" |
| "meeting" | `#meting` | "Meeting" | Fuzzy (85%) | Match "Meeting" |
| "finance" | `#finanse` | "Finance" | Fuzzy (85%) | Match "Finance" |
| "project" | `#proj` | "Project" | Prefix (4) | Match "Project" |
| "new label" | `#newlabel` | - | No match | Create "Newlabel" |

---

## Configuration Constants

Add to `services.py`:

```python
# Label matching configuration
LABEL_SIMILARITY_THRESHOLD = 0.80  # 80% similarity required
LABEL_AUTO_CREATE = True           # Auto-create new labels
LABEL_MIN_PREFIX_LENGTH = 4        # Min chars for prefix match
LABEL_CAPITALIZE_NEW = True        # Capitalize new label names
```

---

## Key Advantages

1. **Clean Separation**: GoogleTaskList = Google API bridge, TaskLabel =
   app-level organization
2. **Multiple Labels**: Tasks can have multiple labels (e.g., #work #urgent
   #project)
3. **No Google API Changes**: All Google sync continues to work unchanged
4. **Fuzzy Matching**: Handles voice-to-text transcription errors
5. **Backward Compatible**: Existing task_list field remains functional
6. **Auto-Migration**: Auto-creates TaskLabels from existing GoogleTaskLists

---

## Files to Modify Summary

1. **models.py** - Add TaskLabel model, add labels field to GoogleTask
2. **services.py** - Add `match_or_assign_label()`, update
   `process_task_labels()`
3. **views.py** - Update filtering in dashboard, starred, overdue, archived,
   trash (5 functions)
4. **dashboard.html** - Add labels dropdown, label badges, update JavaScript
5. **admin.py** - Register TaskLabel, update GoogleTaskAdmin

---

## Files to Keep Unchanged

- Google sync logic (sync_tasks, create_task, complete_task, etc.)
- Task ordering, starring, archiving logic
- Search functionality

---

## Total Effort Estimate

**Core Implementation**: ~2.5 hours
**Complexity**: Low-Medium (straightforward Django patterns)

---

## Testing Checklist

- [ ] Create new task with single hashtag
- [ ] Create new task with multiple hashtags
- [ ] Test fuzzy matching with misspelled hashtags
- [ ] Filter tasks by label
- [ ] Filter tasks by GoogleTaskList (ensure still works)
- [ ] Sync with Google Tasks API (ensure no breakage)
- [ ] Process labels on existing tasks
- [ ] View task labels in admin
- [ ] Create/edit labels in admin
- [ ] Test label colors display correctly

---

## Future Enhancements (Optional)

- Label management UI (create/edit/delete labels without admin)
- Label autocomplete when typing hashtags
- Filter by multiple labels simultaneously
- Label statistics/analytics
- Label color picker in UI
- Bulk label operations
- Label suggestions based on task content
