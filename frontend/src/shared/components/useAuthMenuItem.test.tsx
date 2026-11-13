import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionGate, type SessionResult } from '../session';
import { useAuthMenuItem } from './useAuthMenuItem';

function AuthProbe() {
  const item = useAuthMenuItem();
  return <div>{`${item.label}|${item.url}`}</div>;
}

function renderInGate(promise: Promise<SessionResult>, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionGate promise={promise}>
        <AuthProbe />
      </SessionGate>
    </MemoryRouter>,
  );
}

describe('useAuthMenuItem', () => {
  it('returns the logout item when a session is resolved', async () => {
    renderInGate(
      Promise.resolve({
        status: 'authenticated',
        session: { username: 'tedis', language: 'en', is_staff: false },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByText('Logout (tedis)|/admin/logout/'),
      ).toBeInTheDocument(),
    );
  });

  it('returns the Google login item for anonymous visitors', async () => {
    renderInGate(Promise.resolve({ status: 'anonymous' }));
    await waitFor(() =>
      expect(
        screen.getByText('Login with Google|/login/?next=%2F'),
      ).toBeInTheDocument(),
    );
  });
});
