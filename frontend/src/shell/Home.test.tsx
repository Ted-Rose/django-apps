import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';
import { SessionGate, type SessionResult } from '../shared/session';

function renderHome(result: SessionResult) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SessionGate promise={Promise.resolve(result)}>
        <Home />
      </SessionGate>
    </MemoryRouter>,
  );
}

const authed = (isStaff: boolean): SessionResult => ({
  status: 'authenticated',
  session: {
    username: 'tedis',
    language: 'en',
    is_staff: isStaff,
  },
});

describe('Home dashboard', () => {
  it('renders the greeting and tool cards', async () => {
    renderHome(authed(false));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );
    expect(screen.getByText('Email Manager')).toBeInTheDocument();
    expect(screen.getByText('Twister Game')).toBeInTheDocument();
    expect(screen.getByText('Google Tasks')).toBeInTheDocument();
    expect(screen.getByText('Finance')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('hides the Admin card for non-staff users', async () => {
    renderHome(authed(false));
    await waitFor(() =>
      expect(screen.getByText('Finance')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  it('shows the Admin card for staff users', async () => {
    renderHome(authed(true));
    await waitFor(() => expect(screen.getByText('Admin')).toBeInTheDocument());
  });

  it('renders for anonymous visitors too', async () => {
    renderHome({ status: 'anonymous' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
