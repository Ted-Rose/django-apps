import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ConnectBank from './ConnectBank';
import { apiGet, apiPost } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import { clearToasts } from '../../shared/toasts';
import type { InstitutionOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

const SWEDBANK: InstitutionOut = {
  id: 'SWEDBANK_HABALV22',
  name: 'Swedbank',
};
const SEB: InstitutionOut = { id: 'SEB_LV', name: 'SEB banka' };

function renderConnectBank(initialEntry = '/connect') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <ConnectBank />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/**
 * Swap window.location.assign for a spy so tests can observe the
 * bank-consent navigation without jsdom's "not implemented" error
 * (same helper as shared/api/client.test.ts). Returns [spy, restore].
 */
function stubLocationAssign() {
  const assign = vi.fn();
  const originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { ...originalLocation, assign },
  });
  const restore = () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  };
  return { assign, restore };
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
});

describe('ConnectBank', () => {
  it('defaults the country input to lv without fetching institutions', async () => {
    renderConnectBank();
    expect(await screen.findByLabelText('Country')).toHaveValue('lv');
    expect(mockedApiGet).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Select your bank')).toBeNull();
  });

  it('fetches institutions for the submitted country', async () => {
    mockedApiGet.mockResolvedValue({ institutions: [SWEDBANK, SEB] });
    renderConnectBank();
    fireEvent.click(screen.getByRole('button', { name: /Find Banks/ }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/institutions/?country=lv',
      ),
    );
    const select = await screen.findByLabelText('Select your bank');
    expect(select).toBeInTheDocument();
    expect(await screen.findByText('Swedbank')).toBeInTheDocument();
    expect(screen.getByText('SEB banka')).toBeInTheDocument();
  });

  it('honors ?country= on load and fetches institutions', async () => {
    mockedApiGet.mockResolvedValue({ institutions: [SWEDBANK] });
    renderConnectBank('/connect?country=gb');
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/finance/institutions/?country=gb',
      ),
    );
    expect(screen.getByLabelText('Country')).toHaveValue('gb');
  });

  it('posts the selected institution and navigates to the bank link', async () => {
    const { assign, restore } = stubLocationAssign();
    mockedApiGet.mockResolvedValue({ institutions: [SWEDBANK, SEB] });
    mockedApiPost.mockResolvedValue({
      link: 'https://ob.gocardless.com/consent/abc',
      requisition_id: 'req-123',
    });
    try {
      renderConnectBank('/connect?country=lv');
      const select = await screen.findByLabelText('Select your bank');
      fireEvent.change(select, { target: { value: SEB.id } });
      fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
      await waitFor(() =>
        expect(mockedApiPost).toHaveBeenCalledWith('/api/finance/connect/', {
          institution_id: SEB.id,
        }),
      );
      await vi.waitFor(() =>
        expect(assign).toHaveBeenCalledWith(
          'https://ob.gocardless.com/consent/abc',
        ),
      );
    } finally {
      restore();
    }
  });

  it('toasts the detail when connect fails', async () => {
    const { restore } = stubLocationAssign();
    mockedApiGet.mockResolvedValue({ institutions: [SWEDBANK] });
    mockedApiPost.mockRejectedValue(
      new ApiError('Request failed: 502', 502, 'Bad Gateway', {
        error: 'upstream_error',
        detail: 'Could not start bank link: upstream unavailable',
      }),
    );
    try {
      renderConnectBank('/connect?country=lv');
      await screen.findByLabelText('Select your bank');
      fireEvent.click(screen.getByRole('button', { name: /Connect/ }));
      await waitFor(() => expect(mockedApiPost).toHaveBeenCalled());
      expect(
        await screen.findByText(/upstream unavailable/),
      ).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('toasts a warning when the institutions fetch fails', async () => {
    mockedApiGet.mockRejectedValue(
      new ApiError('Request failed: 502', 502, 'Bad Gateway', {
        detail: 'Could not load institutions: rate limited',
      }),
    );
    renderConnectBank('/connect?country=lv');
    expect(
      await screen.findByText(/Could not load institutions: rate limited/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Select your bank')).toBeNull();
  });
});
