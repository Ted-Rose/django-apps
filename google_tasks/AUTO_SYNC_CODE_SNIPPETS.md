# Auto-Sync Code Snippets

**Ready-to-use code for implementing automatic task synchronization**

---

## Phase 1: MVP Implementation

### 1. Basic Auto-Sync JavaScript

Add this to `google_tasks/templates/google_tasks/dashboard.html` in the
`<script>` section (around line 700, before the closing `</script>` tag):

```javascript
// ============================================================
// AUTO-SYNC FUNCTIONALITY
// ============================================================

// Configuration
const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
let autoSyncTimer = null;

/**
 * Perform automatic background sync
 */
async function performAutoSync() {
    console.log('[Auto-Sync] Starting sync at', new Date().toLocaleTimeString());
    
    try {
        const response = await fetch('{% url "google_tasks:sync" %}', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('[Auto-Sync] ✓ Sync successful:', data.message);
            // Reload page to show updated tasks
            window.location.reload();
        } else if (data.redirect_to_auth) {
            console.warn('[Auto-Sync] ⚠ Auth required, stopping sync');
            stopAutoSync();
        } else {
            console.error('[Auto-Sync] ✗ Sync failed:', data.error);
        }
    } catch (error) {
        console.error('[Auto-Sync] ✗ Network error:', error);
        // Don't stop sync on network errors - retry next interval
    }
}

/**
 * Start automatic sync
 */
function startAutoSync() {
    if (autoSyncTimer) {
        console.log('[Auto-Sync] Already running');
        return;
    }
    
    console.log('[Auto-Sync] Starting (interval: 5 minutes)');
    autoSyncTimer = setInterval(performAutoSync, AUTO_SYNC_INTERVAL);
}

/**
 * Stop automatic sync
 */
function stopAutoSync() {
    if (autoSyncTimer) {
        console.log('[Auto-Sync] Stopping');
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }
}

/**
 * Initialize on page load
 */
document.addEventListener('DOMContentLoaded', function() {
    {% if has_credentials %}
        startAutoSync();
        console.log('[Auto-Sync] ✓ Enabled');
    {% else %}
        console.log('[Auto-Sync] ✗ Disabled (no credentials)');
    {% endif %}
});

/**
 * Clean up on page unload
 */
window.addEventListener('beforeunload', function() {
    stopAutoSync();
});
```

**That's it for MVP!** This is all you need for basic auto-sync.

---

## Phase 2: Enhanced Features

### 2. Visual Sync Indicator

Add this HTML to the navbar (around line 126):

```html
<!-- Add inside navbar, before burger menu -->
<div id="sync-status" class="text-light small me-3" style="display: none;">
    <i class="bi bi-arrow-repeat" id="sync-icon"></i>
    <span id="sync-text">Auto-sync active</span>
</div>
```

Add this CSS to the `<style>` section:

```css
/* Auto-sync status indicator */
#sync-status {
    font-size: 0.85rem;
    opacity: 0.8;
}

#sync-status.syncing {
    opacity: 1;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.spin {
    animation: spin 1s linear infinite;
}
```

Update the JavaScript:

```javascript
/**
 * Update sync status indicator
 */
function updateSyncStatus(status, text) {
    const statusEl = document.getElementById('sync-status');
    const iconEl = document.getElementById('sync-icon');
    const textEl = document.getElementById('sync-text');
    
    if (!statusEl) return;
    
    statusEl.style.display = 'block';
    
    if (status === 'syncing') {
        iconEl.classList.add('spin');
        statusEl.classList.add('syncing');
        textEl.textContent = text || 'Syncing...';
    } else if (status === 'active') {
        iconEl.classList.remove('spin');
        statusEl.classList.remove('syncing');
        textEl.textContent = text || 'Auto-sync active';
    } else if (status === 'error') {
        iconEl.classList.remove('spin');
        statusEl.classList.remove('syncing');
        textEl.textContent = text || 'Sync error';
        statusEl.classList.add('text-warning');
    }
}

// Update performAutoSync to use status indicator:
async function performAutoSync() {
    console.log('[Auto-Sync] Starting sync');
    updateSyncStatus('syncing', 'Syncing...');
    
    try {
        const response = await fetch('{% url "google_tasks:sync" %}', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('[Auto-Sync] ✓ Success');
            updateSyncStatus('active', 'Synced');
            setTimeout(() => window.location.reload(), 500);
        } else if (data.redirect_to_auth) {
            console.warn('[Auto-Sync] ⚠ Auth required');
            updateSyncStatus('error', 'Auth required');
            stopAutoSync();
        } else {
            console.error('[Auto-Sync] ✗ Failed');
            updateSyncStatus('error', 'Sync failed');
        }
    } catch (error) {
        console.error('[Auto-Sync] ✗ Network error');
        updateSyncStatus('active', 'Network error');
    }
}

// Update startAutoSync:
function startAutoSync() {
    if (autoSyncTimer) return;
    
    console.log('[Auto-Sync] Starting');
    autoSyncTimer = setInterval(performAutoSync, AUTO_SYNC_INTERVAL);
    updateSyncStatus('active', 'Auto-sync active');
}
```

