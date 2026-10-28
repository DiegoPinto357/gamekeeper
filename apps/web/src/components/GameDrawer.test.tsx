import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const renderDrawer = (game: LibraryGame) =>
  render(
    <GameDrawer
      game={game}
      statuses={statuses}
      onClose={vi.fn()}
      onMove={vi.fn()}
    />,
  );

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
