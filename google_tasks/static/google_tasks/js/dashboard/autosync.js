/**
 * Automatic background sync and manual label processing.
 */

function processLabels() {
    const csrftoken = getCookie('csrftoken');
    const button = event.target.closest('button');
    const originalText = button.innerHTML;
    button.disabled = true;
    button.innerHTML =
        '<i class="bi bi-hourglass-split"></i> Processing...';

    fetch('/tasks/process-labels/', {
        method: 'POST',
        headers: {
            'X-CSRFToken': csrftoken,
            'Content-Type': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        button.disabled = false;
        button.innerHTML = originalText;

        if (data.success) {
            const stats = data.stats;
            alert(
                `Label Processing Complete!\n\n` +
                `Processed: ${stats.processed} tasks\n` +
                `Moved: ${stats.moved} tasks\n` +
                `Starred: ${stats.starred} tasks\n` +
                `Errors: ${stats.errors} tasks\n\n` +
                `Reloading page...`
            );
            location.reload();
        } else if (data.reauth_required) {
            window.location.href = data.authorization_url;
        } else {
            alert(
                'Error processing labels: ' +
                (data.error || 'Unknown error')
            );
        }
    })
    .catch(error => {
        button.disabled = false;
        button.innerHTML = originalText;
        console.error('Error:', error);
        alert('An error occurred while processing labels');
    });
}

// Auto-Sync Configuration
const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
let autoSyncTimer = null;
let lastSyncTime = Date.now();

/**
 * Perform automatic background sync with label processing
 */
async function performAutoSync(isInitialLoad = false) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(
        `[Auto-Sync] ${isInitialLoad ? 'Initial' : 'Periodic'} ` +
        `sync at ${timestamp}`
    );

    try {
        // Step 1: Sync tasks from Google Tasks API
        const syncResponse = await fetch(
            DASHBOARD_CONFIG.urls.sync,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCookie('csrftoken')
                }
            }
        );

        const syncData = await syncResponse.json();

        if (syncData.success) {
            console.log('[Auto-Sync] ✓ Tasks synced successfully');
            lastSyncTime = Date.now();

            // Step 2: Process labels (hashtags) automatically
            console.log(
                '[Auto-Sync] Processing labels from hashtags...'
            );
            try {
                const labelResponse = await fetch(
                    DASHBOARD_CONFIG.urls.processLabels,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRFToken': getCookie('csrftoken')
                        }
                    }
                );

                const labelData = await labelResponse.json();

                if (labelData.success && labelData.stats) {
                    const stats = labelData.stats;
                    console.log(
                        `[Auto-Sync] ✓ Labels processed: ` +
                        `${stats.processed} tasks, ` +
                        `${stats.moved} moved, ` +
                        `${stats.starred} starred`
                    );
                } else {
                    console.log('[Auto-Sync] ℹ No labels to process');
                }
            } catch (labelError) {
                console.warn(
                    '[Auto-Sync] ⚠ Label processing failed ' +
                    '(non-critical):',
                    labelError
                );
                // Continue anyway - label processing is optional
            }

            // Step 3: Reload page to show updated tasks
            console.log('[Auto-Sync] Reloading page...');
            window.location.reload();

        } else if (
            syncData.redirect_to_auth ||
            syncData.reauth_required
        ) {
            console.warn(
                '[Auto-Sync] ⚠ Authentication required, ' +
                'stopping auto-sync'
            );
            stopAutoSync();
            // Optionally show user notification
            if (typeof showToast === 'function') {
                showToast(
                    'Session expired. Please click "Sync Now" ' +
                    'to re-authenticate.',
                    'warning'
                );
            }
        } else {
            console.error(
                '[Auto-Sync] ✗ Sync failed:',
                syncData.error
            );
        }
    } catch (error) {
        console.error('[Auto-Sync] ✗ Network error:', error);
        // Don't stop auto-sync on network errors - will retry
    }
}

/**
 * Start automatic sync timer
 */
function startAutoSync() {
    if (autoSyncTimer) {
        console.log('[Auto-Sync] Already running');
        return;
    }

    console.log(
        '[Auto-Sync] Starting periodic sync (every 5 minutes)'
    );
    autoSyncTimer = setInterval(
        () => performAutoSync(false),
        AUTO_SYNC_INTERVAL
    );
}

/**
 * Stop automatic sync timer
 */
function stopAutoSync() {
    if (autoSyncTimer) {
        console.log('[Auto-Sync] Stopping periodic sync');
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }
}

/**
 * Check if data is stale and needs immediate sync
 */
function checkAndSyncIfStale() {
    const lastPageLoad = localStorage.getItem('lastPageLoad');
    const now = Date.now();

    if (lastPageLoad) {
        const timeSinceLastLoad = now - parseInt(lastPageLoad);

        // If page was closed for more than 5 minutes, sync
        if (timeSinceLastLoad > STALE_THRESHOLD) {
            const minutes = Math.floor(timeSinceLastLoad / 60000);
            console.log(
                `[Auto-Sync] Page was closed for ${minutes} ` +
                `minutes, syncing now`
            );
            performAutoSync(true);
        } else {
            console.log(
                '[Auto-Sync] Data is fresh, skipping initial sync'
            );
        }
    } else {
        // First time loading - sync immediately
        console.log('[Auto-Sync] First page load, syncing now');
        performAutoSync(true);
    }

    // Store current time for next page load
    localStorage.setItem('lastPageLoad', now.toString());
}
