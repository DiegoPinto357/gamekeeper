import { useState, useMemo } from 'react';
import { GameCard } from '@/components/GameCard';
import { SearchBar } from '@/components/SearchBar';
import { Button } from '@/components/ui/button';
import { useCatalog, useInterests, useAddInterest, useRemoveInterest } from '@/hooks/useGamePass';
import { cn } from '@/lib/utils';
import type { CatalogGame } from '@/types/api';

type SortOption = 'az' | 'recent';
type FilterOption = 'all' | 'interested' | 'not-interested';

export function CatalogGrid() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('az');
  const [filter, setFilter] = useState<FilterOption>('all');

  const { data: catalog, isLoading: catalogLoading, isError: catalogError } = useCatalog();
  const { data: interestsData } = useInterests();
  const addInterest = useAddInterest();
  const removeInterest = useRemoveInterest();

  const interestSet = useMemo(
    () => new Set(interestsData?.interests ?? []),
    [interestsData],
  );

  const processed = useMemo(() => {
    if (!catalog) return [];

    // Search
    const q = search.trim().toLowerCase();
    let result = q ? catalog.filter((g) => g.title.toLowerCase().includes(q)) : [...catalog];

    // Filter
    if (filter === 'interested') result = result.filter((g) => interestSet.has(g.title));
    else if (filter === 'not-interested') result = result.filter((g) => !interestSet.has(g.title));

    // Sort — 'recent' = newest releaseDate first; 'az' = alphabetical
    if (sort === 'az') result.sort((a, b) => a.title.localeCompare(b.title));
    else result.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));

    return result;
  }, [catalog, search, sort, filter, interestSet]);

  function handleToggle(game: CatalogGame) {
    if (interestSet.has(game.title)) {
      removeInterest.mutate(game.title);
    } else {
      addInterest.mutate(game.title);
    }
  }

  if (catalogLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading catalog…
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="flex items-center justify-center py-24 text-destructive">
        Failed to load catalog. Is the server running?
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          interestCount={interestSet.size}
        />

        {/* Sort */}
        <div className="flex items-center gap-1 rounded-lg border p-1">
          {(['az', 'recent'] as SortOption[]).map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={sort === opt ? 'default' : 'ghost'}
              className={cn('h-6 px-2 text-xs')}
              onClick={() => setSort(opt)}
            >
              {opt === 'az' ? 'A – Z' : 'Recently Added'}
            </Button>
          ))}
        </div>

        {/* Filter */}
        <div className="flex items-center gap-1 rounded-lg border p-1">
          {(['all', 'interested', 'not-interested'] as FilterOption[]).map((opt) => (
            <Button
              key={opt}
              size="sm"
              variant={filter === opt ? 'default' : 'ghost'}
              className={cn('h-6 px-2 text-xs')}
              onClick={() => setFilter(opt)}
            >
              {opt === 'all' ? 'All' : opt === 'interested' ? 'In my list' : 'Not in my list'}
            </Button>
          ))}
        </div>

        <span className="ml-auto text-sm text-muted-foreground">
          {processed.length} game{processed.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {processed.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            isInterested={interestSet.has(game.title)}
            onToggle={handleToggle}
            isPending={addInterest.isPending || removeInterest.isPending}
          />
        ))}
      </div>

      {processed.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          {search ? `No games match "${search}"` : 'No games match the current filter.'}
        </div>
      )}
    </div>
  );
}
