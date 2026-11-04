import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterSidebar, type FilterGroup } from './FilterSidebar';

const groups: FilterGroup[] = [
  {
    dim: 'genres',
    title: 'Genre',
    facets: [
      { value: 'Action', count: 2 },
      { value: 'Platformer', count: 1 },
    ],
    selected: [],
  },
  {
    dim: 'tags',
    title: 'Tags',
    facets: [
      { value: 'space', count: 3 },
      { value: 'want_to_play', count: 1 },
    ],
    selected: [],
  },
];

type Overrides = Partial<Parameters<typeof FilterSidebar>[0]>;

const renderSidebar = (overrides: Overrides = {}) => {
  const handlers = {
    onToggle: vi.fn(),
    onClear: vi.fn(),
    onToggleFacet: vi.fn(),
  };
  const view = render(
    <FilterSidebar
      open
      canClear
      groups={groups}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, ...view };
};

describe('FilterSidebar', () => {
  it('collapses to an icon and expands again', async () => {
    const user = userEvent.setup();
    const { onToggle, rerender } = renderSidebar();

    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();

    await user.click(screen.getByTestId('filter-panel-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    // the parent flips `open`; closed state is the icon toggle only
    const expandToggle = vi.fn();
    rerender(
      <FilterSidebar
        open={false}
        canClear={false}
        groups={groups}
        onToggle={expandToggle}
        onClear={vi.fn()}
        onToggleFacet={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('facet-genres-Action')).not.toBeInTheDocument();
    expect(screen.queryByTestId('filter-search')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show filters' }),
    ).toHaveAttribute('aria-expanded', 'false');

    // and the icon click asks the parent to expand again
    await user.click(screen.getByRole('button', { name: 'Show filters' }));
    expect(expandToggle).toHaveBeenCalledTimes(1);
    rerender(
      <FilterSidebar
        open
        canClear
        groups={groups}
        onToggle={vi.fn()}
        onClear={vi.fn()}
        onToggleFacet={vi.fn()}
      />,
    );
    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();
  });

  it('narrows chips across every group as you type', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.type(screen.getByTestId('filter-search'), 'act');

    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();
    expect(screen.queryByTestId('facet-genres-Platformer')).not.toBeInTheDocument();
    // no tag matches "act" → the whole Tags section disappears
    expect(screen.queryByTestId('facet-section-tags')).not.toBeInTheDocument();

    await user.clear(screen.getByTestId('filter-search'));
    await user.type(screen.getByTestId('filter-search'), 'want to play');

    // underscored values match their spaced label
    expect(screen.getByTestId('facet-tags-want_to_play')).toBeInTheDocument();
    expect(screen.queryByTestId('facet-genres-Action')).not.toBeInTheDocument();
  });

  it('keeps selected chips visible while searching', async () => {
    const user = userEvent.setup();
    renderSidebar({ groups: [{ ...groups[0], selected: ['Platformer'] }] });

    await user.type(screen.getByTestId('filter-search'), 'action');

    expect(screen.getByTestId('facet-genres-Action')).toBeInTheDocument();
    // selected, non-matching chip stays put
    expect(screen.getByTestId('facet-genres-Platformer')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('shows an empty message when nothing matches', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.type(screen.getByTestId('filter-search'), 'zzz');

    expect(screen.getByTestId('filter-search-empty')).toHaveTextContent(
      'No filters match “zzz”.',
    );
  });

  it('clears every filter through the shared button', async () => {
    const user = userEvent.setup();
    const handlers = renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));
    expect(handlers.onClear).toHaveBeenCalledTimes(1);
  });

  it('disables clear when there is nothing active and shows the active count', () => {
    renderSidebar({
      canClear: false,
      groups: [{ ...groups[0], selected: ['Action'] }, groups[1]],
    });

    expect(
      screen.getByRole('button', { name: 'Clear all filters' }),
    ).toBeDisabled();
    expect(screen.getByTestId('filter-active-count')).toHaveTextContent('1');
  });

  it('toggles facets through the shared callback', async () => {
    const user = userEvent.setup();
    const handlers = renderSidebar();

    await user.click(screen.getByTestId('facet-genres-Action'));
    expect(handlers.onToggleFacet).toHaveBeenCalledWith('genres', 'Action');
  });
});
