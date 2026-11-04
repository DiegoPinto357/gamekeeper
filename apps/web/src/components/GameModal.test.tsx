import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { GameModal } from './GameModal';

const statuses: StatusEntry[] = [
  { key: 'backlog', label: 'Backlog', color: '#888', position: 0 },
  { key: 'playing', label: 'Playing', color: '#0a0', position: 1 },
];

const baseGame: LibraryGame = {
  canonicalId: 'hades-ii',
  name: 'Hades II',
  coverImageUrl: 'https://cdn/cover.jpg',
  primarySource: 'steam',
  ownedSources: ['steam'],
  status: 'backlog',
  position: null,
  pinned: false,
  steamAppId: 1145350,
  playtimeHours: 12,
  proton: { tier: 'gold', steamDeck: 'verified' },
  screenshots: ['https://cdn/one.jpg', 'https://cdn/two.jpg'],
};

const renderModal = (game: LibraryGame = baseGame, onMove = vi.fn()) => {
  const onClose = vi.fn();
  render(
    <GameModal game={game} statuses={statuses} onClose={onClose} onMove={onMove} />,
  );
  return { onClose, onMove };
};

describe('GameModal', () => {
  it('is a labelled modal dialog with the full detail content', () => {
    renderModal();

    const dialog = screen.getByRole('dialog', { name: 'Details: Hades II' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('game-modal')).toBeInTheDocument();
    // detail block shared with the drawer
    expect(screen.getByTestId('drawer-links')).toBeInTheDocument();
    expect(screen.getByTestId('game-link-steam')).toHaveAttribute(
      'href',
      'https://store.steampowered.com/app/1145350',
    );
    expect(screen.getByTestId('game-link-protondb')).toBeInTheDocument();
    expect(screen.getByText('12h played')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('features the screenshot gallery above a secondary cover', () => {
    renderModal();

    expect(screen.getByTestId('screenshot-gallery')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hades II' })).toHaveAttribute(
      'src',
      'https://cdn/cover.jpg',
    );
    // gallery comes first in the layout — screenshots are the headline
    const gallery = screen.getByTestId('screenshot-gallery');
    const cover = screen.getByRole('img', { name: 'Hades II' });
    expect(
      gallery.compareDocumentPosition(cover) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('omits the gallery and still shows the cover when there are no screenshots', () => {
    renderModal({ ...baseGame, screenshots: [] });

    expect(screen.queryByTestId('screenshot-gallery')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Hades II' })).toBeInTheDocument();
  });

  it('opens the fullscreen lightbox from the featured gallery', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(
      screen.getByRole('button', { name: 'View Hades II screenshots fullscreen' }),
    );
    expect(screen.getByTestId('screenshot-lightbox')).toBeInTheDocument();
    expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 2');
  });

  it('moves the game through the shared move menu', async () => {
    const user = userEvent.setup();
    const { onMove } = renderModal();

    await user.click(screen.getByRole('button', { name: /Move to/ }));
    await user.click(screen.getByRole('button', { name: 'Playing' }));

    expect(onMove).toHaveBeenCalledWith('playing');
  });

  it('closes from the close button and from the backdrop', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('game-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
