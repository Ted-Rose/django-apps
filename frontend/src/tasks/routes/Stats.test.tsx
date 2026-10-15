import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Stats from './Stats';
import { apiGet, apiPost } from '../../shared/api/client';
import { clearToasts } from '../../shared/toasts';
import type { StatsBucketOut, StatsOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  getCsrfToken: () => undefined,
}));

const mockedApiGet = vi.mocked(apiGet);

function makeBucket(overrides: Partial<StatsBucketOut> = {}): StatsBucketOut {
  return {
    start: '2026-03-02',
    total: 0,
    by_label: {},
    unlabeled: 0,
    by_list: {},
    ...overrides,
  };
}

function makeStats(overrides: Partial<StatsOut> = {}): StatsOut {
  return {
    labels: [
      { id: 1, name: 'home', color: '#ff0000' },
      { id: 2, name: 'work', color: '#00ff00' },
    ],
    weekly: [
      makeBucket({ start: '2026-02-23' }),
      makeBucket({
        start: '2026-03-02',
        total: 3,
        by_label: { home: 2 },
        unlabeled: 1,
        by_list: { 'List 1': 3 },
      }),
    ],
    monthly: [
      makeBucket({
        start: '2026-02-01',
        total: 1,
        by_label: { work: 1 },
        by_list: { 'List 1': 1 },
      }),
      makeBucket({
        start: '2026-03-01',
        total: 3,
        by_label: { home: 2 },
        unlabeled: 1,
        by_list: { 'List 1': 2, '': 1 },
      }),
    ],
    summary: {
      this_week: 3,
      last_week: 0,
      this_month: 3,
      last_month: 1,
      all_time: 4,
      unknown_date: 1,
    },
    ...overrides,
  };
}

function renderStats(initialEntry = '/stats') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Stats />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
  vi.mocked(apiPost).mockReset();
  clearToasts();
  localStorage.clear();
});

describe('Stats', () => {
  it('fetches /api/tasks/stats/', async () => {
    mockedApiGet.mockResolvedValue(makeStats());
    renderStats();
    expect(await screen.findByText('Stats')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/tasks/stats/');
  });

  it('passes weeks/months/list params through to the API', async () => {
    mockedApiGet.mockResolvedValue(makeStats());
    renderStats('/stats?weeks=8&months=6&list=list-1');
    await screen.findByText('Stats');
    expect(mockedApiGet).toHaveBeenCalledWith(
      '/api/tasks/stats/?weeks=8&months=6&list=list-1',
    );
  });

  it('renders the summary cards', async () => {
    mockedApiGet.mockResolvedValue(makeStats());
    renderStats();
    expect(await screen.findByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('Last Week')).toBeInTheDocument();
    expect(screen.getByText('This Month')).toBeInTheDocument();
    expect(screen.getByText('Last Month')).toBeInTheDocument();
    expect(screen.getByText('All Time')).toBeInTheDocument();
    // Delta badge: this_week 3 vs last_week 0 → +3.
    expect(screen.getByText('+3')).toBeInTheDocument();
    // unknown_date shows under the all-time card.
    expect(screen.getByText('+1 with no recorded date')).toBeInTheDocument();
  });

  it('renders stacked weekly bars with label colors', async () => {
    mockedApiGet.mockResolvedValue(makeStats());
    const { container } = renderStats();
    // Current week bucket tooltip carries the total.
    expect(
      await screen.findByTitle('Week of Mar 2 — 3 completed'),
    ).toBeInTheDocument();
    const segments = container.querySelectorAll('.stats-bar-segment');
    // Weekly series: 2 label segments (home) + 1 unlabeled = 3.
    expect(segments.length).toBeGreaterThanOrEqual(3);
    const colored = [...segments].some(
      (el) => (el as HTMLElement).style.backgroundColor === 'rgb(255, 0, 0)',
    );
    expect(colored).toBe(true);
  });

  it('renders the label and list breakdowns', async () => {
    mockedApiGet.mockResolvedValue(makeStats());
    renderStats();
    expect(await screen.findByText('By Label')).toBeInTheDocument();
    // Label badges from the legend (home over monthly window = 2).
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('Unlabeled')).toBeInTheDocument();
    expect(screen.getByText('By List')).toBeInTheDocument();
    expect(screen.getByText('List 1')).toBeInTheDocument();
    // '' by_list key renders as the localized Unlisted row.
    expect(screen.getByText('Unlisted')).toBeInTheDocument();
    expect(screen.getByText(/counts once per label/)).toBeInTheDocument();
  });

  it('shows the empty state when nothing was ever completed', async () => {
    mockedApiGet.mockResolvedValue(
      makeStats({
        summary: {
          this_week: 0,
          last_week: 0,
          this_month: 0,
          last_month: 0,
          all_time: 0,
          unknown_date: 0,
        },
      }),
    );
    renderStats();
    expect(
      await screen.findByText('No completed tasks yet.'),
    ).toBeInTheDocument();
  });
});
