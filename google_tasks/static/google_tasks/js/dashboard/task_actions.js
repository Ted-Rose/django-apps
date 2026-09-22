/**
 * Task actions: star, order, complete/uncomplete, archive, delete,
 * and the modals that trigger them.
 */

let currentTaskId = null;
let completeTaskModalInstance = null;
let uncompleteTaskModalInstance = null;
let createTaskModalInstance = null;

function showCreateTaskModal() {
    document.getElementById('taskTitle').value = '';
    document.getElementById('taskNotes').value = '';
    document.getElementById('taskStarred').checked = false;

    const modalElement = document.getElementById('createTaskModal');
    if (!createTaskModalInstance) {
        createTaskModalInstance = new bootstrap.Modal(modalElement);
    }
    createTaskModalInstance.show();
}

function showCompleteModal(taskId, taskTitle) {
    currentTaskId = taskId;
    document.getElementById('completeTaskTitle').textContent =
        taskTitle;

    const modalElement = document.getElementById(
        'completeTaskModal'
    );
    if (!completeTaskModalInstance) {
        completeTaskModalInstance = new bootstrap.Modal(
            modalElement
        );
    }
    completeTaskModalInstance.show();
}

function showUncompleteModal(taskId, taskTitle) {
    currentTaskId = taskId;
    document.getElementById('uncompleteTaskTitle').textContent =
        taskTitle;

    const modalElement = document.getElementById(
        'uncompleteTaskModal'
    );
    if (!uncompleteTaskModalInstance) {
        uncompleteTaskModalInstance = new bootstrap.Modal(
            modalElement
        );
    }
    uncompleteTaskModalInstance.show();
}

function completeTask(skipHistory = false) {
    if (!currentTaskId) return;

    const taskId = currentTaskId;
    const taskCard = document.querySelector(
        `[data-task-id="${taskId}"]`
    );
    const taskTitle = taskCard ?
        taskCard.querySelector('.card-title')?.textContent.trim() :
        '';

    if (!skipHistory) {
        actionHistory.recordAction({
            type: 'COMPLETE_TASK',
            taskId: taskId,
            taskTitle: taskTitle
        });
    }

    const csrftoken = getCookie('csrftoken');

    fetch(`/tasks/task/${taskId}/complete/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            completeTaskModalInstance.hide();

            const taskCard = document.querySelector(
                `[data-task-id="${taskId}"]`
            );
            if (taskCard) {
                taskCard.style.transition =
                    'opacity 0.3s ease';
                taskCard.style.opacity = '0';
                setTimeout(() => {
                    // Force reload with cache busting
                    const url = new URL(window.location.href);
                    url.searchParams.set('_t', Date.now());
                    window.location.href = url.toString();
                }, 500);
            }
        } else if (data.reauth_required) {
            completeTaskModalInstance.hide();
            window.location.href = data.authorization_url;
        } else {
            alert('Failed to complete task: ' +
                (data.error || 'Unknown error'));
            completeTaskModalInstance.hide();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while completing the task');
        completeTaskModalInstance.hide();
    });
}

function uncompleteTask(skipHistory = false) {
    if (!currentTaskId) return;

    const taskId = currentTaskId;
    const taskCard = document.querySelector(
        `[data-task-id="${taskId}"]`
    );
    const taskTitle = taskCard ? taskCard.textContent.trim() : '';

    if (!skipHistory) {
        actionHistory.recordAction({
            type: 'UNCOMPLETE_TASK',
            taskId: taskId,
            taskTitle: taskTitle
        });
    }

    const csrftoken = getCookie('csrftoken');

    fetch(`/tasks/task/${taskId}/uncomplete/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            uncompleteTaskModalInstance.hide();

            const taskCard = document.querySelector(
                `[data-task-id="${taskId}"]`
            );
            if (taskCard) {
                taskCard.style.transition =
                    'opacity 0.3s ease';
                taskCard.style.opacity = '0';
                setTimeout(() => {
                    // Force reload with cache busting
                    const url = new URL(window.location.href);
                    url.searchParams.set('_t', Date.now());
                    window.location.href = url.toString();
                }, 500);
            }
        } else if (data.reauth_required) {
            uncompleteTaskModalInstance.hide();
            window.location.href = data.authorization_url;
        } else {
            alert('Failed to uncomplete task: ' +
                (data.error || 'Unknown error'));
            uncompleteTaskModalInstance.hide();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert(
            'An error occurred while uncompleting the task'
        );
        uncompleteTaskModalInstance.hide();
    });
}

