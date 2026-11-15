import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';

const statuses = [
  { key: 'backlog', label: 'Backlog', color: '#64748b', position: 0 },
  { key: 'want_to_play', label: 'Want to Play', color: '#eab308', position: 1 },
  { key: 'queued_to_play', label: 'Up Next', color: '#f97316', position: 2 },
];

const ownedGames = [
  {
    canonicalId: 'manual:hades',
    name: 'Hades',
    platform: 'xbox',
    notes: null,
  },
];

const rules = [
  { id: 1, games: ['Disco Elysium', 'Disco Elysium - The Final Cut'] },
  { id: 2, games: ['Halo', 'Halo: CE'], canonicalName: 'Halo' },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

type StubState = {
  statuses: typeof statuses;
  ownedGames: typeof ownedGames;
  rules: typeof rules;
};

const stubFetch = (overrides: Partial<StubState> = {}) => {
  const state: StubState = {
    statuses: overrides.statuses ?? statuses,
    ownedGames: overrides.ownedGames ?? ownedGames,
    rules: overrides.rules ?? rules,
  };
  const calls: { method: string; url: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });

    if (url.endsWith('/api/statuses')) {
      if (method === 'PUT') {
        state.statuses = (body as { statuses: typeof statuses }).statuses;
        return json({ statuses: state.statuses });
      }
      return json({ statuses: state.statuses });
    }
    if (url.endsWith('/api/owned-games')) {
      if (method === 'POST') {
        const input = body as { name: string; platform?: string };
        state.ownedGames = [
          ...state.ownedGames,
          {
            canonicalId: `manual:${input.name.toLowerCase().replace(/\s+/g, '-')}`,
            name: input.name,
            platform: input.platform ?? 'xbox',
            notes: null,
          },
        ];
        return json({ ownedGames: state.ownedGames });
      }
      return json({ ownedGames: state.ownedGames });
    }
    if (url.includes('/api/owned-games/')) {
      if (method === 'DELETE') {
        const id = decodeURIComponent(url.split('/').pop() ?? '');
        state.ownedGames = state.ownedGames.filter(g => g.canonicalId !== id);
        return json({ ownedGames: state.ownedGames });
      }
    }
    if (url.endsWith('/api/force-merge-rules')) {
      if (method === 'POST') {
        const input = body as { games: string[]; canonicalName?: string };
        const rule = { id: state.rules.length + 1, ...input };
        state.rules = [...state.rules, rule];
        return json({ rules: state.rules });
      }
      return json({ rules: state.rules });
    }
    if (url.includes('/api/force-merge-rules/')) {
      const id = Number(url.split('/').pop());
      if (method === 'PATCH') {
        const input = body as { games: string[]; canonicalName?: string };
        state.rules = state.rules.map(rule =>
          rule.id === id ? { id, ...input } : rule,
        );
        return json({ rules: state.rules });
      }
      if (method === 'DELETE') {
        state.rules = state.rules.filter(rule => rule.id !== id);
        return json({ rules: state.rules });
      }
    }
    return new Response('Not found', { status: 404 });
  });

  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, state };
};

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SettingsPage', () => {
  it('renders all three sections with their data', async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByTestId('settings-page')).toBeInTheDocument();
    expect(await screen.findByTestId('settings-statuses')).toBeInTheDocument();
    expect(await screen.findByTestId('settings-owned-games')).toBeInTheDocument();
    expect(await screen.findByTestId('settings-force-merge')).toBeInTheDocument();

    expect(await screen.findByLabelText('Label for backlog')).toHaveValue('Backlog');
    expect(await screen.findByText('Hades')).toBeInTheDocument();
    expect(
      await screen.findByText(/Disco Elysium, Disco Elysium - The Final Cut/),
    ).toBeInTheDocument();
  });

  it('saves an edited status label via PUT with the full list', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    const label = await screen.findByLabelText('Label for backlog');
    await user.clear(label);
    await user.type(label, 'To Do');

    const save = screen.getByRole('button', { name: 'Save statuses' });
    expect(save).toBeEnabled();
    await user.click(save);

    await screen.findByText('Statuses saved');
    const put = calls.find(c => c.method === 'PUT');
    expect(put).toBeDefined();
    const sent = (put?.body as { statuses: { key: string; label: string }[] }).statuses;
    expect(sent).toHaveLength(3);
    expect(sent[0]).toMatchObject({ key: 'backlog', label: 'To Do' });
    expect(sent[1].key).toBe('want_to_play');
  });

  it('reorders statuses with the move buttons', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    const down = await screen.findByRole('button', { name: 'Move Backlog down' });
    await user.click(down);
    await user.click(screen.getByRole('button', { name: 'Save statuses' }));

    await screen.findByText('Statuses saved');
    const put = calls.find(c => c.method === 'PUT');
    const sent = (put?.body as { statuses: { key: string }[] }).statuses;
    expect(sent.map(s => s.key)).toEqual([
      'want_to_play',
      'backlog',
      'queued_to_play',
    ]);
  });

  it('keeps Save disabled until the form is dirty', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPage();

    const save = await screen.findByRole('button', { name: 'Save statuses' });
    expect(save).toBeDisabled();

    await user.type(await screen.findByLabelText('Label for backlog'), '!');
    expect(screen.getByRole('button', { name: 'Save statuses' })).toBeEnabled();
  });

  it('adds an owned game', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Game name'), 'TUNIC');
    await user.click(screen.getByRole('button', { name: 'Add game' }));

    await screen.findByText(/TUNIC/);
    const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/api/owned-games'));
    expect(post?.body).toEqual({ name: 'TUNIC', platform: 'xbox' });
  });

  it('removes an owned game', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Remove Hades' }));

    await waitFor(() => {
      expect(screen.queryByText('Hades')).not.toBeInTheDocument();
    });
    const del = calls.find(c => c.method === 'DELETE');
    expect(del?.url).toContain('/api/owned-games/manual%3Ahades');
  });

  it('adds a force-merge rule with parsed games and optional canonical name', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.type(
      await screen.findByLabelText('Games to merge'),
      'Outer Wilds, Outer Wilds: Echoes of the Eye',
    );
    await user.type(screen.getByLabelText('Canonical name'), 'Outer Wilds');
    await user.click(screen.getByRole('button', { name: 'Add rule' }));

    await screen.findByText(/Outer Wilds, Outer Wilds: Echoes of the Eye → Outer Wilds/);
    const post = calls.find(c => c.method === 'POST' && c.url.endsWith('/api/force-merge-rules'));
    expect(post?.body).toEqual({
      games: ['Outer Wilds', 'Outer Wilds: Echoes of the Eye'],
      canonicalName: 'Outer Wilds',
    });
  });

  it('edits a force-merge rule through the prefilled form', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Edit rule Disco Elysium' }),
    );
    const games = screen.getByLabelText('Games to merge');
    expect(games).toHaveValue('Disco Elysium, Disco Elysium - The Final Cut');

    await user.clear(games);
    await user.type(games, 'Disco Elysium, DE Final Cut');
    await user.click(screen.getByRole('button', { name: 'Save rule' }));

    await screen.findByText(/Disco Elysium, DE Final Cut/);
    const patch = calls.find(c => c.method === 'PATCH');
    expect(patch?.url).toContain('/api/force-merge-rules/1');
    expect(patch?.body).toEqual({ games: ['Disco Elysium', 'DE Final Cut'] });
  });

  it('deletes a force-merge rule', async () => {
    const { calls } = stubFetch();
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole('button', { name: 'Remove rule Halo' }),
    );

    await waitFor(() => {
      expect(screen.queryByText(/Halo, Halo: CE/)).not.toBeInTheDocument();
    });
    const del = calls.find(c => c.method === 'DELETE');
    expect(del?.url).toContain('/api/force-merge-rules/2');
  });

  it('shows an error state when statuses fail to load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    renderPage();

    expect(await screen.findByText('Failed to load statuses')).toBeInTheDocument();
  });
});