### 3. Toast Notifications

Add this function:

```javascript
/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type} alert-dismissible fade show`;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9999;
        min-width: 250px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
    `;
    
    toast.innerHTML = `
        ${message}
        <button type="button" class="btn-close" 
                data-bs-dismiss="alert"></button>
    `;
    
    document.body.appendChild(toast);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 150);
    }, 5000);
}

// Use in performAutoSync:
if (data.success) {
    showToast('Tasks synced successfully', 'success');
    // ...
} else if (data.redirect_to_auth) {
    showToast('Session expired. Please re-authenticate.', 'warning');
    // ...
}
```

### 4. User Toggle Control

Add to burger menu items in `views.py`:

```python
burger_menu_items = [
    {'label': 'Home', 'url': '/', 'icon': 'house',
     'btn_class': 'btn-outline-light'},
    {'label': 'Toggle Auto-Sync', 'onclick': 'toggleAutoSync()',
     'icon': 'arrow-repeat', 'btn_class': 'btn-info',
     'id': 'auto-sync-toggle'},
    {'label': 'Process Labels', 'onclick': 'processLabels()',
     'icon': 'tags', 'btn_class': 'btn-success'},
    {'label': 'Sync Now', 'url': '?sync=true',
     'icon': 'arrow-repeat', 'btn_class': 'btn-light'},
]
```

Add JavaScript:

```javascript
/**
 * Toggle auto-sync on/off
 */
function toggleAutoSync() {
    if (autoSyncTimer) {
        stopAutoSync();
        showToast('Auto-sync disabled', 'info');
        updateSyncStatus('active', 'Auto-sync off');
        localStorage.setItem('autoSyncEnabled', 'false');
    } else {
        startAutoSync();
        showToast('Auto-sync enabled', 'success');
        updateSyncStatus('active', 'Auto-sync active');
        localStorage.setItem('autoSyncEnabled', 'true');
    }
}

// Update initialization to respect user preference:
document.addEventListener('DOMContentLoaded', function() {
    {% if has_credentials %}
        const enabled = localStorage.getItem('autoSyncEnabled');
        if (enabled !== 'false') {  // Default to enabled
            startAutoSync();
        } else {
            console.log('[Auto-Sync] Disabled by user preference');
        }
    {% endif %}
});
```

### 5. Page Visibility Handling

Add this to handle background tabs:

```javascript
let lastSyncTime = Date.now();

/**
 * Handle page visibility changes
 */
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        console.log('[Auto-Sync] Page hidden');
    } else {
        console.log('[Auto-Sync] Page visible');
        
        // Sync immediately if page was hidden for >5 minutes
        const timeSinceLastSync = Date.now() - lastSyncTime;
        if (timeSinceLastSync > AUTO_SYNC_INTERVAL) {
            console.log('[Auto-Sync] Syncing after long absence');
            performAutoSync();
        }
    }
});

// Update performAutoSync to track last sync time:
async function performAutoSync() {
    lastSyncTime = Date.now();
    // ... rest of function
}
```

---

## Phase 3: Optimizations

### 6. Rate Limiting (Backend)

Add to `views.py`:

```python
from django.core.cache import cache
from django.http import HttpResponseTooManyRequests

@login_required
def sync_view(request):
    """Manual sync endpoint with rate limiting."""
    # Rate limiting: max 20 syncs per hour per user
    cache_key = f'sync_rate_limit_{request.user.id}'
    sync_count = cache.get(cache_key, 0)
    
    if sync_count >= 20:
        return JsonResponse({
            'success': False,
            'error': 'Too many sync requests. Please try again later.'
        }, status=429)
    
    cache.set(cache_key, sync_count + 1, 3600)  # 1 hour TTL
    
    # ... existing sync logic ...
```

### 7. Smart Sync (No Reload if No Changes)

Backend - add Last-Modified header:

```python
from django.db.models import Max

@login_required
def sync_view(request):
    # ... existing sync logic ...
    
    # Get latest update time
    last_modified = GoogleTaskList.objects.filter(
        user=request.user
    ).aggregate(Max('updated'))['updated__max']
    
    response = JsonResponse({
        'success': True,
        'message': 'Synced successfully'
    })
    
    if last_modified:
        response['Last-Modified'] = last_modified.strftime(
            '%a, %d %b %Y %H:%M:%S GMT'
        )
    
    return response
```

Frontend - check for changes:

```javascript
let lastModified = null;

async function performAutoSync() {
    const headers = {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCookie('csrftoken')
    };
    
    if (lastModified) {
        headers['If-Modified-Since'] = lastModified;
    }
    
    const response = await fetch('{% url "google_tasks:sync" %}', {
        method: 'POST',
        headers: headers
    });
    
    if (response.status === 304) {
        console.log('[Auto-Sync] No changes detected');
        return; // Don't reload
    }
    
    const newLastModified = response.headers.get('Last-Modified');
    if (newLastModified) {
        lastModified = newLastModified;
    }
    
    const data = await response.json();
    
    if (data.success) {
        console.log('[Auto-Sync] Changes detected, reloading');
        window.location.reload();
    }
}
```

### 8. Exponential Backoff on Errors

```javascript
let syncFailureCount = 0;
const MAX_FAILURES = 3;
const BASE_INTERVAL = 5 * 60 * 1000; // 5 minutes

async function performAutoSyncWithBackoff() {
    try {
        await performAutoSync();
        syncFailureCount = 0; // Reset on success
        
        // Reset to normal interval
        if (autoSyncTimer) {
            clearInterval(autoSyncTimer);
            autoSyncTimer = setInterval(
                performAutoSyncWithBackoff,
                BASE_INTERVAL
            );
        }
    } catch (error) {
        syncFailureCount++;
        console.error(
            `[Auto-Sync] Failure ${syncFailureCount}/${MAX_FAILURES}`
        );
        
        if (syncFailureCount >= MAX_FAILURES) {
            console.error('[Auto-Sync] Too many failures, stopping');
            stopAutoSync();
            showToast('Auto-sync stopped due to errors', 'danger');
        } else {
            // Exponential backoff: 5min, 10min, 20min
            const backoffInterval = BASE_INTERVAL * Math.pow(2, syncFailureCount - 1);
            console.log(
                `[Auto-Sync] Retrying in ${backoffInterval / 60000} minutes`
            );
            
            clearInterval(autoSyncTimer);
            autoSyncTimer = setInterval(
                performAutoSyncWithBackoff,
                backoffInterval
            );
        }
    }
}

// Use this instead of performAutoSync in setInterval:
function startAutoSync() {
    if (autoSyncTimer) return;
    
    console.log('[Auto-Sync] Starting');
    autoSyncTimer = setInterval(
        performAutoSyncWithBackoff,
        BASE_INTERVAL
    );
}
```

---

## Testing Snippets

### Manual Test in Browser Console

```javascript
// Test sync manually
performAutoSync();

// Check if auto-sync is running
console.log('Auto-sync active:', autoSyncTimer !== null);

// Stop auto-sync
stopAutoSync();

// Start auto-sync
startAutoSync();

// Trigger immediate sync
performAutoSync();
```

### Django Test Cases

Create `google_tasks/tests/test_auto_sync.py`:

```python
from django.test import TestCase, Client
from django.contrib.auth.models import User
from django.urls import reverse

class AutoSyncTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(
            'testuser',
            'test@example.com',
            'testpass123'
        )
        self.client.login(username='testuser', password='testpass123')
    
    def test_sync_endpoint_requires_auth(self):
        """Test that sync endpoint requires authentication"""
        client = Client()  # Not logged in
        response = client.post(reverse('google_tasks:sync'))
        self.assertEqual(response.status_code, 302)  # Redirect
    
    def test_sync_endpoint_returns_json(self):
        """Test that sync endpoint returns JSON"""
        response = self.client.post(reverse('google_tasks:sync'))
        self.assertEqual(
            response['Content-Type'],
            'application/json'
        )
    
    def test_sync_rate_limiting(self):
        """Test that rate limiting works"""
        # Make 21 requests (limit is 20)
        for i in range(21):
            response = self.client.post(reverse('google_tasks:sync'))
        
        # Last request should be rate limited
        self.assertEqual(response.status_code, 429)
```

Run tests:

```bash
python manage.py test google_tasks.tests.test_auto_sync
```

---

## Debugging Snippets

### Enable Verbose Logging

Add to JavaScript:

```javascript
const DEBUG_AUTO_SYNC = true;

function debugLog(...args) {
    if (DEBUG_AUTO_SYNC) {
        console.log('[Auto-Sync Debug]', ...args);
    }
}

// Use throughout code:
debugLog('Timer started at', new Date());
debugLog('Sync response:', data);
```

### Monitor Sync Activity

Add to JavaScript:

```javascript
// Track sync statistics
const syncStats = {
    totalSyncs: 0,
    successfulSyncs: 0,
    failedSyncs: 0,
    lastSyncTime: null,
    averageDuration: 0
};

async function performAutoSync() {
    const startTime = Date.now();
    syncStats.totalSyncs++;
    
    try {
        // ... sync logic ...
        
        if (data.success) {
            syncStats.successfulSyncs++;
        } else {
            syncStats.failedSyncs++;
        }
    } catch (error) {
        syncStats.failedSyncs++;
    } finally {
        const duration = Date.now() - startTime;
        syncStats.lastSyncTime = new Date();
        syncStats.averageDuration = 
            (syncStats.averageDuration * (syncStats.totalSyncs - 1) + duration)
            / syncStats.totalSyncs;
        
        console.log('[Auto-Sync Stats]', syncStats);
    }
}

// View stats in console:
// > syncStats
```

---

## Configuration Snippets

### Django Settings

Add to `settings.py`:

```python
# Google Tasks Auto-Sync Configuration
GOOGLE_TASKS_AUTO_SYNC_ENABLED = env.bool(
    'GOOGLE_TASKS_AUTO_SYNC_ENABLED',
    default=True
)
GOOGLE_TASKS_AUTO_SYNC_INTERVAL = env.int(
    'GOOGLE_TASKS_AUTO_SYNC_INTERVAL',
    default=5 * 60  # 5 minutes in seconds
)
GOOGLE_TASKS_SYNC_RATE_LIMIT = env.int(
    'GOOGLE_TASKS_SYNC_RATE_LIMIT',
    default=20  # Max syncs per hour per user
)
```

Use in template:

```html
<script>
const AUTO_SYNC_ENABLED = {{ settings.GOOGLE_TASKS_AUTO_SYNC_ENABLED|lower }};
const AUTO_SYNC_INTERVAL = {{ settings.GOOGLE_TASKS_AUTO_SYNC_INTERVAL }} * 1000;

if (AUTO_SYNC_ENABLED) {
    startAutoSync();
}
</script>
```

### Environment Variables

Add to `.env`:

```bash
# Auto-sync configuration
GOOGLE_TASKS_AUTO_SYNC_ENABLED=true
GOOGLE_TASKS_AUTO_SYNC_INTERVAL=300  # 5 minutes
GOOGLE_TASKS_SYNC_RATE_LIMIT=20
```

---

## Quick Copy-Paste: Complete MVP

Here's everything you need for a working MVP in one block:

```javascript
// Add this entire block to dashboard.html <script> section

// ============================================================
// AUTO-SYNC - Complete MVP Implementation
// ============================================================

const AUTO_SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes
let autoSyncTimer = null;

async function performAutoSync() {
    console.log('[Auto-Sync] Syncing...', new Date().toLocaleTimeString());
    
    try {
        const response = await fetch('{% url "google_tasks:sync" %}', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCookie('csrftoken')
            }
        });
        
        const data = await response.json();
        
        if (data.success) {
            console.log('[Auto-Sync] ✓ Success');
            window.location.reload();
        } else if (data.redirect_to_auth) {
            console.warn('[Auto-Sync] ⚠ Auth required');
            stopAutoSync();
        } else {
            console.error('[Auto-Sync] ✗ Failed:', data.error);
        }
    } catch (error) {
        console.error('[Auto-Sync] ✗ Error:', error);
    }
}

function startAutoSync() {
    if (!autoSyncTimer) {
        console.log('[Auto-Sync] Starting (every 5 min)');
        autoSyncTimer = setInterval(performAutoSync, AUTO_SYNC_INTERVAL);
    }
}

function stopAutoSync() {
    if (autoSyncTimer) {
        console.log('[Auto-Sync] Stopping');
        clearInterval(autoSyncTimer);
        autoSyncTimer = null;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    {% if has_credentials %}
        startAutoSync();
    {% endif %}
});

window.addEventListener('beforeunload', stopAutoSync);

// ============================================================
// End AUTO-SYNC
// ============================================================
```

**That's it!** Copy-paste this block and auto-sync will work.

---

**Last Updated:** 2026-08-12  
**Related:** AUTO_SYNC_IMPLEMENTATION_PLAN.md
