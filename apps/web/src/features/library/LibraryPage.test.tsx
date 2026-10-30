import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DiscoverFacets, DiscoverGame, DiscoverResponse } from '@gamekeeper/shared';
import { LibraryPage } from './LibraryPage';

const game = (
  canonicalId: string,
  name: string,
  extra: Partial<DiscoverGame> = {},
): DiscoverGame => ({
  canonicalId,
  name,
  primarySource: 'steam',
  ownedSources: ['steam'],
  status: 'backlog',
  genres: [],
  tags: [],
  ...extra,
});

const allGames: DiscoverGame[] = [
  game('hades-ii', 'Hades II', {
    genres: ['Action', 'Roguelike'],
    status: 'playing',
    year: 2024,
    playtimeHours: 12.5,
    deck: 'verified',
    protonTier: 'gold',
  }),
  game('celeste', 'Celeste', {
    genres: ['Platformer'],
    ownedSources: ['gog', 'steam'],
    year: 2018,
    playtimeHours: 3,
    deck: 'playable',
    protonTier: 'platinum',
  }),
];

const facets: DiscoverFacets = {
  genres: [
    { value: 'Action', count: 1 },
    { value: 'Platformer', count: 1 },
    { value: 'Roguelike', count: 1 },
  ],
  tags: [{ value: 'indies', count: 2 }],
  sources: [
    { value: 'steam', count: 2 },
    { value: 'gog', count: 1 },
  ],
  statuses: [
    { value: 'backlog', count: 1 },
    { value: 'playing', count: 1 },
  ],
  decks: [
    { value: 'playable', count: 1 },
    { value: 'verified', count: 1 },
  ],
  protonTiers: [
    { value: 'gold', count: 1 },
    { value: 'platinum', count: 1 },
  ],
  years: [
    { value: 2018, count: 1 },
    { value: 2024, count: 1 },
  ],
};

/** Filter the fixture library the way the server would, keyed on the request URL. */
const filterServer = (url: URL): DiscoverResponse => {
  let games = [...allGames];
  const list = (key: string) =>
    url.searchParams
      .get(key)
      ?.split(',')
      .filter(Boolean) ?? [];
  const genres = list('genre');
  const statuses = list('status');
  const decks = list('deck');
  const q = url.searchParams.get('q')?.toLowerCase() ?? '';

  if (genres.length) games = games.filter(g => g.genres.some(genre => genres.includes(genre)));
  if (statuses.length) games = games.filter(g => statuses.includes(g.status));
  if (decks.length) games = games.filter(g => g.deck && decks.includes(g.deck));
  if (q) {
    games = games.filter(g =>
      [g.name, ...g.genres, ...g.tags].some(field => field.toLowerCase().includes(q)),
    );
  }
  return { games, total: games.length };
};

