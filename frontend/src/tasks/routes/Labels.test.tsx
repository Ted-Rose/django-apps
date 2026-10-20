import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Labels from './Labels';
import { apiGet, apiPost } from '../../shared/api/client';
import { clearToasts } from '../../shared/toasts';
import type { LabelsOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);
const mockedApiPost = vi.mocked(apiPost);

function makeLabels(overrides: Partial<LabelsOut> = {}): LabelsOut {
  return {
    labels: [
      { id: 1, name: 'home', color: '#ff0000', task_count: 2 },
      { id: 2, name: 'work', color: '#00ff00', task_count: 0 },
    ],
    ...overrides,
  };
}

function renderLabels() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/labels']}>
      <QueryClientProvider client={queryClient}>
        <Labels />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  mockedApiPost.mockReset();
  clearToasts();
  localStorage.clear();
});

describe('Labels', () => {
  it('fetches /api/tasks/labels/ and lists labels with counts', async () => {
    mockedApiGet.mockResolvedValue(makeLabels());
    renderLabels();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(screen.getByText('work')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/tasks/labels/');
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('keeps Save disabled until the color changes, then posts', async () => {
    mockedApiGet.mockResolvedValue(makeLabels());
    mockedApiPost.mockResolvedValue({ success: true });
    renderLabels();
    const saveButtons = await screen.findAllByRole('button', {
      name: 'Save',
    });
    expect(saveButtons[0]).toBeDisabled();

    fireEvent.change(screen.getAllByLabelText('Hex color code')[0], {
      target: { value: '#0000ff' },
    });
    expect(saveButtons[0]).toBeEnabled();
    // The untouched row stays clean.
    expect(saveButtons[1]).toBeDisabled();

    fireEvent.click(saveButtons[0]);
    const url = '/api/tasks/label/1/update/';
    await waitFor(() =>
      expect(mockedApiPost).toHaveBeenCalledWith(url, {
        color: '#0000ff',
      }),
    );
  });

  it('disables Save for malformed hex input', async () => {
    mockedApiGet.mockResolvedValue(makeLabels());
    renderLabels();
    const saveButtons = await screen.findAllByRole('button', {
      name: 'Save',
    });
    fireEvent.change(screen.getAllByLabelText('Hex color code')[0], {
      target: { value: 'red' },
    });
    expect(saveButtons[0]).toBeDisabled();
  });

  it('shows the empty state when the user has no labels', async () => {
    mockedApiGet.mockResolvedValue(makeLabels({ labels: [] }));
    renderLabels();
    expect(await screen.findByText(/No labels yet/)).toBeInTheDocument();
  });
});
