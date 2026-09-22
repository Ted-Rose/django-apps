/**
 * Divider management: create, inline rename, delete.
 */

function getCurrentTaskListId() {
    const urlParams = new URLSearchParams(window.location.search);
    const listParam = urlParams.get('list');

    if (listParam) {
        return listParam;
    }

    const firstList = DASHBOARD_CONFIG.first_list_id;
    if (firstList && firstList !== '') {
        return firstList;
    }

    return null;
}

function getNextPosition() {
    const taskContainers = document.querySelectorAll(
        '[data-task-id]'
    );
    let maxOrder = 0;
    taskContainers.forEach(container => {
        const taskId = container.getAttribute('data-task-id');
        const orderAttr = container.getAttribute('data-order');
        if (orderAttr) {
            maxOrder = Math.max(maxOrder, parseInt(orderAttr));
        }
    });
    return maxOrder + 1;
}

function createDivider() {
    if (DASHBOARD_CONFIG.flags && DASHBOARD_CONFIG.flags.is_starred_view) {
        const position = getNextPosition();

        console.log('Creating starred divider:', {
            position: position,
            is_starred: true
        });

        fetch(DASHBOARD_CONFIG.urls.createDivider, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            },
            body: JSON.stringify({
                position: position,
                is_starred: true
            })
        })
        .then(response => {
            console.log('Response status:', response.status);
            return response.json();
        })
        .then(data => {
            console.log('Response data:', data);
            if (data.success) {
                window.location.reload();
            } else {
                alert('Error creating divider: ' +
                      (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error creating divider: ' + error.message);
        });
    } else {
        const taskListId = getCurrentTaskListId();

        if (!taskListId) {
            alert('Please select a specific task list first.\n\n' +
                  'Dividers must belong to a task list. ' +
                  'Use the dropdown to select a task list, then add a divider.');
            return false;
        }

        const position = getNextPosition();

        console.log('Creating divider:', {
            taskListId: taskListId,
            position: position
        });

        fetch(DASHBOARD_CONFIG.urls.createDivider, {
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
        .then(response => {
            console.log('Response status:', response.status);
            return response.json();
        })
        .then(data => {
            console.log('Response data:', data);
            if (data.success) {
                window.location.reload();
            } else {
                alert('Error creating divider: ' +
                      (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error creating divider: ' + error.message);
        });
    }
    return false;
}

function deleteDivider(taskId, skipHistory = false) {
    if (!confirm('Delete this divider?')) {
        return;
    }

    const dividerCard = document.querySelector(`[data-task-id="${taskId}"]`);
    const dividerText = dividerCard ? dividerCard.querySelector('.divider-text')?.value : '';

    if (!skipHistory) {
        actionHistory.recordAction({
            type: 'DELETE_DIVIDER',
            taskId: taskId,
            dividerText: dividerText
        });
    }

    fetch(`/tasks/divider/${taskId}/delete/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            window.location.reload();
        } else {
            alert('Error deleting divider');
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error deleting divider');
    });
}

function updateDividerText(input, skipHistory = false) {
    const taskId = input.dataset.taskId;
    const newText = input.value.trim();
    const oldText = input.defaultValue;

    if (!skipHistory && oldText !== newText) {
        actionHistory.recordAction({
            type: 'UPDATE_DIVIDER',
            taskId: taskId,
            previousText: oldText,
            newText: newText
        });
    }

    fetch(`/tasks/divider/${taskId}/update/`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCookie('csrftoken')
        },
        body: JSON.stringify({
            title: newText
        })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            alert('Error updating divider text');
            input.value = input.defaultValue;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        alert('Error updating divider text');
        input.value = input.defaultValue;
    });
}
