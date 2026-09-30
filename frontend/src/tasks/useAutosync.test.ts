import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  AUTO_SYNC_INTERVAL,
  STALE_THRESHOLD,
  useAutosync,
} from './useAutosync';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => hidden,
  });
}

describe('useAutosync (autosync.js port)', () => {
  it('does nothing without credentials', () => {
    const sync = vi.fn();
    renderHook(() => useAutosync(false, sync));
    vi.advanceTimersByTime(AUTO_SYNC_INTERVAL * 3);
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs immediately on a first load (no lastPageLoad)', () => {
    const sync = vi.fn();
    renderHook(() => useAutosync(true, sync));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('lastPageLoad')).not.toBeNull();
  });

  it('skips the initial sync when lastPageLoad is fresh', () => {
    localStorage.setItem('lastPageLoad', String(Date.now()));
    const sync = vi.fn();
    renderHook(() => useAutosync(true, sync));
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs on load when lastPageLoad is older than the stale threshold', () => {
    localStorage.setItem(
      'lastPageLoad',
      String(Date.now() - STALE_THRESHOLD - 1000),
    );
    const sync = vi.fn();
    renderHook(() => useAutosync(true, sync));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('syncs every 5 minutes while visible and online', () => {
    localStorage.setItem('lastPageLoad', String(Date.now()));
    const sync = vi.fn();
    renderHook(() => useAutosync(true, sync));
    vi.advanceTimersByTime(AUTO_SYNC_INTERVAL * 2 + 1000);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('stops when the component unmounts', () => {
    localStorage.setItem('lastPageLoad', String(Date.now()));
    const sync = vi.fn();
    const { unmount } = renderHook(() => useAutosync(true, sync));
    unmount();
    vi.advanceTimersByTime(AUTO_SYNC_INTERVAL * 2);
    expect(sync).not.toHaveBeenCalled();
  });

  it('skips ticks while the tab is hidden, then catches up on return', () => {
    localStorage.setItem('lastPageLoad', String(Date.now()));
    const sync = vi.fn();
    renderHook(() => useAutosync(true, sync));

    // Hidden for >5min: interval ticks are skipped.
    setHidden(true);
    vi.advanceTimersByTime(AUTO_SYNC_INTERVAL + 1000);
    expect(sync).not.toHaveBeenCalled();

    // Back visible after the absence → catch-up sync fires.
    setHidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('skips ticks while offline', () => {
    localStorage.setItem('lastPageLoad', String(Date.now()));
    const sync = vi.fn();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    });
    renderHook(() => useAutosync(true, sync));
    vi.advanceTimersByTime(AUTO_SYNC_INTERVAL + 1000);
    expect(sync).not.toHaveBeenCalled();
    // Restore for following tests.
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    });
  });
});