function setTaskOrder(taskId, order) {
    const csrftoken = getCookie('csrftoken');
    const isStarredView = !!(
        DASHBOARD_CONFIG.flags && DASHBOARD_CONFIG.flags.is_starred_view
    );

    // Optimistic update: Update UI immediately
    const taskCard = document.querySelector(
        `[data-task-id="${taskId}"]`
    );
    const orderBtn = taskCard?.querySelector(
        '.btn-outline-secondary'
    );
    const oldOrder = orderBtn?.textContent;

    // Move task to correct position BEFORE updating the button
    const taskList = document.getElementById('task-list');
    if (taskList && taskCard) {
        const allTasks = Array.from(
            taskList.querySelectorAll('[data-task-id]')
        );

        // Remove current task from array for comparison
        const otherTasks = allTasks.filter(t => t !== taskCard);

        // Find the correct position for this task
        let insertBefore = null;

        if (DASHBOARD_CONFIG.order_by === 'order_asc') {
            // For ascending order: 1, 2, 3... (lower first)
            for (let i = 0; i < otherTasks.length; i++) {
                // Skip dividers - they don't participate in ordering
                if (otherTasks[i].classList.contains('divider-card')) {
                    continue;
                }

                const otherOrderBtn = otherTasks[i].querySelector(
                    '.btn-outline-secondary'
                );
                const otherOrderText = otherOrderBtn?.textContent.trim();

                // Tasks with no order (—) or no button go to end
                if (!otherOrderBtn || !otherOrderText ||
                    otherOrderText === '—') {
                    insertBefore = otherTasks[i];
                    break;
                }

                const otherOrder = parseInt(otherOrderText);
                // Insert before first task with HIGHER order
                if (!isNaN(otherOrder) && order < otherOrder) {
                    insertBefore = otherTasks[i];
                    break;
                }
            }
        } else {
            // For descending order: 50, 20, 15... (higher first)
            for (let i = 0; i < otherTasks.length; i++) {
                // Skip dividers - they don't participate in ordering
                if (otherTasks[i].classList.contains('divider-card')) {
                    continue;
                }

                const otherOrderBtn = otherTasks[i].querySelector(
                    '.btn-outline-secondary'
                );
                const otherOrderText = otherOrderBtn?.textContent.trim();

                // Tasks with no order (—) or no button go to end
                if (!otherOrderBtn || !otherOrderText ||
                    otherOrderText === '—') {
                    insertBefore = otherTasks[i];
                    break;
                }

                const otherOrder = parseInt(otherOrderText);
                // Insert before first task with LOWER order
                if (!isNaN(otherOrder) && otherOrder < order) {
                    insertBefore = otherTasks[i];
                    break;
                }
            }
        }

        if (insertBefore) {
            taskList.insertBefore(taskCard, insertBefore);
        } else {
            taskList.appendChild(taskCard);
        }
    }

    // Update the button text AFTER repositioning
    if (orderBtn) {
        orderBtn.textContent = order;
    }

    // Perform API call in background
    fetch(`/tasks/task/${taskId}/set-order/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            order: order,
            is_starred_view: isStarredView
        })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            // Revert on error
            if (orderBtn && oldOrder) {
                orderBtn.textContent = oldOrder;
            }
            alert('Failed to update task order: ' +
                (data.error || 'Unknown error'));
            location.reload();
        }
    })
    .catch(error => {
        console.error('Error:', error);
        // Revert on error
        if (orderBtn && oldOrder) {
            orderBtn.textContent = oldOrder;
        }
        alert('An error occurred while updating task order');
        location.reload();
    });
}

function toggleStar(taskId, skipHistory = false) {
    const starBtn = document.querySelector(`[data-task-id="${taskId}"] .star-btn`);
    const wasStarred = starBtn.classList.contains('starred');

    if (!skipHistory) {
        actionHistory.recordAction({
            type: 'TOGGLE_STAR',
            taskId: taskId,
            previousState: wasStarred
        });
    }

    const csrftoken = getCookie('csrftoken');
    fetch(`/tasks/task/${taskId}/toggle-star/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const icon = starBtn.querySelector('i');
            if (data.is_starred) {
                starBtn.classList.add('starred');
                icon.classList.remove('bi-star');
                icon.classList.add('bi-star-fill');
            } else {
                starBtn.classList.remove('starred');
                icon.classList.remove('bi-star-fill');
                icon.classList.add('bi-star');
            }
        }
    });
}

function archiveTask(taskId, skipHistory = false) {
    const taskCard = document.querySelector(`[data-task-id="${taskId}"]`);
    const taskTitle = taskCard ? taskCard.querySelector('.card-title')?.textContent.trim() : '';

    if (!skipHistory) {
        actionHistory.recordAction({
            type: 'ARCHIVE_TASK',
            taskId: taskId,
            taskTitle: taskTitle
        });
    }

    const csrftoken = getCookie('csrftoken');

    fetch(`/tasks/task/${taskId}/archive/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const taskCard = document.querySelector(`[data-task-id="${taskId}"]`);
            if (taskCard) {
                taskCard.style.transition = 'opacity 0.3s ease';
                taskCard.style.opacity = '0';
                setTimeout(() => {
                    taskCard.remove();
                }, 300);
            }
        } else {
            alert('Failed to archive task');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while archiving the task');
    });
}

function deleteTask(taskId, skipHistory = false) {
    if (!confirm('Move this task to trash?')) {
        return;
    }

    const taskCard = document.querySelector(`[data-task-id="${taskId}"]`);
    const taskTitle = taskCard ? taskCard.querySelector('.card-title')?.textContent.trim() : '';

    if (!skipHistory) {
        actionHistory.recordAction({
            type: 'DELETE_TASK',
            taskId: taskId,
            taskTitle: taskTitle
        });
    }

    const csrftoken = getCookie('csrftoken');

    fetch(`/tasks/task/${taskId}/delete/`, {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const taskCard = document.querySelector(`[data-task-id="${taskId}"]`);
            if (taskCard) {
                taskCard.style.transition = 'opacity 0.3s ease';
                taskCard.style.opacity = '0';
                setTimeout(() => {
                    taskCard.remove();
                }, 300);
            }
        } else {
            alert('Failed to delete task');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while deleting the task');
    });
}
