import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { LibraryGame } from '@gamekeeper/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CoverImage } from './CoverImage';
import { SourceBadge } from './SourceBadge';
import { UnavailableBadge } from './UnavailableBadge';

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
          'flex flex-col gap-2 rounded-lg border bg-card p-2.5 shadow-sm transition-colors hover:bg-accent/40',
          className,
        )}
      >
        <CoverImage
          src={game.coverImageUrl}
          alt=""
          className="aspect-video w-full rounded-md bg-muted object-cover"
          fallback={
            <div
              aria-hidden
              className="flex aspect-2/1 w-full items-center justify-center rounded-md bg-muted text-3xl font-bold text-muted-foreground"
            >
              {game.name.charAt(0)}
            </div>
          }
        />
        <p className="text-sm font-medium leading-snug wrap-break-words">
          {game.name}
        </p>
        <div className="flex flex-wrap items-center gap-1">
          {game.ownedSources.map(source => (
            <SourceBadge key={source} source={source} />
          ))}
          {playtime && <Badge variant="outline">{playtime}</Badge>}
          {game.unavailableReason && <UnavailableBadge />}
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