const stubBrowse = () => {
  const calls: string[] = [];
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ url: url.pathname, body });
      return new Response(
        JSON.stringify({ canonicalId: url.pathname.split('/').at(-2), status: body.status, position: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.pathname === '/api/library') {
      return new Response(
        JSON.stringify({
          statuses: [
            { key: 'backlog', label: 'Backlog', color: '#64748b', position: 0 },
            { key: 'want_to_play', label: 'Want to Play', color: '#eab308', position: 1 },
            { key: 'playing', label: 'Playing', color: '#22c55e', position: 5 },
          ],
          games: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.pathname === '/api/games') {
      return new Response(JSON.stringify(filterServer(url)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.pathname === '/api/facets') {
      return new Response(JSON.stringify(facets), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, patches };
};

const renderPage = (initialEntry = '/library') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <LibraryPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

const waitForCards = async (...names: string[]) => {
  for (const name of names) {
    expect(
      await screen.findByText(name, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  }
};

describe('LibraryPage', () => {
  beforeEach(() => {
    stubBrowse();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders result cards with count and facet chips', async () => {
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    expect(screen.getByTestId('library-total')).toHaveTextContent('2 games');
    expect(screen.getAllByTestId('library-card')).toHaveLength(2);
    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();
    expect(screen.getByTestId('facet-decks-verified')).toBeInTheDocument();
    expect(screen.getByTestId('facet-years-2018')).toBeInTheDocument();
  });

  it('toggles a facet chip: refetch with the filter and reflect active state', async () => {
    const user = userEvent.setup();
    const { calls } = stubBrowse();
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    await user.click(screen.getByTestId('facet-genres-Platformer'));

    await waitFor(() => {
      expect(calls.some(url => url.includes('genre=Platformer'))).toBe(true);
    });
    await waitFor(() => expect(screen.getByText('Celeste')).toBeInTheDocument());
    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();
    expect(screen.getByTestId('facet-genres-Platformer')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('library-total')).toHaveTextContent('1 games');

    // toggling off restores the full library
    await user.click(screen.getByTestId('facet-genres-Platformer'));
    await waitForCards('Hades II', 'Celeste');
  });

  it('ANDs across dimensions: genre + deck narrows to one game', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    await user.click(screen.getByTestId('facet-genres-Action'));
    await user.click(screen.getByTestId('facet-decks-verified'));

    await waitFor(() => expect(screen.getByText('Hades II')).toBeInTheDocument());
    expect(screen.queryByText('Celeste')).not.toBeInTheDocument();
    expect(screen.getByTestId('library-total')).toHaveTextContent('1 games');
  });

  it('debounces search text into the q param', async () => {
    const user = userEvent.setup();
    const { calls } = stubBrowse();
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    await user.type(screen.getByLabelText('Search games'), 'Celeste');

    await waitFor(
      () => {
        expect(calls.some(url => url.includes('q=Celeste'))).toBe(true);
      },
      { timeout: 2000 },
    );
    await waitFor(() => expect(screen.queryByText('Hades II')).not.toBeInTheDocument());
    expect(screen.getByText('Celeste')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear search/i }));
    await waitForCards('Hades II', 'Celeste');
  });

  it('restores filters from the URL on load', async () => {
    renderPage('/library?genre=Action&status=playing');
    await waitForCards('Hades II');

    expect(screen.queryByText('Celeste')).not.toBeInTheDocument();
    expect(screen.getByTestId('facet-genres-Action')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('facet-statuses-playing')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps Clear all visible but disabled with no filters, enabled otherwise', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    const clearAll = screen.getByRole('button', { name: /clear all filters/i });
    expect(clearAll).toBeDisabled();

    await user.click(screen.getByTestId('facet-genres-Action'));
    await waitFor(() => expect(clearAll).toBeEnabled());

    await user.click(clearAll);
    await waitForCards('Hades II', 'Celeste');
    expect(clearAll).toBeDisabled();
  });

  it('shows owned-source badges and rounded playtime on the card', async () => {
    renderPage();
    await waitForCards('Celeste');

    const celeste = screen.getByText('Celeste').closest('[data-testid="library-card"]')!;
    const sources = within(celeste as HTMLElement).getAllByTestId('source-badge');
    expect(sources.map(badge => badge.getAttribute('data-source'))).toEqual(['gog', 'steam']);
    expect(within(celeste as HTMLElement).getByText('3h')).toBeInTheDocument();

    const hades = screen.getByText('Hades II').closest('[data-testid="library-card"]')!;
    expect(within(hades as HTMLElement).getByText('13h')).toBeInTheDocument(); // 12.5 rounds
    expect(within(hades as HTMLElement).getByText(/2024/)).toBeInTheDocument();
  });

  it('opens the shared game drawer on card click and moves via the menu', async () => {
    const user = userEvent.setup();
    const { patches } = stubBrowse();
    renderPage();
    await waitForCards('Hades II');

    await user.click(screen.getByText('Hades II'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Hades II' })).toBeInTheDocument();
    // platform row + playtime rendered in the drawer
    expect(within(dialog).getAllByTestId('source-badge')[0]).toBeInTheDocument();
    expect(within(dialog).getByText('13h played')).toBeInTheDocument();
    // browse games are never pinned → no unpin action
    expect(within(dialog).queryByRole('button', { name: /unpin/i })).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /move to/i }));
    await user.click(within(dialog).getByRole('button', { name: 'Backlog' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].url).toBe('/api/games/hades-ii/status');
    expect(patches[0].body).toMatchObject({ status: 'backlog', beforeId: null, afterId: null });

    await user.click(within(dialog).getByRole('button', { name: /close drawer/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('collapses a filter section and keeps the active-count badge visible', async () => {
    const user = userEvent.setup();
    renderPage('/library?genre=Action');
    await waitForCards('Hades II');

    const toggle = screen.getByTestId('facet-section-toggle-genres');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();
    expect(screen.getByTestId('facet-active-count-genres')).toHaveTextContent('1');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('facet-genres-Action')).not.toBeInTheDocument();
    expect(screen.getByTestId('facet-active-count-genres')).toHaveTextContent('1');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();
  });

  it('sorts by playtime descending with unplayed last', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    await user.selectOptions(screen.getByLabelText('Sort by'), 'playtime');

    // playtime desc: Hades II (12.5h) before Celeste (3h) — opposite of name order
    const names = screen.getAllByTestId('library-card').map(card => card.textContent);
    expect(names[0]).toContain('Hades II');
    expect(names[1]).toContain('Celeste');
  });

  it('shows the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForCards('Hades II', 'Celeste');

    await user.type(screen.getByLabelText('Search games'), 'unobtainium');

    await waitFor(
      () => {
        expect(screen.getByTestId('library-empty')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.getByTestId('library-total')).toHaveTextContent('0 games');
  });

  it('shows an error state when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/couldn't load games/i)).toBeInTheDocument();
    });
  });
});
