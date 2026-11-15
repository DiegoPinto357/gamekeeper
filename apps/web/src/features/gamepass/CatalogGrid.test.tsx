import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CatalogGrid } from './CatalogGrid';

const catalog = [
  { id: 'prod-1', title: 'New Verbose Title', available: true },
  { id: 'prod-2', title: 'Legacy Title', available: true },
  { id: 'prod-3', title: 'Unlisted Game', available: true },
];

const interests = [
  // id-backed row whose stored title differs from the catalog's current title
  { id: 'prod-1', title: 'Old Display Name' },
  // legacy manual: row — only the title can match
  { id: 'manual:legacy', title: 'Legacy Title' },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const stubFetch = () => {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.endsWith('/api/catalog')) return json(catalog);
      if (url.endsWith('/api/interests')) {
        return json(method === 'GET' ? { interests } : { interests });
      }
      return new Response('Not found', { status: 404 });
    },
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const renderGrid = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CatalogGrid />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CatalogGrid interests membership (P0B rekey)', () => {
  it('marks id-backed rows interested even when titles differ', async () => {
    stubFetch();
    renderGrid();

    // id prod-1 matches the catalog row; stored title ("Old Display
    // Name") does not match the catalog title ("New Verbose Title")
    const [card] = await screen.findAllByText('New Verbose Title');
    expect(within(card.closest('div.group') as HTMLElement).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('marks legacy manual rows interested via the title fallback', async () => {
    stubFetch();
    renderGrid();

    const [legacyText] = await screen.findAllByText('Legacy Title');
    const legacyCard = legacyText.closest('div.group') as HTMLElement;
    expect(within(legacyCard).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('shows unlisted games as not interested and the interest count', async () => {
    stubFetch();
    renderGrid();

    const [unlistedText] = await screen.findAllByText('Unlisted Game');
    const unlistedCard = unlistedText.closest('div.group') as HTMLElement;
    expect(
      within(unlistedCard).getByRole('button', { name: 'Add to Interests' }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 interests')).toBeInTheDocument();
  });

  it('POSTs the catalog product id when adding an interest', async () => {
    const fetchMock = stubFetch();
    renderGrid();

    const [unlistedText] = await screen.findAllByText('Unlisted Game');
    const unlistedCard = unlistedText.closest('div.group') as HTMLElement;
    await userEvent.click(
      within(unlistedCard).getByRole('button', { name: 'Add to Interests' }),
    );

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([, init]) => init?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(String(post![0])).toContain('/api/interests');
      expect(JSON.parse(String(post![1]?.body))).toEqual({
        name: 'Unlisted Game',
        id: 'prod-3',
      });
    });
  });

  it('DELETEs by title when removing an interest', async () => {
    const fetchMock = stubFetch();
    renderGrid();

    const [legacyText] = await screen.findAllByText('Legacy Title');
    const legacyCard = legacyText.closest('div.group') as HTMLElement;
    await userEvent.click(
      within(legacyCard).getByRole('button', { name: 'Remove' }),
    );

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(
        ([, init]) => init?.method === 'DELETE',
      );
      expect(del).toBeDefined();
      expect(String(del![0])).toContain(
        `/api/interests/${encodeURIComponent('Legacy Title')}`,
      );
    });
  });
});
