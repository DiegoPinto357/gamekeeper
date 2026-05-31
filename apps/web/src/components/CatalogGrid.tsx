import { useState, useMemo } from 'react';
import { GameCard } from '@/components/GameCard';
import { SearchBar } from '@/components/SearchBar';
import { useCatalog, useInterests, useAddInterest, useRemoveInterest } from '@/hooks/useGamePass';
import type { CatalogGame } from '@/types/api';

export function CatalogGrid() {
  const [search, setSearch] = useState('');

  const { data: catalog, isLoading: catalogLoading, isError: catalogError } = useCatalog();
  const { data: interestsData } = useInterests();
  const addInterest = useAddInterest();
  const removeInterest = useRemoveInterest();

  const interestSet = useMemo(
    () => new Set(interestsData?.interests ?? []),
    [interestsData],
  );

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return q ? catalog.filter((g) => g.title.toLowerCase().includes(q)) : catalog;
  }, [catalog, search]);

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
      <div className="flex items-center justify-between">
        <SearchBar
          value={search}
          onChange={setSearch}
          interestCount={interestSet.size}
        />
        <span className="text-sm text-muted-foreground">
          {filtered.length} game{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {filtered.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            isInterested={interestSet.has(game.title)}
            onToggle={handleToggle}
            isPending={addInterest.isPending || removeInterest.isPending}
          />
        ))}
      </div>

      {filtered.length === 0 && search && (
        <div className="py-12 text-center text-muted-foreground">
          No games match "{search}"
        </div>
      )}
    </div>
  );
}
