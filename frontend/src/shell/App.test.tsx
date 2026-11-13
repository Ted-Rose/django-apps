import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import type { SessionResult } from '../shared/session';

// App chunks are stubbed — routing is under test, not the apps.
vi.mock('../finance/main', () => ({
  default: () => <div>finance-app</div>,
}));
vi.mock('../tasks/main', () => ({
  default: () => <div>tasks-app</div>,
}));
vi.mock('../notes/main', () => ({
  default: () => <div>notes-app</div>,
}));
vi.mock('../gmail/main', () => ({
  default: () => <div>gmail-app</div>,
}));
vi.mock('../single_pages/main', () => ({
  default: () => <div>single-pages-app</div>,
}));

const authed: SessionResult = {
  status: 'authenticated',
  session: { username: 'tedis', language: 'en', is_staff: false },
};

function renderShell(path = '/') {
  window.history.pushState({}, '', path);
  return render(<App sessionPromise={Promise.resolve(authed)} />);
}

describe('shell App routing', () => {
  it('renders the dashboard at /', async () => {
    renderShell('/');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument(),
    );
  });

  it.each([
    ['/tasks/', 'tasks-app'],
    ['/finance/', 'finance-app'],
    ['/gmail/', 'gmail-app'],
    ['/notes/', 'notes-app'],
    ['/twister', 'single-pages-app'],
    ['/spoki/', 'single-pages-app'],
  ])('mounts the right app chunk at %s', async (path, marker) => {
    renderShell(path);
    await waitFor(() => expect(screen.getByText(marker)).toBeInTheDocument());
  });

  it('sets a per-route document.title', async () => {
    renderShell('/finance/');
    await waitFor(() => expect(document.title).toBe("Finance - Tedis's Tools"));
  });
});
