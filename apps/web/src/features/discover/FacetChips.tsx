import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
  const [open, setOpen] = useState(true);
  if (facets.length === 0) return null;
  return (
    <section className="mb-3" data-testid={`facet-section-${dim}`}>
      <button
        type="button"
        data-testid={`facet-section-toggle-${dim}`}
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
        className="mb-1.5 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronDown
          className={cn('size-3 shrink-0 transition-transform', !open && '-rotate-90')}
          aria-hidden
        />
        {title}
        {selected.length > 0 && (
          <span
            data-testid={`facet-active-count-${dim}`}
            className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary"
          >
            {selected.length}
          </span>
        )}
      </button>
      {open && (
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
      )}
    </section>
  );
};
