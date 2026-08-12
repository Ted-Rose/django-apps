# Task Divider UI Mockup

This document shows what the task divider feature will look like in the
UI.

---

## Dashboard View with Dividers

```
┌─────────────────────────────────────────────────────────────┐
│ Google Tasks                    [Sync Now] [Home]           │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ [All Tasks ▼] [Order Desc ▼] [+ Add Divider]               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ Buy groceries                                    ☆        │
│   Due: Aug 15, 2026                                         │
│   Shopping list: milk, bread, eggs                          │
│   Personal                                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ Call dentist                                     ★        │
│   Personal                                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─────────────────────────────────────────────── ⊗         │
│     ↑ Divider (hover shows delete button)                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ Review project proposal                         ☆        │
│   Due: Aug 13, 2026                                         │
│   Work                                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ Send weekly report                              ★        │
│   Work                                                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─────────────────────────────────────────────── ⊗         │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ Plan weekend trip                                ☆        │
│   Personal                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Legend:**
- `⠿` = Drag handle (grip icon)
- `☆` = Not starred
- `★` = Starred
- `⊗` = Delete divider button (visible on hover)
- `───` = Divider line (dashed)

---

## Divider States

### Normal State
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ───────────────────────────────────────────────           │
└─────────────────────────────────────────────────────────────┘
```
- Dashed gray line
- Drag handle visible
- Delete button hidden
- Transparent background

### Hover State
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─────────────────────────────────────────────── ⊗         │
└─────────────────────────────────────────────────────────────┘
```
- Line changes to blue
- Delete button (⊗) appears on right
- Cursor changes to grab

### Dragging State
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ───────────────────────────────────────────────           │
│   ↑ Ghost/placeholder while dragging                       │
└─────────────────────────────────────────────────────────────┘
```
- Semi-transparent ghost effect
- Cursor changes to grabbing
- Other tasks shift to show drop position

---

## Create Divider Flow

### Step 1: Click "Add Divider" Button
```
┌─────────────────────────────────────────────────────────────┐
│ [All Tasks ▼] [Order Desc ▼] [+ Add Divider] ← Click here  │
└─────────────────────────────────────────────────────────────┘
```

### Step 2: Divider Appears at Bottom
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ Last task in list                                ☆        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─────────────────────────────────────────────── ⊗         │
│   ↑ New divider (just created)                             │
└─────────────────────────────────────────────────────────────┘
```

### Step 3: Drag to Desired Position
```
User drags divider up to position it between tasks
```

---

## Delete Divider Flow

### Step 1: Hover Over Divider
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─────────────────────────────────────────────── ⊗         │
│                                                    ↑         │
│                                          Delete button       │
└─────────────────────────────────────────────────────────────┘
```

### Step 2: Click Delete Button
```
Confirmation dialog (optional):
┌─────────────────────────────────┐
│ Delete this divider?            │
│                                 │
│     [Cancel]  [Delete]          │
└─────────────────────────────────┘
```

### Step 3: Divider Removed
```
Divider disappears from list
Tasks above and below move together
```

---

## Mobile View

On mobile devices, the layout adapts:

```
┌─────────────────────────┐
│ ⠿ Buy groceries    ☆   │
│   Due: Aug 15          │
│   Personal             │
└─────────────────────────┘

┌─────────────────────────┐
│ ⠿ ──────────────── ⊗   │
└─────────────────────────┘

┌─────────────────────────┐
│ ⠿ Call dentist     ★   │
│   Personal             │
└─────────────────────────┘
```

- Divider line shorter
- Delete button still on right
- Touch-friendly drag handles

---

## CSS Styling Details

### Divider Card
```css
.divider-card {
    background-color: transparent;
    border: none;
    cursor: grab;
    transition: all 0.2s ease;
}
```

### Divider Line
```css
.divider-card hr {
    border-top: 2px dashed #dee2e6;  /* Gray dashed */
    opacity: 0.5;
    margin: 0;
}

.divider-card:hover hr {
    border-color: #0d6efd;  /* Blue on hover */
    opacity: 0.8;
}
```

