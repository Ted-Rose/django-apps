import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, apiPost } from './client';
import { ApiError } from './errors';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('apiFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Clear cookies set by tests.
    document.cookie = 'csrftoken=; Max-Age=0';
  });

  it('sends X-CSRFToken on unsafe methods', async () => {
    document.cookie = 'csrftoken=test-token';
    await apiPost('/api/tasks/sync/', { foo: 'bar' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tasks/sync/');
    expect(new Headers(init.headers).get('X-CSRFToken')).toBe('test-token');
    expect(init.credentials).toBe('same-origin');
    expect(init.redirect).toBe('manual');
    expect(new Headers(init.headers).get('Content-Type')).toBe(
      'application/json',
    );
  });

  it('does not send X-CSRFToken on safe methods', async () => {
    document.cookie = 'csrftoken=test-token';
    await apiFetch('/api/tasks/dashboard/');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-CSRFToken')).toBeNull();
  });

  it.each([
    { login_url: '/admin/login/?next=/tasks/app/' },
    { authorization_url: 'https://accounts.google.com/o/oauth2/auth' },
  ])('navigates on 401 with %o', async (body) => {
    const assign = vi.fn();
    const originalLocation = window.location;
    // jsdom's Location is configurable — swap in a stub so we can
    // observe navigation without jsdom's "not implemented" error.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign },
    });
    fetchMock.mockResolvedValue(jsonResponse(body, 401));

    try {
      // Deliberately not awaited: the client returns a promise that
      // stays pending while the browser navigates away.
      void apiFetch('/api/tasks/dashboard/');
      await vi.waitFor(() => {
        const expected = body.login_url ?? body.authorization_url;
        expect(assign).toHaveBeenCalledWith(expected);
      });
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });

  it('throws ApiError on non-2xx without auth redirect', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'nope' }, 500));

    const err = await apiFetch('/api/tasks/').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).body).toEqual({ error: 'nope' });
  });

  it('returns parsed JSON on success', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tasks: [] }));
    await expect(apiFetch('/api/tasks/')).resolves.toEqual({
      tasks: [],
    });
  });
});
