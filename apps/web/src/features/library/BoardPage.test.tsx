import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LibraryGame, LibraryResponse, StatusEntry } from '@gamekeeper/shared';
import { BoardPage } from './BoardPage';
import { applyMove } from './board-utils';

const statuses: StatusEntry[] = [
  { key: 'backlog', label: 'Backlog', color: '#64748b', position: 0 },
  { key: 'want_to_play', label: 'Want to Play', color: '#eab308', position: 1 },
  { key: 'playing', label: 'Playing', color: '#22c55e', position: 5 },
];

const game = (
  canonicalId: string,
  name: string,
  status: string | null = null,
  position: number | null = null,
  extra: Partial<LibraryGame> = {},
): LibraryGame => ({
  canonicalId,
  name,
  primarySource: 'steam',
  ownedSources: ['steam'],
  status,
  position,
  pinned: position != null,
  ...extra,
});

type StubOptions = { patch?: 'ok' | 'fail' | 'deferred' };

const stubLibrary = (initialGames: LibraryGame[], options: StubOptions = {}) => {
  const state: LibraryResponse = { statuses, games: [...initialGames] };
  const patches: Array<{ url: string; body: Record<string, unknown> }> = [];
  const unpins: string[] = [];
  let releaseDeferred: (() => void) | null = null;
  const deferred = new Promise<void>(resolve => {
    releaseDeferred = resolve;
  });

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url.includes('/unpin')) {
      unpins.push(url);
      const id = decodeURIComponent(
        url.split('/api/library/games/')[1].split('/unpin')[0],
      );
      state.games = state.games.map(g =>
        g.canonicalId === id ? { ...g, pinned: false } : g,
      );
      return new Response(
        JSON.stringify({ canonicalId: id, status: 'backlog', pinned: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      patches.push({ url, body });
      if (options.patch === 'deferred' || options.patch === 'fail') await deferred;
      if (options.patch === 'fail') {
        return new Response('boom', { status: 500 });
      }
      const id = decodeURIComponent(
        url.split('/api/games/')[1].split('/status')[0],
      );
      const next = applyMove(state, {
        id,
        status: String(body.status),
        beforeId: (body.beforeId as string | null | undefined) ?? null,
        afterId: (body.afterId as string | null | undefined) ?? null,
      });
      state.games = next.games;
      return new Response(JSON.stringify({ canonicalId: id, status: body.status, position: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/library')) {
      return new Response(JSON.stringify(state), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Not found', { status: 404 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, patches, unpins, state, release: () => releaseDeferred?.() };
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardPage />
    </QueryClientProvider>
  );
};

const column = (key: string) => screen.getByTestId(`column-${key}`);

const cardsIn = (key: string) => within(column(key)).queryAllByTestId('board-card');

const renderWith = async (games: LibraryGame[], options: StubOptions = {}) => {
  const stub = stubLibrary(games, options);
  const view = renderPage();
  await waitFor(() => expect(screen.getAllByTestId('board-column')).toHaveLength(3));
  return { stub, ...view };
};

describe('BoardPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders no-status games in the Backlog column', async () => {
    await renderWith([
      game('steam:a', 'Game A'),
      game('steam:b', 'Game B', 'playing', 1),
    ]);

    expect(within(column('backlog')).getByText('Game A')).toBeInTheDocument();
    expect(within(column('playing')).getByText('Game B')).toBeInTheDocument();
    expect(within(column('playing')).queryByText('Game A')).not.toBeInTheDocument();
    expect(within(column('backlog')).queryByText('Game B')).not.toBeInTheDocument();
  });

  it('renders columns in statuses order with labels and counts, empty state for empty columns', async () => {
    await renderWith([
      game('steam:a', 'Game A'),
      game('steam:c', 'Game C'),
      game('steam:b', 'Game B', 'playing', 1),
    ]);

    const columns = screen.getAllByTestId('board-column');
    expect(columns).toHaveLength(3);
    expect(columns[0]).toHaveTextContent('Backlog');
    expect(within(columns[0]).getByTestId('column-count')).toHaveTextContent('2');
    expect(columns[1]).toHaveTextContent('Want to Play');
    expect(within(columns[1]).getByTestId('column-count')).toHaveTextContent('0');
    expect(within(columns[1]).getByText(/No games/)).toBeInTheDocument();
    expect(columns[2]).toHaveTextContent('Playing');
    expect(within(columns[2]).getByTestId('column-count')).toHaveTextContent('1');
  });

  it('opens the slide-over drawer on card click and closes it', async () => {
    const user = userEvent.setup();
    await renderWith([game('steam:a', 'Game A')]);

    await user.click(screen.getByText('Game A'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Game A')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /move to/i })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /close drawer/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('moves a game via the Move-to menu: PATCH with append neighbors + optimistic update', async () => {
    const user = userEvent.setup();
    const { stub } = await renderWith(
      [game('steam:a', 'Game A'), game('steam:b', 'Game B', 'playing', 1)],
      { patch: 'deferred' },
    );

    await user.click(screen.getByText('Game A'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /move to/i }));
    await user.click(await screen.findByRole('button', { name: 'Playing' }));

    await waitFor(() => expect(stub.patches).toHaveLength(1));
    expect(decodeURIComponent(stub.patches[0].url)).toContain(
      '/api/games/steam:a/status',
    );
    expect(stub.patches[0].body).toMatchObject({
      status: 'playing',
      beforeId: 'steam:b',
      afterId: null,
    });
    // optimistic: card sits in the target column while PATCH is still in flight
    expect(within(column('playing')).getByText('Game A')).toBeInTheDocument();
    expect(within(column('backlog')).queryByText('Game A')).not.toBeInTheDocument();
    // cross-column move: the moved card is not pinned
    const cardA = within(column('playing'))
      .getByText('Game A')
      .closest('[data-testid="board-card"]')!;
    expect(
      within(cardA as HTMLElement).queryByTestId('pin-indicator'),
    ).not.toBeInTheDocument();

    stub.release();
    await waitFor(() =>
      expect(within(column('playing')).getByText('Game A')).toBeInTheDocument(),
    );
  });

  it('rolls back the optimistic move when PATCH fails', async () => {
    const user = userEvent.setup();
    const { stub } = await renderWith(
      [game('steam:a', 'Game A'), game('steam:b', 'Game B', 'playing', 1)],
      { patch: 'fail' },
    );

    await user.click(screen.getByText('Game A'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /move to/i }));
    await user.click(await screen.findByRole('button', { name: 'Playing' }));

    // optimistic placement lands while the PATCH is in flight
    await waitFor(() =>
      expect(within(column('playing')).getByText('Game A')).toBeInTheDocument(),
    );

    stub.release();
    await waitFor(() =>
      expect(within(column('backlog')).getByText('Game A')).toBeInTheDocument(),
    );
    expect(within(column('playing')).queryByText('Game A')).not.toBeInTheDocument();
  });

  it('lazy-renders Backlog: first 50 cards then Show more', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 55 }, (_, index) =>
      game(`steam:${index}`, `Game ${index}`),
    );
    await renderWith(many);

    expect(cardsIn('backlog')).toHaveLength(50);
    expect(within(column('backlog')).queryByText('Game 54')).not.toBeInTheDocument();

    await user.click(within(column('backlog')).getByRole('button', { name: /show more/i }));

    expect(cardsIn('backlog')).toHaveLength(55);
    expect(within(column('backlog')).getByText('Game 54')).toBeInTheDocument();
    expect(
      within(column('backlog')).queryByRole('button', { name: /show more/i }),
    ).not.toBeInTheDocument();
  });

  it('filters cards by search and persists the filters to localStorage across remount', async () => {
    const user = userEvent.setup();
    const { unmount } = await renderWith([
      game('steam:a', 'Hades II'),
      game('steam:b', 'Celeste'),
    ]);

    await user.type(screen.getByPlaceholderText(/search games/i), 'Celeste');

    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();
    expect(screen.getByText('Celeste')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('gamekeeper.library.filters') ?? '{}')).toMatchObject({
      q: 'Celeste',
      source: '',
    });

    unmount();
    renderPage();
    await waitFor(() => expect(screen.getAllByTestId('board-column')).toHaveLength(3));
    expect(screen.getByText('Celeste')).toBeInTheDocument();
    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();
  });

  it('filters cards by source', async () => {
    const user = userEvent.setup();
    await renderWith([
      game('steam:a', 'Hades II'),
      game('gog:b', 'Celeste', null, null, {
        primarySource: 'gog',
        ownedSources: ['gog'],
      }),
    ]);

    await user.selectOptions(screen.getByRole('combobox'), 'gog');

    expect(screen.getByText('Celeste')).toBeInTheDocument();
    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();
    expect(within(column('backlog')).getByTestId('column-count')).toHaveTextContent('1');
  });

  it('clears the search via the clear button inside the input', async () => {
    const user = userEvent.setup();
    await renderWith([
      game('steam:a', 'Hades II'),
      game('steam:b', 'Celeste'),
    ]);

    const input = screen.getByPlaceholderText(/search games/i);
    await user.type(input, 'Celeste');
    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear search/i }));

    expect(input).toHaveValue('');
    expect(screen.getByText('Hades II')).toBeInTheDocument();
    expect(screen.getByText('Celeste')).toBeInTheDocument();
  });

  it('renders one colored badge per owned source', async () => {
    await renderWith([
      game('steam:a', 'Hades II', null, null, {
        primarySource: 'steam',
        ownedSources: ['steam', 'gog', 'epic'],
      }),
    ]);

    const card = within(column('backlog')).getByText('Hades II').closest('[data-testid="board-card"]')!;
    const badges = within(card as HTMLElement).getAllByTestId('source-badge');
    expect(badges.map(badge => badge.getAttribute('data-source'))).toEqual([
      'steam',
      'gog',
      'epic',
    ]);
  });

  it('shows the Not available badge on the card and in the drawer', async () => {
    const user = userEvent.setup();
    await renderWith([
      game('steam:a', 'Hades II'),
      game('gp:b', 'Clair Obscur: Expedition 33', null, null, {
        primarySource: 'gamepass',
        ownedSources: ['gamepass'],
        unavailableReason: 'interest-unavailable',
      }),
    ]);

    expect(within(column('backlog')).getByTestId('unavailable-badge')).toBeInTheDocument();
    expect(within(column('backlog')).getByText('Clair Obscur: Expedition 33')).toBeInTheDocument();

    await user.click(screen.getByText('Clair Obscur: Expedition 33'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('unavailable-badge')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /close drawer/i }));
    expect(within(column('backlog')).queryByText('Hades II')).toBeInTheDocument();
    expect(within(column('backlog')).getAllByTestId('board-card')).toHaveLength(2);
  });

  it('shows a pin indicator on pinned cards only', async () => {
    await renderWith([
      game('steam:a', 'Pinned Game', 'playing', 1, { pinned: true }),
      game('steam:b', 'Auto Game'),
    ]);

    const pinnedCard = within(column('playing'))
      .getByText('Pinned Game')
      .closest('[data-testid="board-card"]')!;
    expect(within(pinnedCard as HTMLElement).getByTestId('pin-indicator')).toBeInTheDocument();

    const autoCard = within(column('backlog'))
      .getByText('Auto Game')
      .closest('[data-testid="board-card"]')!;
    expect(
      within(autoCard as HTMLElement).queryByTestId('pin-indicator'),
    ).not.toBeInTheDocument();
  });

  it('unpins a game from the drawer: POST /unpin + optimistic indicator removal', async () => {
    const user = userEvent.setup();
    const { stub } = await renderWith([
      game('steam:a', 'Pinned Game', 'playing', 1, { pinned: true }),
    ]);

    await user.click(screen.getByText('Pinned Game'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /unpin/i }));

    await waitFor(() => expect(stub.unpins).toHaveLength(1));
    expect(decodeURIComponent(stub.unpins[0])).toContain(
      '/api/library/games/steam:a/unpin',
    );
    // optimistic: indicator gone while the board still shows the card
    expect(screen.queryByTestId('pin-indicator')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(within(column('playing')).getByText('Pinned Game')).toBeInTheDocument(),
    );
  });

  it('hides the Unpin button for auto (unpinned) games', async () => {
    const user = userEvent.setup();
    await renderWith([game('steam:a', 'Auto Game', 'playing', 1, { pinned: false })]);

    await user.click(screen.getByText('Auto Game'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).queryByRole('button', { name: /unpin/i }),
    ).not.toBeInTheDocument();
  });
});
