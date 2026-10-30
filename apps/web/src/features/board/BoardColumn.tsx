import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { BoardCard } from './BoardCard';

const LAZY_PAGE = 50;

export type BoardColumnProps = {
  status: StatusEntry;
  games: LibraryGame[];
  lazy?: boolean;
  onOpenCard: (canonicalId: string) => void;
};

export const BoardColumn = ({
  status,
  games,
  lazy = false,
  onOpenCard,
}: BoardColumnProps) => {
  const [visibleCount, setVisibleCount] = useState(
    lazy ? LAZY_PAGE : Number.POSITIVE_INFINITY,
  );
  const { setNodeRef } = useDroppable({ id: status.key });

  const visible = games.slice(0, visibleCount);
  const remaining = games.length - visible.length;

  return (
    <section
      data-testid={`column-${status.key}`}
      aria-label={status.label}
      className="flex w-80 max-h-full shrink-0 flex-col rounded-lg border bg-muted/30"
    >
      <div data-testid="board-column" className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: status.color }}
          />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {status.label}
          </h2>
          <span
            data-testid="column-count"
            className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          >
            {games.length}
          </span>
        </header>

        <div
          ref={setNodeRef}
          className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2"
        >
          <SortableContext
            items={visible.map(game => game.canonicalId)}
            strategy={verticalListSortingStrategy}
          >
            {visible.map(game => (
              <BoardCard key={game.canonicalId} game={game} onOpen={onOpenCard} />
            ))}
          </SortableContext>

          {games.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No games yet.
            </p>
          )}

          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setVisibleCount(count => count + LAZY_PAGE)}
              className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/40"
            >
              Show more ({remaining})
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
