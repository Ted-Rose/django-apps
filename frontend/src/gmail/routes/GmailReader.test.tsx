import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GmailReader from './GmailReader';
import { apiGet, apiPost } from '../../shared/api/client';
import { clearToasts } from '../../shared/toasts';
import type { GmailMessageOut, GmailMessagesOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

const OK_STATUS = {
  has_credentials: true,
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
};

function makeMessages(
  messages: GmailMessageOut[] = [],
  query = 'is:unread',
): GmailMessagesOut {
  return { messages, query };
}

function makeMessage(id: string): GmailMessageOut {
  return {
    id,
    subject: `Subject ${id}`,
    sender: `sender-${id}@example.com`,
    body: `Body ${id}`,
  };
}

function renderReader(entry = '/?query=is:unread') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>
        <GmailReader />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Route apiGet by URL prefix: status vs messages. */
function mockApi(
  status: unknown = OK_STATUS,
  messages: unknown = makeMessages(),
) {
  mockedApiGet.mockImplementation((url: string) => {
    if (url.startsWith('/api/gmail/status/')) {
      return Promise.resolve(status);
    }
    return Promise.resolve(messages);
  });
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('GmailReader', () => {
  it('auto-fetches messages when the URL carries ?query=', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1')]));
    renderReader();
    expect(await screen.findByText('Subject m1')).toBeInTheDocument();
    expect(screen.getByText('sender-m1@example.com')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/gmail/messages/?query=is%3Aunread',
    );
  });

  it('auto-fetches on the legacy get_messages param too', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1')]));
    renderReader('/?get_messages&query=is:unread');
    expect(await screen.findByText('Subject m1')).toBeInTheDocument();
  });

  it('does not fetch without query params', async () => {
    mockApi();
    renderReader('/');
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith('/api/gmail/status/'),
    );
    expect(
      mockedApiGet.mock.calls.some(([u]) =>
        String(u).startsWith('/api/gmail/messages/'),
      ),
    ).toBe(false);
    expect(await screen.findByText(/No emails found/)).toBeInTheDocument();
  });

  it('submits the filter form into ?query= and fetches', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1')], 'newer_than:1d'));
    renderReader('/');
    // The status gate renders a placeholder until it resolves.
    const input = await screen.findByLabelText(/Gmail search query/);
    fireEvent.change(input, { target: { value: 'newer_than:1d' } });
    fireEvent.click(screen.getByRole('button', { name: /Get Emails/ }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/gmail/messages/?query=newer_than%3A1d',
      ),
    );
    expect(await screen.findByText('Subject m1')).toBeInTheDocument();
  });

  it('bounces to /login/?next= when status has no credentials', async () => {
    // jsdom's location.assign is non-configurable — swap the whole
    // location object like shared/api/client.test.ts does.
    const assign = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign },
    });
    mockApi({ has_credentials: false, scopes: [] });
    renderReader('/');
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith(
        `/login/?next=${encodeURIComponent('/')}`,
      ),
    );
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('marks one message read after confirm', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1'), makeMessage('m2')]));
    mockedApiPost.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderReader();
    await screen.findByText('Subject m1');

    const card = document.getElementById('message-m1-container')!;
    fireEvent.click(card.querySelector<HTMLButtonElement>('.mark-read-btn')!);

    expect(confirmSpy).toHaveBeenCalledWith('Mark this email as read?');
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/gmail/mark-read/', {
        message_ids: ['m1'],
      }),
    );
    // markCardAsRead parity: card dims, button becomes disabled "Read".
    await waitFor(() => expect(card.style.opacity).toBe('0.55'));
    const btn = card.querySelector<HTMLButtonElement>('.mark-read-btn')!;
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent('Read');
    // The other card is untouched.
    expect(
      document.getElementById('message-m2-container')!.style.opacity,
    ).not.toBe('0.55');
    confirmSpy.mockRestore();
  });

  it('does not post when confirm is cancelled', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1')]));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderReader();
    await screen.findByText('Subject m1');
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('.mark-read-btn')!,
    );
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockedApiPost).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('mark-all posts every id and dims every card', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1'), makeMessage('m2')]));
    mockedApiPost.mockResolvedValue({ success: true });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderReader();
    await screen.findByText('Subject m1');

    fireEvent.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith('/api/gmail/mark-read/', {
        message_ids: ['m1', 'm2'],
      }),
    );
    await waitFor(() => {
      expect(
        document.getElementById('message-m1-container')!.style.opacity,
      ).toBe('0.55');
      expect(
        document.getElementById('message-m2-container')!.style.opacity,
      ).toBe('0.55');
    });
    confirmSpy.mockRestore();
  });

  it('toggles the message body open and closed', async () => {
    mockApi(OK_STATUS, makeMessages([makeMessage('m1')]));
    renderReader();
    await screen.findByText('Subject m1');
    const body = document.querySelector<HTMLElement>('.message-body')!;
    expect(body).not.toHaveClass('show');
    fireEvent.click(screen.getByRole('button', { name: /Show Body/ }));
    expect(body).toHaveClass('show');
    fireEvent.click(screen.getByRole('button', { name: /Hide Body/ }));
    expect(body).not.toHaveClass('show');
  });
});
