import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  DiscoverFacets,
  DiscoverGame,
  HubResponse,
  SuggestResponse,
} from '@gamekeeper/shared';
import { DiscoverHub } from './DiscoverHub';

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

const celeste = game('celeste', 'Celeste', {
  genres: ['Platformer'],
  year: 2018,
});
const tunic = game('tunic', 'Tunic', {
  genres: ['Adventure'],
  status: 'want_to_play',
});

const defaultShelves: HubResponse['shelves'] = [
  { key: 'picked', title: 'Picked for you', games: [celeste, tunic] },
  { key: 'want', title: 'Want to play', games: [tunic] },
];

const facets: DiscoverFacets = {
  genres: [
    { value: 'Adventure', count: 1 },
    { value: 'Platformer', count: 1 },
  ],
  tags: [],
  sources: [{ value: 'steam', count: 2 }],
  statuses: [
    { value: 'backlog', count: 1 },
    { value: 'want_to_play', count: 1 },
  ],
  decks: [],
  protonTiers: [],
  years: [{ value: 2018, count: 1 }],
};

const statuses = [
  { key: 'backlog', label: 'Backlog', color: '#64748b', position: 0 },
  { key: 'want_to_play', label: 'Want to Play', color: '#eab308', position: 1 },
];

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

type StubOptions = {
  shelves?: HubResponse['shelves'];
  suggest?: (url: URL) => SuggestResponse;
};

const stubHub = (opts: StubOptions = {}) => {
  const calls: string[] = [];
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const shelves = opts.shelves ?? defaultShelves;
  const suggest =
    opts.suggest ??
    ((url: URL): SuggestResponse => {
      const excluded = url.searchParams.get('exclude')?.split(',') ?? [];
      const pick = excluded.includes('celeste') ? tunic : celeste;
      return { game: pick, reasons: ['Backlog', 'Never played'] };
    });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ url: url.pathname, body });
      return json({
        canonicalId: url.pathname.split('/').at(-2),
        status: body.status,
        position: 1,
      });
    }
    if (url.pathname === '/api/hub') return json({ shelves });
    if (url.pathname === '/api/suggest') return json(suggest(url));
    if (url.pathname === '/api/facets') return json(facets);
    if (url.pathname === '/api/library') return json({ statuses, games: [] });
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, patches };
};

const renderPage = (initialEntry = '/discover') => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={queryClient}>
        <DiscoverHub />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

const hubCalls = (calls: string[]): string[] =>
  calls.filter(url => url.startsWith('/api/hub'));

describe('DiscoverHub', () => {
  beforeEach(() => {
    stubHub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders shelves led by the hero row', async () => {
    renderPage();

    expect(await screen.findByTestId('shelf-picked')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Picked for you' })).toBeInTheDocument();
    expect(screen.getByTestId('shelf-want')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Want to play' })).toBeInTheDocument();
    expect(screen.getByTestId('hub-total')).toHaveTextContent('2 picks');
    // hero (2) + want shelf (1) — tunic appears in both
    expect(screen.getAllByTestId('library-card')).toHaveLength(3);
  });

  it('opens the drawer from a shelf card', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByText('Celeste'));
    expect(
      await screen.findByRole('dialog', { name: 'Details: Celeste' }),
    ).toBeInTheDocument();
  });

  it('surprise me: picks a game, spin again excludes the shown pick', async () => {
    const user = userEvent.setup();
    const { calls } = stubHub();
    renderPage();

    await user.click(await screen.findByTestId('surprise-me'));
    expect(await screen.findByTestId('suggest-game-name')).toHaveTextContent('Celeste');

    await user.click(screen.getByTestId('suggest-spin'));
    await waitFor(() => {
      expect(calls.some(url => url.includes('/api/suggest') && url.includes('exclude=celeste'))).toBe(true);
    });
    expect(await screen.findByTestId('suggest-game-name')).toHaveTextContent('Tunic');
  });

  it('surprise me: moving to want-to-play PATCHes and closes the modal', async () => {
    const user = userEvent.setup();
    const { patches } = stubHub();
    renderPage();

    await user.click(await screen.findByTestId('surprise-me'));
    await screen.findByTestId('suggest-game-name');
    await user.click(screen.getByRole('button', { name: 'Move to want-to-play' }));

    await waitFor(() => {
      expect(patches).toHaveLength(1);
    });
    expect(patches[0].url).toBe('/api/games/celeste/status');
    expect(patches[0].body).toMatchObject({ status: 'want_to_play' });
    await waitFor(() => {
      expect(screen.queryByTestId('suggest-modal')).not.toBeInTheDocument();
    });
  });

  it('genre chip narrows the hub request', async () => {
    const user = userEvent.setup();
    const { calls } = stubHub();
    renderPage();

    await screen.findByTestId('shelf-picked');
    await user.click(screen.getByTestId('facet-genres-Platformer'));

    await waitFor(() => {
      expect(hubCalls(calls).some(url => url.includes('genre=Platformer'))).toBe(true);
    });
    expect(screen.getByTestId('facet-genres-Platformer')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shuffle requests the hub with a new seed', async () => {
    const user = userEvent.setup();
    const { calls } = stubHub();
    renderPage();

    await screen.findByTestId('shelf-picked');
    expect(hubCalls(calls)).toHaveLength(1);

    await user.click(screen.getByTestId('shuffle-hub'));
    await waitFor(() => {
      expect(hubCalls(calls)).toHaveLength(2);
    });
    const seeds = hubCalls(calls).map(url => new URL(`http://x${url}`).searchParams.get('seed'));
    expect(new Set(seeds).size).toBe(2);
  });

  it('shows the empty state when no shelf qualifies', async () => {
    stubHub({ shelves: [] });
    renderPage();

    expect(await screen.findByTestId('hub-empty')).toHaveTextContent(
      'Nothing matches the current filters.',
    );
  });
});
