import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Dices, Shuffle } from 'lucide-react';
import type { DiscoverGame, LibraryGame } from '@gamekeeper/shared';
import { Button } from '@/components/ui/button';
import { GameModal } from '@/components/GameModal';
import { FilterSidebar, type FilterGroup } from '@/components/FilterSidebar';
import { LibraryCard } from '@/features/library/LibraryCard';
import {
  EMPTY_SELECTION,
  hasActiveFilters,
  parseSelection,
  selectionToQueryString,
  toDrawerGame,
  toggleInList,
  type LibraryDimension,
  type LibrarySelection,
} from '@/features/library/library-utils';
import { useBrowseFacets, useHub, useSuggest } from '@/hooks/useBrowse';
import { useBoard, useMoveGame } from '@/lib/board';
import { SurpriseMeModal } from './SurpriseMeModal';

const randomSeed = () => Math.floor(Math.random() * 1_000_000_000);

export function DiscoverHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = useMemo(() => parseSelection(searchParams), [searchParams]);
  const qs = useMemo(() => selectionToQueryString(selection), [selection]);

  const [seed, setSeed] = useState(randomSeed);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [exclude, setExclude] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isPending, isError } = useHub(qs, seed);
  const { data: facets } = useBrowseFacets(qs);
  const { data: library } = useBoard();
  const suggest = useSuggest(qs, exclude, suggestOpen);
  const moveGame = useMoveGame();
  const queryClient = useQueryClient();

  const update = (next: LibrarySelection) => {
    setSearchParams(new URLSearchParams(selectionToQueryString(next)));
  };

  const toggleFacet = (dim: LibraryDimension, value: string | number) => {
    const current = selection[dim] as Array<string | number>;
    update({ ...selection, [dim]: toggleInList(current, value) } as LibrarySelection);
  };

  const shelves = data?.shelves ?? [];
  const statuses = library?.statuses ?? [];
  const allGames = shelves.flatMap(shelf => shelf.games);
  const uniquePicks = new Set(allGames.map(game => game.canonicalId)).size;
  // The modal follows selectedId: shelves first (current filters), then the
  // full library — so swapping to a similar game outside the shelves works.
  const selectedGame: LibraryGame | null = (() => {
    if (!selectedId) return null;
    const fromShelves = allGames.find(game => game.canonicalId === selectedId);
    if (fromShelves) return toDrawerGame(fromShelves);
    return library?.games.find(game => game.canonicalId === selectedId) ?? null;
  })();

  const handleMoveTo = (canonicalId: string, statusKey: string) => {
    moveGame.mutate(
      { id: canonicalId, status: statusKey, beforeId: null, afterId: null },
      {
        onSettled: () => {
          void queryClient.invalidateQueries({ queryKey: ['library'] });
          void queryClient.invalidateQueries({ queryKey: ['discover'] });
        },
      },
    );
  };

  const openSuggest = () => {
    setExclude([]);
    setSuggestOpen(true);
  };

  const handleSpin = () => {
    const shown = suggest.data?.game;
    if (shown) {
      setExclude(prev => [...prev, shown.canonicalId]);
    } else if (exclude.length > 0) {
      setExclude([]);
    } else {
      void queryClient.invalidateQueries({ queryKey: ['discover', 'suggest'] });
    }
  };

  const handleOpen = (game: DiscoverGame) => {
    setSuggestOpen(false);
    setSelectedId(game.canonicalId);
  };

  const handleMoveFromSuggest = (game: DiscoverGame) => {
    setSuggestOpen(false);
    handleMoveTo(game.canonicalId, 'want_to_play');
  };

  const filterGroups: FilterGroup[] = [
    { dim: 'statuses', title: 'Status', facets: facets?.statuses ?? [], selected: selection.statuses },
    { dim: 'genres', title: 'Genre', facets: facets?.genres ?? [], selected: selection.genres },
    { dim: 'tags', title: 'Tags', facets: facets?.tags ?? [], selected: selection.tags },
  ];

  return (
    <div data-testid="discover-page" className="flex h-full min-h-0 gap-6">
      <FilterSidebar
        open={filtersOpen}
        onToggle={() => setFiltersOpen(open => !open)}
        onClear={() => update(EMPTY_SELECTION)}
        canClear={hasActiveFilters(selection)}
        groups={filterGroups}
        onToggleFacet={toggleFacet}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
          <Button onClick={openSuggest} data-testid="surprise-me">
            <Dices aria-hidden />
            Surprise me
          </Button>
          <Button
            variant="outline"
            onClick={() => setSeed(prev => prev + 1)}
            data-testid="shuffle-hub"
          >
            <Shuffle aria-hidden />
            Shuffle
          </Button>
          <span className="ml-auto text-sm text-muted-foreground" data-testid="hub-total">
            {data ? `${uniquePicks} picks` : '…'}
          </span>
        </div>

        {isPending && (
          <p className="py-24 text-center text-muted-foreground">Loading shelves…</p>
        )}
        {isError && (
          <p className="py-24 text-center text-destructive">Couldn&apos;t load the hub.</p>
        )}
        {!isPending && !isError && shelves.length === 0 && (
          <div className="py-24 text-center" data-testid="hub-empty">
            <p className="text-muted-foreground">Nothing matches the current filters.</p>
            {hasActiveFilters(selection) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => update(EMPTY_SELECTION)}
              >
                Clear all filters
              </Button>
            )}
          </div>
        )}

        {!isPending && !isError && shelves.length > 0 && (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pb-4">
            {shelves.map(shelf => (
              <section key={shelf.key} data-testid={`shelf-${shelf.key}`}>
                <h3 className="mb-2 text-base font-semibold">{shelf.title}</h3>
                <div className="flex gap-4 overflow-x-auto pb-2">
                  {shelf.games.map(game => (
                    <div key={game.canonicalId} className="w-44 shrink-0">
                      <LibraryCard
                        game={game}
                        onClick={() => setSelectedId(game.canonicalId)}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {suggestOpen && (
        <SurpriseMeModal
          loading={suggest.isPending}
          error={suggest.isError}
          game={suggest.data?.game ?? null}
          reasons={suggest.data?.reasons ?? []}
          onSpinAgain={handleSpin}
          onOpen={handleOpen}
          onMove={handleMoveFromSuggest}
          onClose={() => setSuggestOpen(false)}
        />
      )}

      {selectedGame && (
        <GameModal
          game={selectedGame}
          statuses={statuses}
          onClose={() => setSelectedId(null)}
          onMove={statusKey => handleMoveTo(selectedGame.canonicalId, statusKey)}
          onSelectGame={setSelectedId}
        />
      )}
    </div>
  );
}
