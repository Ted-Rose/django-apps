/**
 * Auto-sync — port of js/dashboard/autosync.js (+ the
 * visibilitychange/beforeunload wiring in main.js).
 *
 * Old behavior:
 * - Only starts when the dashboard config says has_credentials.
 * - On load, syncs immediately when `lastPageLoad` is absent or older
 *   than 5 minutes (stale), then stamps lastPageLoad.
 * - Every 5 minutes: POST sync (which also runs server-side label
 *   processing via views.sync_view) then reload. Here the TanStack
 *   `useSync` mutation replaces POST+reload — it invalidates the
 *   dashboard queries on settle.
 * - Returning to a tab idle for >5 minutes triggers a catch-up sync.
 *
 * Deviation: the old interval fired while the tab was hidden or
 * offline (browsers throttle, the fetch then failed and retried next
 * tick). The hook skips the call explicitly in those states — the
 * visibility catch-up resyncs on return either way.
 */
import { useEffect, useRef } from 'react';

export const AUTO_SYNC_INTERVAL = 5 * 60 * 1000;
export const STALE_THRESHOLD = 5 * 60 * 1000;
const LAST_PAGE_LOAD_KEY = 'lastPageLoad';

/**
 * @param enabled  flags.has_credentials — autosync only runs when the
 *                 user can actually sync (autosync.js/main.js gate).
 * @param sync     a stable trigger for the sync mutation — pass
 *                 `useSync().mutate` (React Query mutates are stable).
 */
export function useAutosync(enabled: boolean, sync: () => void): void {
  const syncRef = useRef(sync);
  const lastSyncRef = useRef(0);

  // Keep the latest mutate fn without resubscribing the timer.
  useEffect(() => {
    syncRef.current = sync;
  }, [sync]);

  useEffect(() => {
    if (!enabled) return;

    lastSyncRef.current = Date.now();

    const doSync = () => {
      // Skip while hidden/offline — the old loop still fired (browser
      // timer throttling made it unreliable); the visibility handler
      // catches up when the tab returns.
      if (document.hidden || !navigator.onLine) return;
      lastSyncRef.current = Date.now();
      syncRef.current();
    };

    // checkAndSyncIfStale(): first load or >5min away → sync now.
    let stale = true;
    try {
      const lastPageLoad = Number(localStorage.getItem(LAST_PAGE_LOAD_KEY));
      stale = !lastPageLoad || Date.now() - lastPageLoad > STALE_THRESHOLD;
      localStorage.setItem(LAST_PAGE_LOAD_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — skip the stamp, still treat as stale.
    }
    if (stale) doSync();

    const timer = setInterval(doSync, AUTO_SYNC_INTERVAL);

    // main.js visibilitychange: sync when returning after >interval.
    const onVisibilityChange = () => {
      if (
        !document.hidden &&
        Date.now() - lastSyncRef.current > AUTO_SYNC_INTERVAL
      ) {
        doSync();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [enabled]);
}

export default useAutosync;
