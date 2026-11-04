import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { FacetCount, YearFacetCount } from '@gamekeeper/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FacetChips } from '@/features/library/FacetChips';
import type { LibraryDimension } from '@/features/library/library-utils';

export type FilterGroup = {
  dim: LibraryDimension;
  title: string;
  facets: Array<FacetCount | YearFacetCount>;
  selected: Array<string | number>;
};

export type FilterSidebarProps = {
  /** Controlled collapse state — the pages pick their own default. */
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  canClear: boolean;
  groups: FilterGroup[];
  onToggleFacet: (dim: LibraryDimension, value: string | number) => void;
};

const matchesQuery = (value: string | number, query: string): boolean => {
  const raw = String(value).toLowerCase();
  const label = raw.replace(/_/g, ' ');
  return raw.includes(query) || label.includes(query);
};

/**
 * The collapsible filter rail shared by Library (open by default) and
 * Discover (hidden by default): clear-all plus every facet group, with a
 * search box that narrows chips across all groups at once. Selected chips
 * stay visible while searching so active filters never vanish.
 */
export const FilterSidebar = ({
  open,
  onToggle,
  onClear,
  canClear,
  groups,
  onToggleFacet,
}: FilterSidebarProps) => {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const activeCount = groups.reduce((sum, group) => sum + group.selected.length, 0);

  if (!open) {
    return (
      <aside className="shrink-0 pt-1" data-testid="filter-sidebar">
        <Button
          variant="outline"
          size="icon"
          aria-label="Show filters"
          aria-expanded={false}
          data-testid="filter-panel-toggle"
          onClick={onToggle}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
        </Button>
      </aside>
    );
  }

  const visibleGroups = groups
    .map(group => ({
      ...group,
      facets: normalized
        ? group.facets.filter(
            facet =>
              matchesQuery(facet.value, normalized) ||
              group.selected.includes(facet.value),
          )
        : group.facets,
    }))
    .filter(group => group.facets.length > 0);
  const nothingMatches =
    normalized.length > 0 && visibleGroups.length === 0;

  return (
    <aside className="w-60 shrink-0 overflow-y-auto pb-4 pr-2" data-testid="filter-sidebar">
      <button
        type="button"
        aria-expanded={true}
        data-testid="filter-panel-toggle"
        onClick={onToggle}
        className="mb-3 flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm font-medium hover:bg-accent"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
        Filters
        <span className="ml-auto flex items-center gap-1">
          {activeCount > 0 && (
            <span
              data-testid="filter-active-count"
              className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary"
            >
              {activeCount}
            </span>
          )}
          <ChevronDown className="size-3.5 rotate-180 text-muted-foreground" aria-hidden />
        </span>
      </button>

      <Input
        placeholder="Search filters…"
        aria-label="Search filters"
        data-testid="filter-search"
        value={query}
        onChange={event => setQuery(event.target.value)}
        className="mb-3 h-8"
      />

      <Button
        variant="outline"
        size="sm"
        className="mb-4 w-full"
        disabled={!canClear}
        onClick={onClear}
      >
        Clear all filters
      </Button>

      {visibleGroups.map(group => (
        <FacetChips
          key={group.dim}
          dim={group.dim}
          title={group.title}
          facets={group.facets}
          selected={group.selected}
          onToggle={onToggleFacet}
        />
      ))}

      {nothingMatches && (
        <p className="px-1 text-sm text-muted-foreground" data-testid="filter-search-empty">
          No filters match “{query.trim()}”.
        </p>
      )}
    </aside>
  );
};
