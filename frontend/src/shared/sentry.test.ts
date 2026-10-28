import { describe, expect, it } from 'vitest';
import type { ErrorEvent, EventHint } from '@sentry/react';
import { sentryBeforeSend } from './sentry';

const event = { event_id: 'test-event' } as ErrorEvent;
const hintOf = (err: unknown): EventHint => ({
  originalException: err,
});

describe('sentryBeforeSend', () => {
  it('passes unexpected errors through', () => {
    const result = sentryBeforeSend(event, hintOf(new Error('boom')));
    expect(result).toBe(event);
  });

  it('passes non-Error rejections through', () => {
    expect(sentryBeforeSend(event, hintOf('plain failure'))).toBe(event);
  });

  it('drops AbortError (routine fetch cancellation)', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    expect(sentryBeforeSend(event, hintOf(err))).toBeNull();
  });

  it('drops DOMException AbortError (real fetch aborts)', () => {
    // fetch aborts reject with a DOMException, not an Error.
    const err = new DOMException('aborted', 'AbortError');
    expect(sentryBeforeSend(event, hintOf(err))).toBeNull();
  });

  it('drops ChunkLoadError (stale tab after deploy)', () => {
    const err = new Error('Loading chunk 42 failed');
    err.name = 'ChunkLoadError';
    expect(sentryBeforeSend(event, hintOf(err))).toBeNull();
  });

  it('drops message-only chunk-load events (onerror path)', () => {
    // GlobalHandlers' onerror path produces a message-only event
    // with no Error instance — the pattern must match
    // event.message too.
    const messageEvent: ErrorEvent = {
      ...event,
      message: 'Loading CSS chunk 7 failed',
    };
    expect(sentryBeforeSend(messageEvent, hintOf(undefined))).toBeNull();
  });

  it('drops chunk-load text in exception.values', () => {
    const exceptionEvent: ErrorEvent = {
      ...event,
      exception: {
        values: [{ type: 'Error', value: 'Loading chunk 3 failed' }],
      },
    };
    expect(sentryBeforeSend(exceptionEvent, hintOf(undefined))).toBeNull();
  });

  it('drops ResizeObserver loop noise', () => {
    const loopEvent: ErrorEvent = {
      ...event,
      message: 'ResizeObserver loop limit exceeded',
    };
    expect(sentryBeforeSend(loopEvent, hintOf(undefined))).toBeNull();
  });

  it('tags TypeError network failures instead of dropping', () => {
    const networkEvent: ErrorEvent = {
      ...event,
      exception: {
        values: [{ type: 'TypeError', value: 'Failed to fetch' }],
      },
    };
    const result = sentryBeforeSend(
      networkEvent,
      hintOf(new TypeError('Failed to fetch')),
    );
    expect(result?.tags?.errorKind).toBe('network');
  });

  it('tags Firefox/Safari network failure phrasings too', () => {
    for (const value of [
      'NetworkError when attempting to fetch resource.',
      'Load failed',
    ]) {
      const networkEvent: ErrorEvent = {
        ...event,
        exception: { values: [{ type: 'TypeError', value }] },
      };
      const result = sentryBeforeSend(
        networkEvent,
        hintOf(new TypeError(value)),
      );
      expect(result?.tags?.errorKind).toBe('network');
    }
  });

  it('does not tag non-network TypeErrors', () => {
    const typeEvent: ErrorEvent = {
      ...event,
      exception: {
        values: [{ type: 'TypeError', value: 'x is not a function' }],
      },
    };
    const result = sentryBeforeSend(
      typeEvent,
      hintOf(new TypeError('x is not a function')),
    );
    expect(result?.tags?.errorKind).toBeUndefined();
  });

  it('tags GlobalHandlers-captured rejections with context', () => {
    // GlobalHandlers captures first and wins dedupe, so the
    // surviving event lacks the context tag the app's own
    // captureException carried.
    const rejectionEvent: ErrorEvent = {
      ...event,
      exception: {
        values: [{ mechanism: { type: 'onunhandledrejection' } }],
      },
    };

    const result = sentryBeforeSend(
      rejectionEvent,
      hintOf(new Error('async failed')),
    );

    expect(result?.tags?.context).toBe('Unhandled promise rejection');
  });

  it('keeps an existing context tag on rejection events', () => {
    const taggedEvent: ErrorEvent = {
      ...event,
      tags: { context: 'Custom context' },
      exception: {
        values: [{ mechanism: { type: 'onunhandledrejection' } }],
      },
    };

    const result = sentryBeforeSend(
      taggedEvent,
      hintOf(new Error('async failed')),
    );

    expect(result?.tags?.context).toBe('Custom context');
  });
});
