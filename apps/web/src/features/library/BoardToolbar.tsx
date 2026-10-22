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
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Input
        placeholder="Search games…"
        aria-label="Search games"
        value={filters.q}
        onChange={event => onChange({ ...filters, q: event.target.value })}
        className="w-64"
      />
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
