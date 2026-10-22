import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LibraryGame } from '@gamekeeper/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type BoardCardProps = {
  game: LibraryGame;
  onOpen: (canonicalId: string) => void;
};

export const BoardCardFace = memo(
  ({ game, className }: { game: LibraryGame; className?: string }) => {
    const playtime =
      game.playtimeHours != null && game.playtimeHours > 0
        ? `${Math.round(game.playtimeHours)}h`
        : null;

    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border bg-card p-2 shadow-sm transition-colors hover:bg-accent/40',
          className,
        )}
      >
        {game.coverImageUrl ? (
          <img
            src={game.coverImageUrl}
            alt=""
            loading="lazy"
            className="h-14 w-10 shrink-0 rounded object-cover bg-muted"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-14 w-10 shrink-0 items-center justify-center rounded bg-muted text-sm font-semibold text-muted-foreground"
          >
            {game.name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{game.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="secondary">{game.primarySource}</Badge>
            {playtime && <Badge variant="outline">{playtime}</Badge>}
          </div>
        </div>
      </div>
    );
  },
);

export const BoardCard = memo(({ game, onOpen }: BoardCardProps) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: game.canonicalId });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
      data-testid="board-card"
      onClick={() => onOpen(game.canonicalId)}
      className={cn(
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <BoardCardFace game={game} />
    </div>
  );
});
