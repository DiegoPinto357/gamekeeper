import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { BoardFilters } from './board-utils';

export type BoardToolbarProps = {
  filters: BoardFilters;
  onChange: (filters: BoardFilters) => void;
  sources: string[];
  total: number;
};

export const BoardToolbar = ({ filters, onChange, sources, total }: BoardToolbarProps) => {
  return (
    <div className="mb-4 flex shrink-0 flex-wrap items-center gap-3">
      <div className="relative w-64">
        <Input
          placeholder="Search games…"
          aria-label="Search games"
          value={filters.q}
          onChange={event => onChange({ ...filters, q: event.target.value })}
          className="w-full pr-9"
        />
        {filters.q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange({ ...filters, q: '' })}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        Source
        <select
          value={filters.source}
          onChange={event => onChange({ ...filters, source: event.target.value })}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
        >
          <option value="">All sources</option>
          {sources.map(source => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto text-sm text-muted-foreground">{total} games</span>
    </div>
  );
};
