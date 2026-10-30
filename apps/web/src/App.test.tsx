import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

function stubCatalogFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/games')) {
      return new Response(
        JSON.stringify({ games: [], total: 0 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/api/facets')) {
      return new Response(
        JSON.stringify({
          genres: [], tags: [], sources: [], statuses: [],
          decks: [], protonTiers: [], years: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/catalog')) {
      return new Response(
        JSON.stringify([
          {
            id: '9NZ6T11M0R2N',
            title: 'Hades II',
            available: true,
          },
        ]),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith('/api/interests')) {
      return new Response(JSON.stringify({ interests: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/library')) {
      return new Response(
        JSON.stringify({
          statuses: [
            { key: 'backlog', label: 'Backlog', color: '#64748b', position: 0 },
            { key: 'playing', label: 'Playing', color: '#22c55e', position: 5 },
          ],
          games: [
            {
              canonicalId: 'steam:1145350',
              name: 'Hades II',
              primarySource: 'steam',
              ownedSources: ['steam'],
              status: null,
              position: null,
              pinned: false,
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('renders nav links and the categories board at /', async () => {
    stubCatalogFetch();
    renderApp();

    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Game Pass' })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('column-backlog')).toBeInTheDocument());
    expect(screen.getByTestId('column-backlog')).toHaveTextContent('Backlog');
    expect(screen.getByText('Hades II')).toBeInTheDocument();
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to Interests' })).not.toBeInTheDocument();
  });

  it('shows the catalog grid when navigating to /gamepass', async () => {
    const fetchMock = stubCatalogFetch();
    const user = userEvent.setup();

    renderApp();
    await user.click(screen.getByRole('link', { name: 'Game Pass' }));

    await waitFor(() =>
      expect(screen.getAllByText('Hades II').length).toBeGreaterThan(0),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/catalog'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/interests'),
    );
  });

  it('renders the library page when navigating to /library', async () => {
    stubCatalogFetch();
    const user = userEvent.setup();

    renderApp();
    await user.click(screen.getByRole('link', { name: 'Library' }));

    expect(screen.getByTestId('library-page')).toBeInTheDocument();
    expect(screen.getByLabelText('Search games')).toBeInTheDocument();
  });
});
