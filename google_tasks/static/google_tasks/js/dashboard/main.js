/**
 * Dashboard initialization: completed-tasks chevron, view restore,
 * undo/redo wiring, keyboard shortcuts, auto-sync lifecycle.
 */

const completedCollapse = document.getElementById('completedTasksCollapse');
if (completedCollapse) {
    completedCollapse.addEventListener('show.bs.collapse', () => {
        document.getElementById('completedChevron').classList.replace(
            'bi-chevron-right', 'bi-chevron-down'
        );
    });
    completedCollapse.addEventListener('hide.bs.collapse', () => {
        document.getElementById('completedChevron').classList.replace(
            'bi-chevron-down', 'bi-chevron-right'
        );
    });
}

/**
 * Handle page visibility changes (tab switching)
 * Sync when returning to tab if been away for >5 minutes
 */
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && autoSyncTimer) {
        const timeSinceLastSync = Date.now() - lastSyncTime;
        if (timeSinceLastSync > AUTO_SYNC_INTERVAL) {
            console.log(
                '[Auto-Sync] Tab visible after long absence, ' +
                'syncing now'
            );
            performAutoSync(false);
        }
    }
});

/**
 * Clean up on page unload
 */
window.addEventListener('beforeunload', function() {
    stopAutoSync();
});

document.addEventListener('DOMContentLoaded', function() {
    // Restore last view if visiting without parameters AND
    // coming from search page
    const currentPath = window.location.pathname;
    const currentSearch = window.location.search;
    const isDefaultView = (
        currentPath === DASHBOARD_CONFIG.urls.dashboard &&
        !currentSearch
    );

    if (isDefaultView) {
        try {
            const lastView = localStorage.getItem('lastTasksView');
            const referrer = document.referrer;

            // Check if coming from search page
            const isFromSearch = referrer &&
                referrer.includes('/search');

            // Only redirect if:
            // 1. There's a saved view
            // 2. It's different from current path
            // 3. User is coming from search page
            if (lastView &&
                lastView !== currentPath &&
                isFromSearch) {
                // Redirect to last view
                window.location.href = lastView;
                return;
            }
        } catch (e) {
            console.warn('Failed to restore view:', e);
        }
    }

    // Save current view to localStorage
    saveCurrentView();

    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    if (undoBtn) {
        undoBtn.addEventListener('click', performUndo);
    }

    if (redoBtn) {
        redoBtn.addEventListener('click', performRedo);
    }

    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
            e.preventDefault();
            performUndo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
            e.preventDefault();
            performRedo();
        }
    });

    // Initialize auto-sync on page load
    if (DASHBOARD_CONFIG.flags && DASHBOARD_CONFIG.flags.has_credentials) {
        console.log('[Auto-Sync] ✓ Initializing auto-sync');

        // Check if we need immediate sync (stale data)
        checkAndSyncIfStale();

        // Start periodic sync timer
        startAutoSync();

    } else {
        console.log('[Auto-Sync] ✗ Disabled (no credentials)');
    }
});
