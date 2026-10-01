import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Feed from './Feed';
import { apiGet } from '../../shared/api/client';
import { ApiError } from '../../shared/api/errors';
import type { ContentOut, ContentsOut } from '../api';

vi.mock('../../shared/api/client', () => ({
  apiGet: vi.fn(),
}));

const mockedApiGet = vi.mocked(apiGet);

function makeContent(overrides: Partial<ContentOut> = {}): ContentOut {
  return {
    id: 1,
    title_lv: 'Filma',
    title_eng: 'Film',
    type: 'movie',
    description_lv: 'Apraksts',
    description_eng: 'Description',
    image: 'https://img.example/x.jpg',
    url: 'https://www.imdb.com/title/tt0000001/',
    content_rating: 'TV-G',
    rating_value: 7.5,
    start_date: '2024-01-02',
    channel: 'ltv1_hd',
    ratio: 0.8,
    ...overrides,
  };
}

function makeContents(overrides: Partial<ContentsOut> = {}): ContentsOut {
  return {
    contents: [],
    page: 1,
    num_pages: 1,
    count: 0,
    channels: ['ltv1_hd', 'ltv7_hd'],
    content_ratings: ['TV-G', 'TV-MA'],
    types: ['movie', 'series'],
    ...overrides,
  };
}

function renderFeed(initialEntry = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <Feed />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedApiGet.mockReset();
});

