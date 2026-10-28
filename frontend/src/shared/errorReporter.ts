import * as Sentry from '@sentry/react';
import { pushToast } from './toasts';

/**
 * Window-level error reporting, ported from reactive-bible's
 * errorReporter and adapted to the shared toast store. Toasts are
 * a module-level store, so reports queued before React mounts are
 * still rendered when <Toasts/> appears — no flush machinery
 * needed.
 */

// Media elements are excluded: audio/video sources routinely
// fail and are retried by the app's own fallback chains, so
// reporting them would surface expected noise as fatal errors.
const RESOURCE_TAGS = ['IMG', 'SCRIPT', 'LINK'];

// A resource that already reported is not reported again — a
// persistent 404 would otherwise spam one toast/event per retry.
const reportedResources = new Set<string>();

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

/**
 * Surfaces an error to the user and forwards it to Sentry.
 * Fatal errors get a danger toast; transient resource-load
 * failures get a quieter warning one.
 */
export function reportError(
  error: unknown,
  context?: string,
  options: { resource?: boolean; sentryMessage?: string } = {},
): void {
  const err = toError(error);
  try {
    console.error(context ? `[${context}]` : '[Unexpected error]', err);
    // Forward to Sentry — capture* calls are safe no-ops when
    // the SDK was never initialized (no DSN → initSentry
    // skipped). Resource-load failures are not exceptions, so
    // they go as warning-level messages rather than error
    // events: they signal a missing asset, not a crash, and are
    // already deduped per-URL above.
    if (options.resource === true) {
      Sentry.captureMessage(options.sentryMessage ?? err.message, {
        level: 'warning',
        tags: { reportType: 'resource-load' },
      });
      pushToast(`Failed to load a resource: ${err.message}`, 'warning');
    } else {
      Sentry.captureException(err, {
        tags: context ? { context } : undefined,
      });
      pushToast(err.message, 'danger');
    }
  } catch (reportingError) {
    // Never let error reporting itself throw inside a global
    // error handler.
    console.error('Failed to report error:', reportingError);
  }
}

function handleGlobalError(event: Event): void {
  if ('error' in event || 'message' in event) {
    const errorEvent = event as ErrorEvent;
    if (errorEvent.error) {
      reportError(errorEvent.error);
    } else if (errorEvent.message) {
      reportError(new Error(errorEvent.message));
    }
    return;
  }
  // Resource load failures (img/script/link/...) arrive as plain
  // Events with the failing element as target (capture phase).
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!RESOURCE_TAGS.includes(target.tagName)) return;
  const src =
    (target as HTMLImageElement).src ||
    (target as HTMLLinkElement).href ||
    target.tagName.toLowerCase();
  // blob: URLs are short-lived previews minted by
  // URL.createObjectURL — their failures are local and
  // self-evident, never a fatal app error worth reporting.
  if (src.startsWith('blob:')) {
    return;
  }
  // Report each failing resource once — a persistent 404 would
  // otherwise flood notifications on every retry/mount.
  if (reportedResources.has(src)) return;
  reportedResources.add(src);
  // Signed URLs can embed credentials in their query string —
  // strip '?'/'#' and everything after before the URL reaches
  // Sentry. The user toast keeps the full src.
  const sentrySrc = src.split(/[?#]/)[0];
  reportError(
    new Error(`Failed to load resource: ${src}`),
    'Resource load error',
    {
      resource: true,
      sentryMessage: `Failed to load resource: ${sentrySrc}`,
    },
  );
}

function handleUnhandledRejection(event: PromiseRejectionEvent): void {
  // Aborted fetches are routine cancellations (navigation
  // races, superseded requests), not failures. Real aborts are
  // DOMExceptions, which are not Error subclasses — check both.
  if (
    (event.reason instanceof Error || event.reason instanceof DOMException) &&
    event.reason.name === 'AbortError'
  ) {
    return;
  }
  reportError(event.reason, 'Unhandled promise rejection');
}

// Survives module replacement: Vite HMR re-executes main.tsx on
// every edit, and without a window-level marker each reload would
// stack another pair of listeners, duplicating every report.
declare global {
  interface Window {
    __globalErrorCleanup?: () => void;
  }
}

/**
 * Installs window-level handlers for uncaught exceptions,
 * unhandled promise rejections, and resource load failures.
 * Idempotent — a previous installation (e.g. after HMR) is
 * removed first. Returns a cleanup function.
 */
export function initGlobalErrorHandlers(): () => void {
  window.__globalErrorCleanup?.();
  window.addEventListener('error', handleGlobalError, true);
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  const cleanup = () => {
    window.removeEventListener('error', handleGlobalError, true);
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    reportedResources.clear();
    if (window.__globalErrorCleanup === cleanup) {
      delete window.__globalErrorCleanup;
    }
  };
  window.__globalErrorCleanup = cleanup;
  return cleanup;
}
