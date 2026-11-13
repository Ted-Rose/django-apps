import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionGate, useSession, type SessionResult } from './session';

const authed = (
  overrides: Partial<{
    username: string;
    language: string;
    is_staff: boolean;
  }> = {},
): SessionResult => ({
  status: 'authenticated',
  session: {
    username: 'tedis',
    language: 'en',
    is_staff: false,
    ...overrides,
  },
});

/**
 * Swap window.location.assign for a spy so tests can observe
 * navigation without jsdom's "not implemented" error.
 */
function stubLocationAssign() {
  const assign = vi.fn();
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...originalLocation, assign },
  });
  return {
    assign,
    restore: () => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    },
  };
}

function WhoAmI() {
  const session = useSession();
  return <div>user:{session?.username ?? 'none'}</div>;
}

function renderGate(promise: Promise<SessionResult>, initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SessionGate promise={promise}>
        <WhoAmI />
      </SessionGate>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SessionGate', () => {
  it('shows a loading state while the bootstrap is pending', () => {
    renderGate(new Promise(() => {}));
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('provides the session once authenticated', async () => {
    renderGate(Promise.resolve(authed({ username: 'tedis' })));
    await waitFor(() =>
      expect(screen.getByText('user:tedis')).toBeInTheDocument(),
    );
  });

  it('lets anonymous visitors onto the public dashboard', async () => {
    renderGate(Promise.resolve({ status: 'anonymous', loginUrl: null }), '/');
    await waitFor(() =>
      expect(screen.getByText('user:none')).toBeInTheDocument(),
    );
  });

  it('redirects anonymous deep links to login_url?next=…', async () => {
    const { assign, restore } = stubLocationAssign();
    try {
      renderGate(
        Promise.resolve({
          status: 'anonymous',
          loginUrl: '/admin/login/',
        }),
        '/finance/',
      );
      await waitFor(() => expect(assign).toHaveBeenCalled());
      const url = new URL(assign.mock.calls[0][0] as string);
      expect(url.pathname).toBe('/admin/login/');
      expect(url.searchParams.get('next')).toBe('/finance/');
    } finally {
      restore();
    }
  });

  it('renders nothing while the redirect is in flight', async () => {
    const { assign, restore } = stubLocationAssign();
    try {
      renderGate(
        Promise.resolve({ status: 'anonymous', loginUrl: null }),
        '/tasks/',
      );
      await waitFor(() => expect(assign).toHaveBeenCalled());
      // Falls back to the default login path without login_url.
      const url = new URL(assign.mock.calls[0][0] as string);
      expect(url.pathname).toBe('/admin/login/');
      expect(screen.queryByText('user:none')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