### Delete Button
```css
.delete-divider-btn {
    opacity: 0;              /* Hidden by default */
    transition: opacity 0.2s;
    color: #dc3545;          /* Red color */
}

.divider-card:hover .delete-divider-btn {
    opacity: 1;              /* Visible on hover */
}
```

---

## Interaction Examples

### Example 1: Organizing Work vs Personal Tasks
```
Personal Tasks:
┌─────────────────────────┐
│ ⠿ Buy groceries    ☆   │
└─────────────────────────┘
┌─────────────────────────┐
│ ⠿ Call dentist     ★   │
└─────────────────────────┘

Divider:
┌─────────────────────────┐
│ ⠿ ──────────────── ⊗   │
└─────────────────────────┘

Work Tasks:
┌─────────────────────────┐
│ ⠿ Review proposal  ☆   │
└─────────────────────────┘
┌─────────────────────────┐
│ ⠿ Send report      ★   │
└─────────────────────────┘
```

### Example 2: Separating Urgent vs Later Tasks
```
Urgent (Today):
┌─────────────────────────┐
│ ⠿ Submit report    ★   │
└─────────────────────────┘
┌─────────────────────────┐
│ ⠿ Client call      ★   │
└─────────────────────────┘

Divider:
┌─────────────────────────┐
│ ⠿ ──────────────── ⊗   │
└─────────────────────────┘

Later (This Week):
┌─────────────────────────┐
│ ⠿ Plan meeting     ☆   │
└─────────────────────────┘
┌─────────────────────────┐
│ ⠿ Update docs      ☆   │
└─────────────────────────┘
```

---

## Accessibility Considerations

### Keyboard Navigation
- `Tab` to focus on divider
- `Enter` to start drag mode
- `Arrow keys` to move divider
- `Delete` to remove divider
- `Escape` to cancel drag

### Screen Reader Support
```html
<div class="divider-card" role="separator" 
     aria-label="Task divider">
    <div class="card-body">
        <i class="bi bi-grip-vertical" aria-hidden="true"></i>
        <hr aria-hidden="true">
        <button class="delete-divider-btn" 
                aria-label="Delete divider">
            <i class="bi bi-x-circle" aria-hidden="true"></i>
        </button>
    </div>
</div>
```

### Visual Indicators
- High contrast mode support
- Focus ring on keyboard navigation
- Clear hover states
- Sufficient touch target size (44px minimum)

---

## Animation & Transitions

### Creating Divider
```
1. Fade in (0.2s)
2. Slide down from top (0.3s)
3. Settle into position
```

### Deleting Divider
```
1. Fade out (0.2s)
2. Collapse height (0.3s)
3. Remove from DOM
```

### Dragging Divider
```
1. Lift effect (box-shadow increase)
2. Ghost placeholder at original position
3. Smooth transition to new position
4. Drop animation (0.2s settle)
```

---

## Future Enhancement Ideas

### Labeled Dividers (Optional)
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─────────── Work Tasks ────────────────────────── ⊗       │
└─────────────────────────────────────────────────────────────┘
```

### Colored Dividers (Optional)
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ═══════════════════════════════════════════════ ⊗         │
│   ↑ Red divider (urgent section)                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ ⠿ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ⊗         │
│   ↑ Blue divider (normal section)                          │
└─────────────────────────────────────────────────────────────┘
```

### Collapsible Sections (Optional)
```
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ▼ Work Tasks ──────────────────────────────────── ⊗       │
│   ↑ Click to collapse/expand section                       │
└─────────────────────────────────────────────────────────────┘

When collapsed:
┌─────────────────────────────────────────────────────────────┐
│ ⠿ ▶ Work Tasks (3 tasks hidden) ───────────────────── ⊗     │
└─────────────────────────────────────────────────────────────┘
```

---

## Summary

The divider UI is designed to be:
- **Minimal**: Simple horizontal line, doesn't clutter interface
- **Intuitive**: Drag handle indicates it can be moved
- **Discoverable**: "Add Divider" button in filter bar
- **Flexible**: Can be positioned anywhere in task list
- **Unobtrusive**: Transparent background, subtle styling
- **Accessible**: Keyboard navigation, screen reader support

This design integrates seamlessly with the existing Bootstrap 5 UI and
SortableJS drag-and-drop functionality.
