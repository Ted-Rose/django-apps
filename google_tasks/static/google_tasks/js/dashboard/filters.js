/**
 * View/label/ordering filters.
 */

function saveCurrentView() {
    try {
        const currentPath = window.location.pathname;
        const currentSearch = window.location.search;
        const fullUrl = currentPath + currentSearch;
        // Save all views (including default dashboard)
        localStorage.setItem('lastTasksView', fullUrl);
    } catch (e) {
        console.warn('Failed to save view to localStorage:', e);
    }
}

function isSpecialView() {
    const flags = DASHBOARD_CONFIG.flags || {};
    return flags.is_starred_view || flags.is_overdue_view ||
        flags.is_archived_view || flags.is_trash_view;
}

function selectList(listId) {
    if (isSpecialView()) {
        // Navigate to dashboard with list filter
        const params = new URLSearchParams();
        if (listId) params.set('list', listId);
        const url =
            DASHBOARD_CONFIG.urls.dashboard + '?' + params.toString();
        saveCurrentView();
        window.location.href = url;
    } else {
        const params = new URLSearchParams(window.location.search);
        params.delete('list');
        params.delete('label');
        params.delete('secondary_label');
        params.delete('sync');
        if (listId) params.set('list', listId);
        const url = '?' + params.toString();
        saveCurrentView();
        window.location.href = url;
    }
}

function selectLabel(labelName) {
    if (isSpecialView()) {
        // Navigate to dashboard with label filter
        const params = new URLSearchParams();
        if (labelName) params.set('label', labelName);
        const url =
            DASHBOARD_CONFIG.urls.dashboard + '?' + params.toString();
        saveCurrentView();
        window.location.href = url;
    } else {
        const params = new URLSearchParams(window.location.search);
        params.delete('list');
        params.delete('label');
        params.delete('secondary_label');
        params.delete('sync');
        if (labelName) params.set('label', labelName);
        const url = '?' + params.toString();
        saveCurrentView();
        window.location.href = url;
    }
}

function selectSecondaryLabel(labelName) {
    console.log('=== selectSecondaryLabel called ===');
    console.log('Label name:', labelName);
    console.log('Current URL:', window.location.href);

    // Filter tasks client-side instead of reloading
    // Select active tasks (task-container) and completed tasks
    const activeTasks = document.querySelectorAll('.task-container');
    const completedTasks = document.querySelectorAll(
        '#completedTasksCollapse .task-card'
    );

    console.log('Active tasks found:', activeTasks.length);
    console.log('Completed tasks found:', completedTasks.length);
    console.log('First active task element:', activeTasks[0]);

    // Filter active tasks
    let visibleActiveCount = 0;
    activeTasks.forEach(task => {
        if (!labelName) {
            task.classList.remove('task-hidden');
            visibleActiveCount++;
        } else {
            // Only check label badges (those with background-color)
            const labels = task.querySelectorAll(
                '.badge[style*="background-color"]'
            );
            let hasLabel = false;
            const labelTexts = [];

            labels.forEach(badge => {
                const labelText = badge.textContent.trim();
                labelTexts.push(labelText);
                if (labelText === labelName) {
                    hasLabel = true;
                }
            });

            console.log('Task labels:', labelTexts, 'Looking for:', labelName, 'Match:', hasLabel);
            if (hasLabel) {
                task.classList.remove('task-hidden');
                visibleActiveCount++;
            } else {
                task.classList.add('task-hidden');
            }
        }
    });

    console.log('Visible active tasks:', visibleActiveCount);

    // Filter completed tasks
    let hasVisibleCompletedTasks = false;
    completedTasks.forEach(task => {
        if (!labelName) {
            task.classList.remove('task-hidden');
            hasVisibleCompletedTasks = true;
        } else {
            // Only check label badges (those with background-color)
            const labels = task.querySelectorAll(
                '.badge[style*="background-color"]'
            );
            let hasLabel = false;
            const labelTexts = [];

            labels.forEach(badge => {
                const labelText = badge.textContent.trim();
                labelTexts.push(labelText);
                if (labelText === labelName) {
                    hasLabel = true;
                }
            });

            console.log('Task labels:', labelTexts, 'Looking for:', labelName, 'Match:', hasLabel);
            if (hasLabel) {
                task.classList.remove('task-hidden');
                hasVisibleCompletedTasks = true;
            } else {
                task.classList.add('task-hidden');
            }
        }
    });

    console.log('Visible completed tasks:', hasVisibleCompletedTasks);

    // Auto-expand completed section if it has matching tasks
    const completedCollapse = document.getElementById(
        'completedTasksCollapse'
    );
    if (completedCollapse && hasVisibleCompletedTasks && labelName) {
        const bsCollapse = bootstrap.Collapse.getInstance(
            completedCollapse
        ) || new bootstrap.Collapse(completedCollapse, {
            toggle: false
        });
        bsCollapse.show();
    }

    // Find the secondary label dropdown button specifically
    const allDropdowns = document.querySelectorAll(
        '.dropdown button[data-bs-toggle="dropdown"]'
    );
    let secondaryDropdownBtn = null;

    allDropdowns.forEach(btn => {
        if (btn.innerHTML.includes('bi-funnel')) {
            secondaryDropdownBtn = btn;
        }
    });

    if (secondaryDropdownBtn) {
        if (labelName) {
            secondaryDropdownBtn.innerHTML =
                `<i class="bi bi-funnel"></i> ${labelName}`;
        } else {
            secondaryDropdownBtn.innerHTML =
                '<i class="bi bi-funnel"></i> All';
        }
    }

    // Update active state in dropdown items
    const dropdownItems = document.querySelectorAll(
        '.dropdown-menu .dropdown-item'
    );
    dropdownItems.forEach(item => {
        const onclick = item.getAttribute('onclick');
        if (onclick && onclick.includes('selectSecondaryLabel')) {
            const match =
                onclick.match(/selectSecondaryLabel\('([^']*)'\)/);
            const itemLabel = match ? match[1] : '';

            if (itemLabel === labelName) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        }
    });
}

function changeOrder(orderBy) {
    const params = new URLSearchParams(window.location.search);
    params.delete('sync');
    if (orderBy) {
        params.set('order', orderBy);
    } else {
        params.delete('order');
    }
    saveCurrentView();
    window.location.href = '?' + params.toString();
}

// Apply secondary label filter on page load if URL parameter exists
document.addEventListener('DOMContentLoaded', function() {
    const params = new URLSearchParams(window.location.search);
    const secondaryLabel = params.get('secondary_label');
    if (secondaryLabel) {
        selectSecondaryLabel(secondaryLabel);
    }
});
