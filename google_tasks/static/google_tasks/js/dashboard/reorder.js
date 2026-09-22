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

    order.forEach(taskId => {
        if (taskCards[taskId]) {
            taskList.appendChild(taskCards[taskId]);
        }
    });

    const url = DASHBOARD_CONFIG.urls.reorder;
    let body;
    if (DASHBOARD_CONFIG.flags && DASHBOARD_CONFIG.flags.is_starred_view) {
        body = JSON.stringify({ order: order });
    } else {
        const params = new URLSearchParams(window.location.search);
        const taskListId = params.get('list');
        body = JSON.stringify({
            order: order,
            task_list_id: taskListId
        });
    }

    fetch(url, {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCookie('csrftoken'),
            'Content-Type': 'application/json'
        },
        body: body
    });
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
        onEnd: function () {
            const order = Array.from(
                taskList.querySelectorAll('[data-task-id]')
            ).map(el => el.dataset.taskId);

            actionHistory.recordAction({
                type: 'REORDER_TASKS',
                previousOrder: previousOrder,
                newOrder: order
            });

            let body;
            if (DASHBOARD_CONFIG.flags &&
                    DASHBOARD_CONFIG.flags.is_starred_view) {
                // Use starred reorder endpoint
                body = JSON.stringify({ order: order });
            } else {
                // Use regular task reorder endpoint
                const params = new URLSearchParams(window.location.search);
                const taskListId = params.get('list');
                body = JSON.stringify({
                    order: order,
                    task_list_id: taskListId
                });
            }
            const url = DASHBOARD_CONFIG.urls.reorder;

            fetch(url, {
                method: 'POST',
                headers: {
                    'X-CSRFToken': getCookie('csrftoken'),
                    'Content-Type': 'application/json'
                },
                body: body
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
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
