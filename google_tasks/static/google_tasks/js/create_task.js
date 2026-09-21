/**
 * Create Task Modal JavaScript
 * Handles task creation with title, notes, labels, and starred status
 */

function createTask() {
    const title = document.getElementById('taskTitle').value.trim();
    const notes = document.getElementById('taskNotes').value.trim();
    const isStarred = document.getElementById('taskStarred').checked;
    
    // Collect selected label IDs
    const labelCheckboxes = document.querySelectorAll(
        'input[name="task_labels"]:checked'
    );
    const labelIds = Array.from(labelCheckboxes).map(
        cb => parseInt(cb.value)
    );
    
    if (!title) {
        alert('Please enter a task title');
        return;
    }
    
    const csrftoken = getCookie('csrftoken');
    const params = new URLSearchParams(window.location.search);
    const taskListId = params.get('list');
    
    const requestBody = {
        title: title,
        notes: notes || null,
        is_starred: isStarred,
        label_ids: labelIds
    };

    // Handle starred view - force is_starred to true
    if (typeof IS_STARRED_VIEW !== 'undefined' && IS_STARRED_VIEW) {
        requestBody.is_starred = true;
    } else {
        // If a task list is selected, use it
        if (taskListId) {
            requestBody.task_list_id = taskListId;
        }
    }
    
    fetch('/tasks/task/create/', {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            createTaskModalInstance.hide();
            // Clear form
            document.getElementById('taskTitle').value = '';
            document.getElementById('taskNotes').value = '';
            document.getElementById('taskStarred').checked = false;
            // Uncheck all labels
            labelCheckboxes.forEach(cb => cb.checked = false);
            
            // Add task to DOM dynamically
            if (data.task) {
                addTaskToDOM(data.task);
            } else {
                // Fallback to reload if task data not provided
                location.reload();
            }
        } else if (data.reauth_required) {
            createTaskModalInstance.hide();
            window.location.href = data.authorization_url;
        } else {
            alert('Failed to create task: ' + 
                (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('An error occurred while creating the task');
    });
}

// Helper function to get CSRF token from cookies
function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            const cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(
                    cookie.substring(name.length + 1)
                );
                break;
            }
        }
    }
    return cookieValue;
}

/**
 * Add a newly created task to the DOM
 * @param {Object} task - Task data from the server
 */
