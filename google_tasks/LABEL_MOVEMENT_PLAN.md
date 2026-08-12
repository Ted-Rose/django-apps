# Label Movement Feature - Implementation Plan

## GitHub Issue
**Issue #6**: Label movement
**URL**: https://github.com/Ted-Rose/django-apps/issues/6

## Overview
Implement automatic label application to tasks based on hashtags in task 
notes. Since Google Tasks API doesn't support native labels, we'll use 
**task lists** as label categories.

## Requirements Analysis

### Core Functionality
1. **Hashtag Detection**: Parse task notes/title for hashtag patterns 
   (e.g., `#Phys`, `#Work`, `#Home`)
2. **Label Matching**: Match hashtags with existing task lists
   - Exact match: `#Physical` → "Physical" task list
   - Partial match: `#Phys` → "Physical" task list (first 3-4 letters)
3. **Task Movement**: Move task to the matched task list
4. **Auto-starring**: Automatically star tasks that have been labeled

### Example Scenario
```
Task Title: "Make the ground even around the baby swings"
Task Notes: Contains "#Phys" somewhere in the HTML/text
Existing Task Lists: ["Physical", "Work", "Shopping", "Home"]

Expected Behavior:
1. Detect "#Phys" in task notes
2. Match "Phys" with "Physical" task list (partial match)
3. Move task to "Physical" task list
4. Star the task
5. Optionally remove the hashtag from notes
```

## Technical Design

### 1. Hashtag Detection Algorithm
```python
import re

def extract_hashtags(text):
    """
    Extract hashtags from text.
    Pattern: #followed by letters (3+ chars)
    Returns: List of hashtag strings (without #)
    """
    if not text:
        return []
    pattern = r'#([A-Za-z]{3,})'
    matches = re.findall(pattern, text)
    return [match.lower() for match in matches]
```

### 2. Label Matching Logic
```python
def match_task_list(hashtag, task_lists):
    """
    Match hashtag with task list.
    Priority:
    1. Exact match (case-insensitive)
    2. Partial match (first 3-4 letters)
    
    Returns: GoogleTaskList object or None
    """
    hashtag_lower = hashtag.lower()
    
    # Exact match
    for task_list in task_lists:
        if task_list.title.lower() == hashtag_lower:
            return task_list
    
    # Partial match (first 3-4 letters)
    for task_list in task_lists:
        title_lower = task_list.title.lower()
        if title_lower.startswith(hashtag_lower[:4]):
            return task_list
        if title_lower.startswith(hashtag_lower[:3]):
            return task_list
    
    return None
```

### 3. Task Movement Service
```python
def move_task_to_list(user, creds, task, target_list):
    """
    Move task to a different task list via Google Tasks API.
    
    Steps:
    1. Get current task data from Google API
    2. Delete task from current list
    3. Create task in target list
    4. Update local database
    """
    pass
```

### 4. Label Processing Service
```python
def process_task_labels(user, creds, task_id=None):
    """
    Process labels for one or all tasks.
    
    For each task:
    1. Extract hashtags from title and notes
    2. Match hashtags with task lists
    3. Move task if match found
    4. Star the task
    5. Log the action
    
    Returns: Dict with stats (processed, moved, starred, errors)
    """
    pass
```

## Implementation Steps

### Phase 1: Service Layer (services.py)
- [ ] Add `extract_hashtags(text)` function
- [ ] Add `match_task_list(hashtag, task_lists)` function
- [ ] Add `move_task_to_list(user, creds, task, target_list)` function
- [ ] Add `process_task_labels(user, creds, task_id=None)` function

### Phase 2: View Layer (views.py)
- [ ] Add `process_labels_view(request)` endpoint
  - Trigger label processing for all tasks
  - Return JSON with results
- [ ] Add `process_task_label_view(request, task_id)` endpoint
  - Process single task
  - Return JSON with result

### Phase 3: URL Configuration (urls.py)
- [ ] Add URL pattern for bulk label processing
- [ ] Add URL pattern for single task label processing

### Phase 4: UI Integration (dashboard.html)
- [ ] Add "Process Labels" button in navbar/filter bar
- [ ] Add per-task "Apply Label" button (optional)
- [ ] Add JavaScript handler for label processing
- [ ] Show results/feedback to user

### Phase 5: Testing
- [ ] Test hashtag extraction with various formats
- [ ] Test exact matching
- [ ] Test partial matching (3-4 letters)
- [ ] Test task movement via API
- [ ] Test auto-starring
- [ ] Test error handling (no match, API errors)

### Phase 6: Documentation
- [ ] Update README.md with label movement feature
- [ ] Add usage examples
- [ ] Document hashtag format requirements

## API Considerations

### Google Tasks API - Moving Tasks
Since there's no direct "move" operation between lists, we need to:
1. Get full task data from source list
2. Create new task in target list with same data
3. Delete task from source list
4. Handle potential data loss (preserve notes, due date, etc.)

### Preserving Local Data
- `is_starred`: Set to True after label processing
- `task_order`: May need to reset or preserve
- Ensure `task_id` is updated after recreation

## Edge Cases

1. **Multiple Hashtags**: If task has multiple hashtags, which list to 
   use?
   - Solution: Use first matched hashtag, or create priority system

2. **No Match Found**: What if hashtag doesn't match any list?
   - Solution: Leave task in current list, log for review

3. **Task Already in Correct List**: Skip movement, just star it
   - Solution: Check current list before moving

4. **Hashtag in HTML**: Notes may contain HTML
   - Solution: Strip HTML tags before hashtag extraction

5. **Case Sensitivity**: "#phys" vs "#Phys" vs "#PHYS"
   - Solution: Case-insensitive matching

## Configuration Options (Future)

- Enable/disable auto-starring
- Hashtag removal after processing
- Minimum hashtag length (default: 3)
- Processing mode: manual trigger vs auto on sync

## Success Criteria

- [ ] Hashtags correctly extracted from task notes/title
- [ ] Task lists matched with 90%+ accuracy
- [ ] Tasks successfully moved between lists
- [ ] Tasks automatically starred after labeling
- [ ] User can trigger label processing from UI
- [ ] Clear feedback on processing results
- [ ] No data loss during task movement
- [ ] Error handling for API failures

## Files to Modify

1. `google_tasks/services.py` - Core label processing logic
2. `google_tasks/views.py` - View endpoints
3. `google_tasks/urls.py` - URL routing
4. `google_tasks/templates/google_tasks/dashboard.html` - UI
5. `google_tasks/README.md` - Documentation

## Timeline Estimate

- Phase 1 (Services): 2-3 hours
- Phase 2 (Views): 1 hour
- Phase 3 (URLs): 15 minutes
- Phase 4 (UI): 1-2 hours
- Phase 5 (Testing): 2-3 hours
- Phase 6 (Documentation): 30 minutes

**Total**: 7-10 hours

## Notes

- Google Tasks API doesn't support labels natively
- Using task lists as label categories is the workaround
- Task movement requires delete + recreate (not atomic)
- Consider adding undo functionality in future