describe('Feed', () => {
  it('fetches /api/tv-arhivs/contents/ and renders each card', async () => {
    mockedApiGet.mockResolvedValue(
      makeContents({
        count: 2,
        contents: [
          makeContent(),
          makeContent({
            id: 2,
            title_lv: 'Serials',
            channel: 'ltv7_hd',
            rating_value: 9.1,
            start_date: '2024-03-04',
            ratio: 0.95,
          }),
        ],
      }),
    );
    renderFeed();
    expect(await screen.findByText('Filma')).toBeInTheDocument();
    expect(screen.getByText('Serials')).toBeInTheDocument();
    expect(screen.getAllByText('Apraksts')).toHaveLength(2);
    // Metadata row — rating, channel, ISO date, 2-decimal ratio.
    expect(screen.getByText('Rating: 7.5')).toBeInTheDocument();
    expect(screen.getByText('Rating: 9.1')).toBeInTheDocument();
    expect(screen.getByText('Channel: ltv1_hd')).toBeInTheDocument();
    expect(screen.getByText('Channel: ltv7_hd')).toBeInTheDocument();
    expect(screen.getByText('Start Date: 2024-01-02')).toBeInTheDocument();
    expect(screen.getByText('Ratio: 0.80')).toBeInTheDocument();
    expect(mockedApiGet).toHaveBeenCalledWith('/api/tv-arhivs/contents/');
  });

  it('renders the template empty state and a slim header', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed();
    expect(await screen.findByText('No content available')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'TV Archive' }),
    ).toBeInTheDocument();
    // Plain anchor back to the Django home page — the public page
    // deliberately skips the shared NavBar.
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('renders null fields gracefully — dashes and the local image placeholder', async () => {
    mockedApiGet.mockResolvedValue(
      makeContents({
        count: 1,
        contents: [
          makeContent({
            image: null,
            description_lv: null,
            rating_value: null,
            start_date: null,
            ratio: null,
          }),
        ],
      }),
    );
    const { container } = renderFeed();
    expect(await screen.findByText('Filma')).toBeInTheDocument();
    expect(screen.queryByText('Apraksts')).not.toBeInTheDocument();
    expect(screen.getByText('Rating: —')).toBeInTheDocument();
    expect(screen.getByText('Start Date: —')).toBeInTheDocument();
    expect(screen.getByText('Ratio: —')).toBeInTheDocument();
    // No via.placeholder.com — a local styled div stands in.
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(
      container.querySelector('.feed-image-placeholder'),
    ).toBeInTheDocument();
  });

  it('swaps in the placeholder when the image fails to load', async () => {
    mockedApiGet.mockResolvedValue(
      makeContents({ count: 1, contents: [makeContent()] }),
    );
    const { container } = renderFeed();
    const img = await screen.findByAltText('Film');
    fireEvent.error(img);
    expect(
      container.querySelector('.feed-image-placeholder'),
    ).toBeInTheDocument();
  });

  it('populates the filter selects from the response option lists', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed();
    const channelSelect = (await screen.findByLabelText(
      'Channel:',
    )) as HTMLSelectElement;
    // The form renders before the first fetch resolves; the option
    // lists arrive with the response.
    await waitFor(() =>
      expect(
        within(channelSelect)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Any', 'ltv1_hd', 'ltv7_hd']),
    );
    const typeSelect = screen.getByLabelText('Type:') as HTMLSelectElement;
    expect(
      within(typeSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Any', 'movie', 'series']);
  });

  it('keeps an unknown URL param value as a select option', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed('/?channel=old_chan');
    const channelSelect = (await screen.findByLabelText(
      'Channel:',
    )) as HTMLSelectElement;
    expect(channelSelect.value).toBe('old_chan');
    await waitFor(() =>
      expect(
        within(channelSelect)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Any', 'ltv1_hd', 'ltv7_hd', 'old_chan']),
    );
  });

  it('passes deep-linked params through to the API verbatim', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed('/?start_date=2024-01-01&channel=ltv1_hd&type=movie');
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenCalledWith(
        '/api/tv-arhivs/contents/?start_date=2024-01-01&channel=ltv1_hd&type=movie',
      ),
    );
  });

  it('writes submitted filters to the search params, dropping empty fields and page', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed('/?page=3');
    // Wait for the option lists before touching the <select> —
    // choosing an option that doesn't exist yet is a no-op.
    await screen.findByRole('option', { name: 'ltv7_hd' });
    fireEvent.change(screen.getByLabelText('Channel:'), {
      target: { value: 'ltv7_hd' },
    });
    fireEvent.change(screen.getByLabelText('Minimum Rating:'), {
      target: { value: '7' },
    });
    fireEvent.change(screen.getByLabelText('Min ratio:'), {
      target: { value: '0.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/tv-arhivs/contents/?rating_value=7&ratio=0.5&channel=ltv7_hd',
      ),
    );
  });

  it('prefills the form from the current URL params', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed('/?not_channel=ltv7_hd&start_date=2024-02-01');
    expect(
      ((await screen.findByLabelText('Not Channel:')) as HTMLInputElement)
        .value,
    ).toBe('ltv7_hd');
    expect(
      (screen.getByLabelText('Start Date:') as HTMLInputElement).value,
    ).toBe('2024-02-01');
  });

  it('clears every filter and the page via the Clear button', async () => {
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed('/?channel=ltv1_hd&page=2');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith('/api/tv-arhivs/contents/'),
    );
    expect(
      ((await screen.findByLabelText('Channel:')) as HTMLSelectElement).value,
    ).toBe('');
  });

  it('paginates via ?page= while keeping the active filters', async () => {
    mockedApiGet.mockResolvedValue(
      makeContents({ page: 1, num_pages: 3, count: 120 }),
    );
    renderFeed('/?channel=ltv1_hd');
    expect(
      await screen.findByText('Page 1 of 3 — 120 items'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith(
        '/api/tv-arhivs/contents/?channel=ltv1_hd&page=2',
      ),
    );
  });

  it('shows an error alert with a working retry', async () => {
    mockedApiGet.mockRejectedValueOnce(
      new ApiError('Request failed: 500', 500, 'Internal Server Error'),
    );
    mockedApiGet.mockResolvedValue(makeContents());
    renderFeed();
    expect(
      await screen.findByText(/Couldn't load content/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() =>
      expect(mockedApiGet).toHaveBeenLastCalledWith('/api/tv-arhivs/contents/'),
    );
    expect(await screen.findByText('No content available')).toBeInTheDocument();
  });
});
