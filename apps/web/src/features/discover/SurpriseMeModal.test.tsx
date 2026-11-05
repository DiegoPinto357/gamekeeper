import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DiscoverGame } from '@gamekeeper/shared';
import { SurpriseMeModal } from './SurpriseMeModal';

const game = (canonicalId: string, name: string): DiscoverGame => ({
  canonicalId,
  name,
  primarySource: 'steam',
  ownedSources: ['steam'],
  status: 'backlog',
  genres: ['Roguelike'],
  tags: [],
  year: 2024,
});

type Overrides = Partial<Parameters<typeof SurpriseMeModal>[0]>;

const renderModal = (overrides: Overrides = {}) => {
  const handlers = {
    onSpinAgain: vi.fn(),
    onOpen: vi.fn(),
    onMove: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <SurpriseMeModal
      loading={false}
      error={false}
      game={game('celeste', 'Celeste')}
      reasons={['Backlog', 'Never played']}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
};

describe('SurpriseMeModal', () => {
  it('shows the pick with reason chips and fires all three actions', async () => {
    const user = userEvent.setup();
    const handlers = renderModal();

    expect(screen.getByTestId('suggest-game-name')).toHaveTextContent('Celeste');
    const reasons = screen.getByTestId('suggest-reasons');
    expect(reasons).toHaveTextContent('Backlog');
    expect(reasons).toHaveTextContent('Never played');

    await user.click(screen.getByTestId('suggest-spin'));
    expect(handlers.onSpinAgain).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('suggest-open'));
    expect(handlers.onOpen).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: 'celeste' }));

    await user.click(screen.getByRole('button', { name: 'Move to want-to-play' }));
    expect(handlers.onMove).toHaveBeenCalledWith(expect.objectContaining({ canonicalId: 'celeste' }));
  });

  it('shows a loading state without actions', () => {
    renderModal({ loading: true, game: null, reasons: [] });
    expect(screen.getByRole('status')).toHaveTextContent('Picking a game…');
    expect(screen.queryByTestId('suggest-spin')).not.toBeInTheDocument();
  });

  it('offers a retry when the request fails', async () => {
    const user = userEvent.setup();
    const handlers = renderModal({ error: true, game: null, reasons: [] });
    expect(screen.getByText("Couldn't pick a game.")).toBeInTheDocument();
    await user.click(screen.getByTestId('suggest-retry'));
    expect(handlers.onSpinAgain).toHaveBeenCalledTimes(1);
  });

  it('explains an empty pool and offers to start over', async () => {
    const user = userEvent.setup();
    const handlers = renderModal({ game: null, reasons: [] });
    expect(screen.getByText('Nothing eligible right now.')).toBeInTheDocument();
    await user.click(screen.getByTestId('suggest-spin'));
    expect(screen.getByRole('button', { name: /Start over/ })).toBeInTheDocument();
    expect(handlers.onSpinAgain).toHaveBeenCalledTimes(1);
  });

  it('closes from the close button and from the backdrop', async () => {
    const user = userEvent.setup();
    const handlers = renderModal();

    await user.click(screen.getByRole('button', { name: 'Close suggestion' }));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('suggest-backdrop'));
    expect(handlers.onClose).toHaveBeenCalledTimes(2);
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    const handlers = renderModal();

    await user.keyboard('{Escape}');
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it('is a labelled modal dialog', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Surprise me' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
  });
});
