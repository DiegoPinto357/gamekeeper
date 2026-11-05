import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SimilarResponse } from '@gamekeeper/shared';
import { SimilarGames } from './SimilarGames';

const similarBody: SimilarResponse = {
  similar: [
    {
      canonicalId: 'hades',
      name: 'Hades',
      coverImageUrl: 'https://cdn/hades.jpg',
      status: 'completed',
      origin: 'igdb',
      score: null,
      rank: 1,
    },
    {
      canonicalId: 'celeste',
      name: 'Celeste',
      coverImageUrl: null,
      status: 'want_to_play',
      origin: 'overlap',
      score: 0.76,
      rank: null,
    },
  ],
};

const stubSimilar = (body: unknown, ok = true) => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: ok ? 200 : 500,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const renderSimilar = (onSelect = vi.fn()) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SimilarGames canonicalId="hades-ii" onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { onSelect };
};

describe('SimilarGames', () => {
  beforeEach(() => {
    stubSimilar(similarBody);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders rows with status and origin badges', async () => {
    renderSimilar();

    expect(await screen.findByTestId('similar-games')).toBeInTheDocument();
    const rows = screen.getAllByTestId('similar-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Hades');
    expect(rows[0]).toHaveTextContent('completed');
    expect(rows[0]).toHaveTextContent('IGDB similar');
    expect(rows[1]).toHaveTextContent('Celeste');
    expect(rows[1]).toHaveTextContent('want to play');
    expect(rows[1]).toHaveTextContent('76% match');
  });

  it('reports the clicked game to the hosting dialog', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSimilar();

    const rows = await screen.findAllByTestId('similar-row');
    await user.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith('hades');

    await user.click(rows[1]);
    expect(onSelect).toHaveBeenCalledWith('celeste');
  });

  it('renders nothing when the list is empty', async () => {
    const fetchMock = stubSimilar({ similar: [] });
    renderSimilar();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByTestId('similar-games')).not.toBeInTheDocument();
  });

  it('renders nothing when the request fails', async () => {
    const fetchMock = stubSimilar({ error: 'boom' }, false);
    renderSimilar();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByTestId('similar-games')).not.toBeInTheDocument();
  });
});
