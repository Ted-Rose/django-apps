# Plan: Refactor `dashboard.html` for Readability

## Goal

Reduce `google_tasks/templates/google_tasks/dashboard.html` (2,275 lines)
to a readable Django template (~400-500 lines) by extracting the inline
CSS, the inline JavaScript, and repeated markup into separate files —
with **zero behavior changes**.

## Current State

The file is a single template containing three large inline blocks:

| Lines    | Content                                          | Size      |
|----------|--------------------------------------------------|-----------|
| 10-266   | `<style>` block                                  | ~257 lines|
| 269-460  | Navbar: view selector, label filter, ordering    | ~192 lines|
| 461-635  | Task list: task cards, divider cards, empty/auth states, completed-tasks collapse | ~175 lines |
| 636-717  | Floating UI (save indicator, add btn, undo/redo, toast) + 2 modals | ~82 lines |
| 723-2275 | `<script>` block                                 | ~1,552 lines |

### Constraints discovered

1. **JS depends on Django template tags in ~20 places.** The inline
   script uses `{% url %}` (`reorder_starred`, `reorder_tasks`,
   `dashboard`, `create_divider`, `sync`, `process_labels`) and
   context flags (`is_starred_view`, `is_overdue_view`,
   `is_archived_view`, `is_trash_view`, `order_by`,
   `task_lists.0.list_id`, `has_credentials`). These must be bridged
   before JS can move to static files.
2. **Inline `onclick=` handlers everywhere** call global functions
   (`toggleStar`, `archiveTask`, `selectList`, ...). Extracted JS must
   keep these functions on global scope (plain scripts, NOT
   `type="module"`).
3. **An extraction precedent already exists** — follow it:
   - `static/google_tasks/js/create_task.js` (plain global functions)
   - `templates/google_tasks/components/create_task_modal.html`
   - `components/burger_menu.html`
4. `getCookie` is duplicated in `create_task.js` — opportunity to
   share one copy.

## Target Structure

```
google_tasks/
  static/google_tasks/
    css/
      dashboard.css              # entire <style> block
    js/
      dashboard/
        config.js                # parses json_script config -> window.DASHBOARD_CONFIG
        utils.js                 # getCookie, showToast
        action_history.js        # ActionHistory class, performUndo, performRedo
        task_actions.js          # toggleStar, setTaskOrder, complete/uncomplete,
                                 # archiveTask, deleteTask, modal show functions
        dividers.js              # createDivider, updateDividerText, deleteDivider,
                                 # getNextPosition, getCurrentTaskListId
        reorder.js               # SortableJS init, reorderTasksToOrder
        filters.js               # selectList, selectLabel, selectSecondaryLabel,
                                 # changeOrder, saveCurrentView
        autosync.js              # performAutoSync, startAutoSync, stopAutoSync,
                                 # checkAndSyncIfStale, processLabels
        main.js                  # DOMContentLoaded init, keyboard shortcuts,
                                 # visibilitychange/beforeunload handlers
  templates/google_tasks/
    dashboard.html               # slim template wiring it all together
    components/dashboard/
      navbar.html                # nav bar (optionally split further below)
      task_card.html             # single active-task card (used in for loop)
      divider_card.html          # single divider card (used in for loop)
      completed_tasks.html       # collapsible completed section
      modals.html                # completeTaskModal + uncompleteTaskModal
      floating_controls.html     # save indicator, add btn, undo/redo, toast
```

## Phases

Each phase is independently committable and verifiable.

### Phase 1 — Extract CSS (lowest risk, do first)

1. Create `static/google_tasks/css/dashboard.css` with the contents of
   the `<style>` block (lines 10-266).
2. Move `{% load static %}` to the top of the template (currently at
   line 721) and add
   `<link rel="stylesheet" href="{% static 'google_tasks/css/dashboard.css' %}">`
   in `<head>`.
3. Verify: page renders pixel-identical; `dashboard.css` returns 200.

### Phase 2 — Extract template partials

Extract markup into `templates/google_tasks/components/dashboard/`
using `{% include %}`. Includes inherit the parent context, so
`{% for %}` loop variables (`task`, `label`) keep working — no view
changes needed.

1. `navbar.html` — lines 269-460 (all four dropdowns + search button +
   burger menu include).
2. `divider_card.html` — lines 466-490, included inside the existing
   `{% for task in tasks %}` loop.
3. `task_card.html` — lines 492-561 (task card + order badge),
   included in the same loop.
