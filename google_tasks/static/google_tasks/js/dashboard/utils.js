/**
 * Shared dashboard utilities.
 */

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

function showToast(message) {
    const toast = document.getElementById('action-toast');
    const messageEl = document.getElementById('toast-message');

    messageEl.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

/**
 * Compute the position for a card dropped between two neighbours.
 * Falls back to pos-1 (first), pos+1 (last) or the current timestamp
 * when neighbours are missing or have no usable data-position.
 */
function midpointPosition(prevEl, nextEl) {
    const prev = prevEl ? parseFloat(prevEl.dataset.position) : NaN;
    const next = nextEl ? parseFloat(nextEl.dataset.position) : NaN;
    if (!isNaN(prev) && !isNaN(next)) {
        return (prev + next) / 2;
    }
    if (!isNaN(next)) {
        return next - 1;
    }
    if (!isNaN(prev)) {
        return prev + 1;
    }
    return Date.now() / 1000;
}

/**
 * Walk siblings until one carries a numeric data-position.
 */
function siblingWithPosition(el, direction) {
    let sib = el[direction];
    while (sib && isNaN(parseFloat(sib.dataset.position))) {
        sib = sib[direction];
    }
    return sib;
}

/**
 * Renumber the rank badges (.order-btn) to match DOM order.
 */
function renumberOrderBadges() {
    const taskList = document.getElementById('task-list');
    if (!taskList) return;
    let rank = 0;
    taskList.querySelectorAll('[data-task-id]').forEach(card => {
        rank += 1;
        const btn = card.querySelector('.order-btn');
        if (btn) {
            btn.textContent = rank;
        }
    });
}

/**
 * POST a positional reorder payload to the current view's reorder
 * endpoint. Resolves with the parsed JSON body; reloads the page on
 * position_conflict so the client regains a consistent state.
 */
function postReorderUpdates(updates) {
    const body = { updates: updates };
    if (!(DASHBOARD_CONFIG.flags &&
            DASHBOARD_CONFIG.flags.is_starred_view)) {
        const params = new URLSearchParams(window.location.search);
        const taskListId = params.get('list');
        if (taskListId) {
            body.task_list_id = taskListId;
        }
    }

    return fetch(DASHBOARD_CONFIG.urls.reorder, {
        method: 'POST',
        headers: {
            'X-CSRFToken': getCookie('csrftoken'),
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    }).then(response => {
        return response.json().catch(() => ({})).then(data => {
            if (response.status === 409 ||
                    data.error === 'position_conflict') {
                showToast(
                    'Order conflicted with another change, reloading'
                );
                location.reload();
                return data;
            }
            if (!response.ok || !data.success) {
                showToast('Failed to save task order');
            }
            return data;
        });
    }).catch(error => {
        console.error('Error saving task order:', error);
        showToast('Failed to save task order');
        return { success: false };
    });
}