function addTaskToDOM(task) {
    const taskList = document.getElementById('task-list');
    
    // If task list doesn't exist, reload the page
    if (!taskList) {
        location.reload();
        return;
    }
    
    // Check if we should display this task based on current filters
    const params = new URLSearchParams(window.location.search);
    const labelFilter = params.get('label');
    const secondaryLabelFilter = params.get('secondary_label');
    
    // Check if task matches primary label filter
    if (labelFilter) {
        const hasLabel = task.labels.some(
            label => label.name === labelFilter
        );
        if (!hasLabel) {
            // Task doesn't match filter, don't add to DOM
            return;
        }
    }
    
    // Build labels HTML
    let labelsHTML = '';
    if (task.labels && task.labels.length > 0) {
        labelsHTML = '<div class="mb-2">';
        task.labels.forEach(label => {
            labelsHTML += `<span class="badge me-1" 
                style="background-color: ${label.color}">
                ${escapeHtml(label.name)}
            </span>`;
        });
        labelsHTML += '</div>';
    }
    
    // Build notes HTML
    let notesHTML = '';
    if (task.notes) {
        const truncatedNotes = truncateWords(task.notes, 20);
        notesHTML = `<p class="card-text text-muted">
            ${escapeHtml(truncatedNotes)}
        </p>`;
    }
    
    // Build due date HTML
    let dueDateHTML = '';
    if (task.due_date) {
        const dueDate = new Date(task.due_date);
        const formattedDate = dueDate.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        dueDateHTML = `<small class="text-muted">
            <i class="bi bi-calendar"></i> Due: ${formattedDate}
        </small>`;
    }
    
    // Determine order value to display
    const isStarredView = typeof IS_STARRED_VIEW !== 'undefined' && 
        IS_STARRED_VIEW;
    const orderValue = isStarredView ? 
        (task.starred_order || '—') : 
        (task.task_order || '—');
    
    // Build task HTML
    const taskHTML = `
    <div class="task-container d-flex mb-2" data-task-id="${task.task_id}">
        <div class="card task-card flex-grow-1 task-content">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">
                            <span class="complete-btn me-1" 
                                onclick="showCompleteModal('${task.task_id}', 
                                '${escapeJs(task.title)}'); 
                                event.stopPropagation();">
                                <i class="bi bi-check-circle"></i>
                            </span>
                            <span class="star-btn me-1 
                                ${task.is_starred ? 'starred' : ''}" 
                                onclick="toggleStar('${task.task_id}'); 
                                event.stopPropagation();" 
                                title="${task.is_starred ? 'Unstar' : 'Star'}">
                                <i class="bi ${task.is_starred ? 
                                    'bi-star-fill' : 'bi-star'}"></i>
                            </span>
                            <a href="/tasks/task/${task.task_id}/" 
                                class="task-title-link">
                                ${escapeHtml(task.title)}
                            </a>
                        </h5>
                        ${labelsHTML}
                        ${notesHTML}
                        ${dueDateHTML}
                    </div>
                    <div class="dropdown ms-2">
                        <button class="btn btn-sm btn-link text-muted" 
                            type="button" data-bs-toggle="dropdown">
                            <i class="bi bi-three-dots-vertical"></i>
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li>
                                <a class="dropdown-item" href="#" 
                                    onclick="archiveTask('${task.task_id}'); 
                                    return false;">
                                    <i class="bi bi-archive"></i> Archive
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item text-danger" href="#" 
                                    onclick="deleteTask('${task.task_id}'); 
                                    return false;">
                                    <i class="bi bi-trash"></i> Delete
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
        <div class="task-order-badge ms-2">
            <div class="dropdown">
                <button class="btn btn-sm btn-outline-secondary order-btn" 
                    type="button" data-bs-toggle="dropdown" 
                    title="Change order">
                    ${orderValue}
                </button>
                <ul class="dropdown-menu dropdown-menu-end">
                    <li><a class="dropdown-item" href="#" 
                        onclick="setTaskOrder('${task.task_id}', 1); 
                        event.stopPropagation(); return false;">1</a></li>
                    <li><a class="dropdown-item" href="#" 
                        onclick="setTaskOrder('${task.task_id}', 5); 
                        event.stopPropagation(); return false;">5</a></li>
                    <li><a class="dropdown-item" href="#" 
                        onclick="setTaskOrder('${task.task_id}', 10); 
                        event.stopPropagation(); return false;">10</a></li>
                    <li><a class="dropdown-item" href="#" 
                        onclick="setTaskOrder('${task.task_id}', 15); 
                        event.stopPropagation(); return false;">15</a></li>
                    <li><a class="dropdown-item" href="#" 
                        onclick="setTaskOrder('${task.task_id}', 20); 
                        event.stopPropagation(); return false;">20</a></li>
                    <li><a class="dropdown-item" href="#" 
                        onclick="setTaskOrder('${task.task_id}', 50); 
                        event.stopPropagation(); return false;">50</a></li>
                </ul>
            </div>
        </div>
    </div>`;
    
    // Insert at the beginning of the task list
    taskList.insertAdjacentHTML('afterbegin', taskHTML);
    
    // Apply secondary label filter if active
    if (secondaryLabelFilter) {
        const newTaskElement = taskList.querySelector(
            `[data-task-id="${task.task_id}"]`
        );
        const hasSecondaryLabel = task.labels.some(
            label => label.name === secondaryLabelFilter
        );
        if (!hasSecondaryLabel && newTaskElement) {
            newTaskElement.classList.add('task-hidden');
        }
    }
    
    // Reinitialize sortable if it exists
    if (typeof initSortable === 'function') {
        initSortable();
    }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Escape JavaScript special characters for use in onclick attributes
 */
function escapeJs(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/**
 * Truncate text to specified number of words
 */
function truncateWords(text, wordCount) {
    const words = text.split(/\s+/);
    if (words.length <= wordCount) {
        return text;
    }
    return words.slice(0, wordCount).join(' ') + '...';
}
