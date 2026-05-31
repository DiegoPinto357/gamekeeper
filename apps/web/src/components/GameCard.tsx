import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CatalogGame } from '@/types/api';

interface GameCardProps {
  game: CatalogGame;
  isInterested: boolean;
  onToggle: (game: CatalogGame) => void;
  isPending?: boolean;
}

export function GameCard({ game, isInterested, onToggle, isPending }: GameCardProps) {
  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md',
        isInterested && 'ring-2 ring-primary',
      )}
    >
      <div className="relative aspect-[3/4] bg-muted overflow-hidden">
        {game.coverImageUrl ? (
          <img
            src={game.coverImageUrl}
            alt={game.title}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            {game.title}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-tight">{game.title}</p>
        <Button
          size="sm"
          variant={isInterested ? 'default' : 'outline'}
          className="w-full"
          disabled={isPending}
          onClick={() => onToggle(game)}
        >
          {isInterested ? 'Remove' : 'Add to Interests'}
        </Button>
      </div>
    </div>
  );
}
