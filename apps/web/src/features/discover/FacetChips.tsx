import { cn } from '@/lib/utils';
import type { FacetCount, YearFacetCount } from '@gamekeeper/shared';
import type { DiscoverDimension } from './discover-utils';

export type FacetChipsProps = {
  dim: DiscoverDimension;
  title: string;
  facets: FacetCount[] | YearFacetCount[];
  selected: Array<string | number>;
  onToggle: (dim: DiscoverDimension, value: string | number) => void;
};

const label = (value: string | number): string =>
  String(value).replace(/_/g, ' ');

export const FacetChips = ({ dim, title, facets, selected, onToggle }: FacetChipsProps) => {
  if (facets.length === 0) return null;
  return (
    <section className="mb-4" data-testid={`facet-section-${dim}`}>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-wrap gap-1.5">
        {facets.map(facet => {
          const isActive = selected.includes(facet.value);
          return (
            <button
              key={facet.value}
              type="button"
              data-testid={`facet-${dim}-${facet.value}`}
              aria-pressed={isActive}
              onClick={() => onToggle(dim, facet.value)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-muted',
              )}
            >
              {label(facet.value)}
              <span className="ml-1 text-[10px] opacity-70">{facet.count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
