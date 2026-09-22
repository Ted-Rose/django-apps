/**
 * Drag-to-reorder via SortableJS, plus link-click suppression
 * while dragging.
 */

// Prevent link navigation during drag
let isDragging = false;
let dragStartTime = 0;

document.addEventListener('mousedown', function(e) {
    if (e.target.closest('.task-card:not(.divider-card)')) {
        dragStartTime = Date.now();
    }
});

document.addEventListener('click', function(e) {
    const link = e.target.closest('.task-title-link');
    if (link && isDragging) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    // Also prevent click if mouse was held down (drag intent)
    if (link && (Date.now() - dragStartTime) > 150) {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }

    // Save current URL to localStorage for back navigation
    if (link && !isDragging) {
        localStorage.setItem('taskListReferrer',
            window.location.pathname + window.location.search);
    }
}, true);

function reorderTasksToOrder(order) {
    const taskList = document.getElementById('task-list');
    if (!taskList) return;

    const taskCards = {};
    taskList.querySelectorAll('[data-task-id]').forEach(card => {
        taskCards[card.dataset.taskId] = card;
    });

    // Full-order submission (undo/redo): assign sequential positions
    // 1.0 ... n.0 — the two-phase swap on the server keeps this safe
    // under the per-user unique constraint.
    const updates = [];
    order.forEach(taskId => {
        const card = taskCards[taskId];
        if (card) {
            taskList.appendChild(card);
            const position = updates.length + 1;
            card.dataset.position = position;
            updates.push({ task_id: taskId, position: position });
        }
    });

    renumberOrderBadges();
    postReorderUpdates(updates);
}

// Initialize SortableJS for drag-to-reorder tasks
const taskList = document.getElementById('task-list');
let previousOrder = [];

if (taskList) {
    previousOrder = Array.from(
        taskList.querySelectorAll('[data-task-id]')
    ).map(el => el.dataset.taskId);

    Sortable.create(taskList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        handle: '.divider-drag-handle, .task-content',
        draggable: '.task-container, .divider-card',
        delay: 200,
        delayOnTouchOnly: true,
        onStart: function() {
            isDragging = true;
            previousOrder = Array.from(
                taskList.querySelectorAll('[data-task-id]')
            ).map(el => el.dataset.taskId);
        },
        onEnd: function (evt) {
            const order = Array.from(
                taskList.querySelectorAll('[data-task-id]')
            ).map(el => el.dataset.taskId);

            actionHistory.recordAction({
                type: 'REORDER_TASKS',
                previousOrder: previousOrder,
                newOrder: order
            });

            // Send only what moved: compute a midpoint position from
            // the dropped card's new neighbours.
            const item = evt.item;
            const prevEl = siblingWithPosition(
                item, 'previousElementSibling'
            );
            const nextEl = siblingWithPosition(
                item, 'nextElementSibling'
            );
            const position = midpointPosition(prevEl, nextEl);
            item.dataset.position = position;
            renumberOrderBadges();

            postReorderUpdates([{
                task_id: item.dataset.taskId,
                position: position
            }]).then(data => {
                if (data && data.success) {
                    const indicator =
                        document.getElementById('save-indicator');
                    indicator.style.display = 'block';
                    setTimeout(() => {
                        indicator.style.display = 'none';
                    }, 2000);
                }
            });

            // Reset dragging flag after a short delay
            setTimeout(() => {
                isDragging = false;
            }, 100);
        }
    });
}
