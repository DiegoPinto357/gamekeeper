import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GameDrawer } from '@/components/GameDrawer';
import { useDiscoverFacets, useDiscoverGames } from '@/hooks/useDiscover';
import { useLibrary, useMoveGame } from '@/lib/library';
import { DiscoverCard } from './DiscoverCard';
import { FacetChips } from './FacetChips';
import type { DiscoverGame, LibraryGame } from '@gamekeeper/shared';
import {
  EMPTY_SELECTION,
  SORT_LABELS,
  hasActiveFilters,
  parseSelection,
  selectionToQueryString,
  sortGames,
  toggleInList,
  type DiscoverDimension,
  type DiscoverSelection,
  type SortKey,
} from './discover-utils';

const DEBOUNCE_MS = 300;

const toDrawerGame = (game: DiscoverGame): LibraryGame => ({
  canonicalId: game.canonicalId,
  name: game.name,
  coverImageUrl: game.coverImageUrl,
  playtimeHours: game.playtimeHours,
  primarySource: game.primarySource,
  ownedSources: game.ownedSources,
  status: game.status,
  position: null,
  pinned: false,
  unavailableReason: game.unavailableReason,
  steamAppId: game.steamAppId,
  proton: game.protonTier
    ? { tier: game.protonTier, steamDeck: game.deck ?? 'unknown' }
    : undefined,
});

export function DiscoverPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = useMemo(() => parseSelection(searchParams), [searchParams]);
  const qs = useMemo(() => selectionToQueryString(selection), [selection]);

  const { data: results, isPending, isError } = useDiscoverGames(qs);
  const { data: facets } = useDiscoverFacets(qs);
  const { data: library } = useLibrary();
  const moveGame = useMoveGame();
  const queryClient = useQueryClient();

  const [sort, setSort] = useState<SortKey>('name');
  const [qInput, setQInput] = useState(selection.q);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const update = (next: DiscoverSelection) => {
    setSearchParams(new URLSearchParams(selectionToQueryString(next)));
  };

  // keep the input in sync when the URL changes underneath us (clear-all, back button)
  useEffect(() => {
    setQInput(selection.q);
  }, [selection.q]);

  // commit search text to the URL after a pause in typing
  useEffect(() => {
    if (qInput === selection.q) return;
    const timer = setTimeout(() => {
      update({ ...selection, q: qInput });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput, selection]);

  const toggleFacet = (dim: DiscoverDimension, value: string | number) => {
    const current = selection[dim] as Array<string | number>;
    update({ ...selection, [dim]: toggleInList(current, value) } as DiscoverSelection);
  };

  const games = useMemo(
    () => sortGames(results?.games ?? [], sort),
    [results, sort],
  );

  const statuses = library?.statuses ?? [];
  const selectedGame = selectedId
    ? (results?.games.find(game => game.canonicalId === selectedId) ?? null)
    : null;

  const handleMoveTo = (statusKey: string) => {
    if (!selectedGame) return;
    moveGame.mutate(
      {
        id: selectedGame.canonicalId,
        status: statusKey,
        beforeId: null,
        afterId: null,
      },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: ['discover'] });
        },
      },
    );
  };

  return (
    <div data-testid="discover-page" className="flex h-full min-h-0 gap-6">
      <aside className="w-60 shrink-0 overflow-y-auto pb-4 pr-2">
        <Button
          variant="outline"
          size="sm"
          className="mb-4 w-full"
          disabled={!hasActiveFilters(selection)}
          onClick={() => update(EMPTY_SELECTION)}
        >
          Clear all filters
        </Button>
        <FacetChips
          dim="statuses"
          title="Status"
          facets={facets?.statuses ?? []}
          selected={selection.statuses}
          onToggle={toggleFacet}
        />
        <FacetChips
          dim="genres"
          title="Genre"
          facets={facets?.genres ?? []}
          selected={selection.genres}
          onToggle={toggleFacet}
        />
        <FacetChips
          dim="tags"
          title="Tags"
          facets={facets?.tags ?? []}
          selected={selection.tags}
          onToggle={toggleFacet}
        />
        <FacetChips
          dim="sources"
          title="Source"
          facets={facets?.sources ?? []}
          selected={selection.sources}
          onToggle={toggleFacet}
        />
        <FacetChips
          dim="decks"
          title="Steam Deck"
          facets={facets?.decks ?? []}
          selected={selection.decks}
          onToggle={toggleFacet}
        />
        <FacetChips
          dim="protonTiers"
          title="ProtonDB"
          facets={facets?.protonTiers ?? []}
          selected={selection.protonTiers}
          onToggle={toggleFacet}
        />
        <FacetChips
          dim="years"
          title="Year"
          facets={facets?.years ?? []}
          selected={selection.years}
          onToggle={toggleFacet}
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
          <div className="relative w-64">
            <Input
              placeholder="Search games…"
              aria-label="Search games"
              value={qInput}
              onChange={event => setQInput(event.target.value)}
              className="w-full pr-9"
            />
            {qInput && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQInput('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Sort
            <select
              aria-label="Sort by"
              value={sort}
              onChange={event => setSort(event.target.value as SortKey)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-auto text-sm text-muted-foreground" data-testid="discover-total">
            {results ? `${games.length} games` : '…'}
          </span>
        </div>

        {isPending && (
          <p className="py-24 text-center text-muted-foreground">Loading games…</p>
        )}
        {isError && (
          <p className="py-24 text-center text-destructive">Couldn&apos;t load games.</p>
        )}
        {!isPending && !isError && games.length === 0 && (
          <p className="py-24 text-center text-muted-foreground" data-testid="discover-empty">
            No games match the current filters.
          </p>
        )}

        {!isPending && !isError && games.length > 0 && (
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {games.map(game => (
                <DiscoverCard
                  key={game.canonicalId}
                  game={game}
                  onClick={() => setSelectedId(game.canonicalId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedGame && (
        <GameDrawer
          game={toDrawerGame(selectedGame)}
          statuses={statuses}
          onClose={() => setSelectedId(null)}
          onMove={handleMoveTo}
        />
      )}
    </div>
  );
}
