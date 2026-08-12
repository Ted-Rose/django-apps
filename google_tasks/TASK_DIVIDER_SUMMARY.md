# Task Divider Feature - Executive Summary

**GitHub Issue:** https://github.com/Ted-Rose/django-apps/issues/3  
**Status:** Planning Complete  
**Estimated Effort:** 8-9 hours

---

## Problem

User wants to visually divide tasks into groups using empty lines
(dividers) in the task list UI.

---

## Recommended Solution

Add an `is_divider` boolean field to the existing `GoogleTask` model.

### Why This Approach?

✅ **Simple** - Single boolean field, minimal code changes  
✅ **Compatible** - Works with existing drag-and-drop ordering  
✅ **Clean** - Leverages existing `task_order` field  
✅ **Safe** - Local-only feature, won't sync to Google Tasks API  
✅ **Flexible** - Easy to create, move, and delete dividers  

---

## What Gets Changed

### Database (1 file)
- `google_tasks/models.py` - Add `is_divider` field

### Backend (3 files)
- `google_tasks/services.py` - Exclude dividers from Google sync
- `google_tasks/views.py` - Add create/delete divider endpoints
- `google_tasks/urls.py` - Add new URL routes

### Frontend (1 file)
- `google_tasks/templates/google_tasks/dashboard.html`
  - Render dividers as horizontal lines
  - Add "Create Divider" button
  - Add delete divider functionality
  - Add CSS styles for dividers

### Admin (1 file)
- `google_tasks/admin.py` - Show `is_divider` in list display

---

## Key Features

1. **Visual Dividers**: Horizontal dashed lines between tasks
2. **Drag-and-Drop**: Move dividers just like tasks
3. **Easy Creation**: Click button to add divider
4. **Easy Deletion**: Hover over divider, click X to remove
5. **Works Everywhere**: All views (All Tasks, Starred, List-filtered)
6. **No Google Sync**: Dividers stay local, never sent to Google API

---

## User Experience

### Before
```
Task 1
Task 2
Task 3
Task 4
Task 5
```

### After
```
Task 1
Task 2
─────────────  ← Divider (can drag, delete)
Task 3
Task 4
─────────────  ← Divider
Task 5
```

---

## Implementation Phases

1. **Phase 1:** Database schema (30 min)
2. **Phase 2:** Backend logic (2 hours)
3. **Phase 3:** Frontend UI (3 hours)
4. **Phase 4:** Admin interface (30 min)
5. **Phase 5:** Testing (2 hours)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Dividers sync to Google | Filter `is_divider=False` in sync code |
| Ordering conflicts | Use existing SortableJS, treat as tasks |
| Migration issues | Use `default=False`, test on staging |
| User confusion | Add tooltips and help text |

---

## Success Metrics

- ✅ Users can create/delete dividers
- ✅ Dividers can be repositioned
- ✅ No impact on Google Tasks sync
- ✅ Works in all views
- ✅ No performance issues

---

## Next Steps

1. Review this plan
2. Get approval to proceed
3. Create database migration
4. Implement backend changes
5. Implement frontend changes
6. Test thoroughly
7. Deploy to production

---

## Questions Answered

**Q: Is adding a field unnecessary complexity?**  
A: No. The `is_divider` field is the simplest approach that works with
existing architecture. Alternatives (separate model, divider_after
field) are more complex.

**Q: Will this break Google Tasks sync?**  
A: No. We'll explicitly filter out dividers in sync functions.

**Q: Can dividers be moved?**  
A: Yes. They use the same `task_order` field and drag-and-drop as tasks.

**Q: What if I delete a task list?**  
A: Dividers are linked via ForeignKey, so they'll be deleted too.

---

## Full Documentation

See <ref_file file="/Users/tedis.rozenfelds/personal_data/p_projects/django-apps/google_tasks/TASK_DIVIDER_IMPLEMENTATION_PLAN.md" /> for complete implementation details.