4. `completed_tasks.html` — lines 598-635.
5. `floating_controls.html` — save indicator, floating add button,
   undo/redo, action toast (lines 638-661).
6. `modals.html` — the complete/uncomplete modals (lines 663-716).

### Phase 3 — Extract JavaScript

#### 3a. Bridge template context to JS (only Python change)

The JS cannot call `{% url %}` or read context flags from a static
file. Render a config object in the template and have `config.js`
parse it.

Preferred approach — `json_script` (safe escaping built in):

- In `views.py`, build `context['dashboard_js_config'] = {...}` in the
  three render sites for `dashboard.html` (lines ~218, ~376, ~537 —
  factor into a shared helper since the same context is built three
  times).
- In the template:
  `{{ dashboard_js_config|json_script:"dashboard-config" }}`
- `config.js` reads it and exposes `window.DASHBOARD_CONFIG`.

Config keys needed (audit the script before moving it — current list):

- `urls.reorder` — pick `reorder_starred` vs `reorder_tasks` server
  side (collapses two duplicated `{% if is_starred_view %}` blocks)
- `urls.createDivider`, `urls.sync`, `urls.processLabels`,
  `urls.dashboard`
- `flags.is_starred_view`, `is_overdue_view`, `is_archived_view`,
  `is_trash_view`, `has_credentials`
- `order_by`, `first_list_id` (`task_lists.0.list_id`)

Simpler alternative (no view change): a small inline `<script>` in the
template that assigns `window.DASHBOARD_CONFIG = {...}` using the
existing `{% url %}`/`{% if %}` tags. Acceptable, but `json_script` is
cleaner and escapes values safely.

#### 3b. Move functions into the JS files above

- Keep all referenced functions global so inline `onclick=` handlers
  keep working (same convention as `create_task.js`).
- Replace `{% if %}`/`{% url %}` branches inside the moved code with
  reads from `DASHBOARD_CONFIG`.
- Move `getCookie`/`showToast` into `utils.js`; delete the duplicated
  `getCookie` in `create_task.js` and load `utils.js` first.

#### 3c. Script load order (matters — plain scripts, no bundler)

```html
<script src="{% static 'google_tasks/js/dashboard/config.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/utils.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/action_history.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/task_actions.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/dividers.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/reorder.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/filters.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/autosync.js' %}"></script>
<script src="{% static 'google_tasks/js/create_task.js' %}"></script>
<script src="{% static 'google_tasks/js/dashboard/main.js' %}"></script>
```

(Keep the existing Bootstrap + SortableJS CDN tags first.)

### Phase 4 — Optional cleanups (defer unless desired)

- Replace inline `onclick=` attributes with delegated event listeners
  using `data-*` attributes; then the functions no longer need to be
  global and files could become ES modules.
- Split `navbar.html` further into per-dropdown includes
  (`view_dropdown.html`, `label_filter.html`, `ordering_dropdown.html`).
- Check whether `archived.html`, `trash.html`, `search.html` share CSS
  that could move into a shared stylesheet.

## Risks & Gotchas

- **Missed template tags in JS**: audit for `{{`/`{%` inside the
  script before extraction (currently ~20 usages listed above).
- **`onclick` scope**: do NOT use `type="module"` — module scope would
  break every inline handler.
- **Loop context**: `{% include %}` sees `for`/`forloop` variables —
  but verify `task_card.html` renders identically inside the loop.
- **`escapejs` in attributes**: `onclick="showCompleteModal('{{ task.task_id }}', '{{ task.title|escapejs }}')"` must be preserved
  verbatim in partials.
- **Static files in dev**: run with `DEBUG=True` or
  `collectstatic` as appropriate for the environment.

## Verification (no frontend test suite exists)

Manual smoke checklist after each phase:

- [ ] Page loads with styling intact; zero console errors
- [ ] Navbar: list selector, label filter, ordering all navigate
- [ ] Task actions: star, complete, uncomplete, archive, delete,
      set-order dropdown
- [ ] Drag-to-reorder works; "Order saved" indicator appears
- [ ] Dividers: create, inline rename, delete
- [ ] Undo/redo buttons + Ctrl+Z / Ctrl+Y
- [ ] Auto-sync triggers on load / tab visibility change
- [ ] Create-task modal still works (create_task.js unaffected)
- [ ] Empty state and unauthenticated states render correctly
- [ ] Diff rendered HTML before/after — markup identical
