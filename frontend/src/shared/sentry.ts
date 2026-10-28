import * as Sentry from '@sentry/react';
import type { ErrorEvent, EventHint } from '@sentry/react';

/**
 * Sentry init + `beforeSend` for every SPA entry.
 *
 * dsn/environment/release ship inside the `#spa-bootstrap`
 * json_script rendered by `spa_shell` (django_apps/views.py) — the
 * SPA is server-rendered, so the web DSN arrives at request time
 * and needs no build-time `VITE_*` plumbing. `useBootstrap` is a
 * React hook and cannot run before `createRoot`, so the DOM node
 * is read directly.
 */
interface SentryBootstrap {
  sentry?: {
    dsn?: string | null;
    environment?: string | null;
    release?: string | null;
  };
}

function readBootstrap(): SentryBootstrap {
  const el = document.getElementById('spa-bootstrap');
  if (!el || !el.textContent) return {};
  try {
    return JSON.parse(el.textContent) as SentryBootstrap;
  } catch {
    return {};
  }
}

/**
 * `Sentry.init` — a complete no-op unless a DSN resolves, so
 * tests, `npm run dev`, and pages whose bootstrap carries no DSN
 * send nothing. Call once per entry before `createRoot`.
 */
export function initSentry(): void {
  // VITE_SENTRY_DSN is an override escape hatch (e.g. a page
  // served without the Django-rendered bootstrap).
  const bootstrap = readBootstrap().sentry ?? {};
  const dsn =
    (import.meta.env.VITE_SENTRY_DSN as string | undefined) ||
    bootstrap.dsn ||
    undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: bootstrap.environment || import.meta.env.MODE,
    release: bootstrap.release || undefined,
    integrations: [
      Sentry.browserTracingIntegration(),
      // Free tier ~= 50 replays/mo: record only sessions that hit
      // an error (0 ambient sampling, 1.0 on-error). Text and
      // media are masked — page content is user data.
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // Same-origin only — every SPA API call stays on the host
    // (settings.py also allows the sentry-trace/baggage headers
    // for cross-origin frontends that call this API).
    tracePropagationTargets: [location.origin],
    tracesSampleRate: 0.1,
    beforeSend: sentryBeforeSend,
  });
}

// Generic web noise dropped from the bug queue: stale-tab chunk
// loads after a deploy and benign ResizeObserver complaints. The
// GlobalHandlers onerror path produces message-only events with
// no Error instance, so patterns match the event's text surface.
const DROP_PATTERNS = [
  /ChunkLoadError/,
  /Loading chunk \d+ failed/,
  /Loading CSS chunk/,
  /ResizeObserver loop/,
];

// Browser TypeErrors for failed fetches: Chrome "Failed to
// fetch", Firefox "NetworkError when attempting to fetch
// resource.", Safari "Load failed". Availability signals, not
// bugs — tagged, never dropped.
const NETWORK_FAILURE =
  /Failed to fetch|NetworkError|Load failed|Network request failed/i;

function eventText(event: ErrorEvent, err: unknown): string {
  // GlobalHandlers' onerror path produces message-only events
  // with no Error instance, so match every text surface: the
  // event message, the first exception's type + value, and the
  // original exception's own name + message (e.g. a real
  // ChunkLoadError Error object).
  const first = event.exception?.values?.[0];
  const errText =
    err instanceof Error || err instanceof DOMException
      ? `${err.name} ${err.message}`
      : '';
  return (
    `${event.message ?? ''} ${first?.type ?? ''} ` +
    `${first?.value ?? ''} ${errText}`
  );
}

/**
 * `beforeSend` filter for `Sentry.init`. Drops routine noise so
 * expected conditions do not burn event quota:
 *
 * - AbortError: fetch cancellation (navigation races, superseded
 *   requests) — filtered upstream in errorReporter too, kept
 *   here as belt-and-suspenders.
 * - Chunk-load / ResizeObserver noise (see DROP_PATTERNS).
 *
 * TypeError network failures are tagged `errorKind:network`
 * instead of dropped — a real availability signal worth
 * trending separately from bugs.
 */
export function sentryBeforeSend(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  const err = hint.originalException;
  // Real aborts surface as DOMExceptions, which are not Error
  // subclasses — check both.
  if (
    (err instanceof Error || err instanceof DOMException) &&
    err.name === 'AbortError'
  ) {
    return null;
  }
  const text = eventText(event, err);
  if (DROP_PATTERNS.some((pattern) => pattern.test(text))) {
    return null;
  }
  const firstException = event.exception?.values?.[0];
  if (
    firstException?.type === 'TypeError' &&
    NETWORK_FAILURE.test(firstException.value ?? '')
  ) {
    event.tags = { ...event.tags, errorKind: 'network' };
  }
  // Sentry's GlobalHandlers integration captures unhandled
  // rejections before this app's tagged captureException —
  // which Dedupe then drops, taking the `context` tag with it.
  // Re-apply the tag on the surviving event.
  const mechanism = firstException?.mechanism?.type;
  if (
    mechanism === 'onunhandledrejection' &&
    event.tags?.context === undefined
  ) {
    event.tags = {
      ...event.tags,
      context: 'Unhandled promise rejection',
    };
  }
  return event;
}
