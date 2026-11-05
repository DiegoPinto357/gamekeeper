import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { GameDrawer } from './GameDrawer';

const statuses: StatusEntry[] = [
  { key: 'backlog', label: 'Backlog', color: '#888', position: 0 },
  { key: 'playing', label: 'Playing', color: '#0a0', position: 1 },
];

const baseGame: LibraryGame = {
  canonicalId: 'hades-ii',
  name: 'Hades II',
  primarySource: 'steam',
  ownedSources: ['steam'],
  status: null,
  position: null,
  pinned: false,
};

const stubSimilar = (body: unknown) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
};

beforeEach(() => {
  stubSimilar({ similar: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderDrawer = (
  game: LibraryGame,
  extra: { onSelectGame?: (canonicalId: string) => void } = {},
) => {
  const onClose = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <GameDrawer
        game={game}
        statuses={statuses}
        onClose={onClose}
        onMove={vi.fn()}
        {...extra}
      />
    </QueryClientProvider>,
  );
  return { onClose };
};

describe('GameDrawer store links', () => {
  it('links the exact Steam page and ProtonDB when the app id is known', () => {
    renderDrawer({ ...baseGame, steamAppId: 1145350 });

    const steam = screen.getByTestId('game-link-steam');
    expect(steam).toHaveAttribute('href', 'https://store.steampowered.com/app/1145350');
    expect(steam).toHaveAttribute('target', '_blank');
    expect(steam).toHaveAttribute('rel', expect.stringContaining('noopener'));

    const protondb = screen.getByTestId('game-link-protondb');
    expect(protondb).toHaveAttribute('href', 'https://www.protondb.com/app/1145350');
    expect(screen.getByText('ProtonDB')).toBeInTheDocument();
  });

  it('falls back to a store search link without an app id', () => {
    renderDrawer({ ...baseGame, steamAppId: undefined });

    expect(screen.getByTestId('game-link-steam')).toHaveAttribute(
      'href',
      'https://store.steampowered.com/search/?term=Hades%20II',
    );
    expect(screen.queryByTestId('game-link-protondb')).not.toBeInTheDocument();
  });

  it('picks the highest-precedence store among owned sources', () => {
    renderDrawer({
      ...baseGame,
      primarySource: 'gog',
      ownedSources: ['gog', 'epic'],
    });

    expect(screen.getByTestId('game-link-epic')).toHaveAttribute(
      'href',
      'https://store.epicgames.com/en-US/browse?q=Hades%20II',
    );
    expect(screen.queryByTestId('game-link-gog')).not.toBeInTheDocument();
  });

  it('renders no links row for manual-only sources', () => {
    renderDrawer({
      ...baseGame,
      primarySource: 'manual',
      ownedSources: ['manual'],
    });

    expect(screen.queryByTestId('drawer-links')).not.toBeInTheDocument();
  });
});

describe('GameDrawer screenshots', () => {
  it('renders the gallery when screenshots are resolved', () => {
    renderDrawer({
      ...baseGame,
      screenshots: ['https://cdn/one.jpg', 'https://cdn/two.jpg'],
    });

    expect(screen.getByTestId('screenshot-gallery')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hades II screenshot' })).toHaveAttribute(
      'src',
      'https://cdn/one.jpg',
    );
  });

  it('omits the gallery when there are no screenshots', () => {
    renderDrawer({ ...baseGame, screenshots: undefined });

    expect(screen.queryByTestId('screenshot-gallery')).not.toBeInTheDocument();
  });

  it('omits the gallery for an empty resolved list', () => {
    renderDrawer({ ...baseGame, screenshots: [] });

    expect(screen.queryByTestId('screenshot-gallery')).not.toBeInTheDocument();
  });
});

describe('GameDrawer dismissal', () => {
  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer(baseGame);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unwraps stacked overlays: Escape closes the lightbox first, then the drawer', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDrawer({
      ...baseGame,
      screenshots: ['https://cdn/one.jpg', 'https://cdn/two.jpg'],
    });

    await user.click(
      screen.getByRole('button', { name: 'View Hades II screenshots fullscreen' }),
    );
    expect(screen.getByTestId('screenshot-lightbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('screenshot-lightbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Details: Hades II' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lists similar games and swaps the drawer through onSelectGame', async () => {
    stubSimilar({
      similar: [
        {
          canonicalId: 'hades',
          name: 'Hades',
          coverImageUrl: null,
          status: 'completed',
          origin: 'igdb',
          score: null,
          rank: 1,
        },
      ],
    });
    const user = userEvent.setup();
    const onSelectGame = vi.fn();
    renderDrawer(baseGame, { onSelectGame });

    const row = await screen.findByTestId('similar-row');
    expect(row).toHaveTextContent('Hades');
    expect(row).toHaveTextContent('IGDB similar');

    await user.click(row);
    expect(onSelectGame).toHaveBeenCalledWith('hades');
  });
});
