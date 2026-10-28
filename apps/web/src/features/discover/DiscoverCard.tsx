import { Badge } from '@/components/ui/badge';
import { CoverImage } from '@/features/library/CoverImage';
import { CompatibilityBadges } from '@/features/library/CompatibilityBadges';
import type { DiscoverGame } from '@gamekeeper/shared';

export type DiscoverCardProps = {
  game: DiscoverGame;
};

export const DiscoverCard = ({ game }: DiscoverCardProps) => {
  return (
    <div
      data-testid="discover-card"
      data-status={game.status}
      className="group flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-zinc-900">
        <CoverImage
          src={game.coverImageUrl}
          alt={game.name}
          fallback={
            <div className="flex h-full items-center justify-center text-2xl font-bold text-zinc-600">
              {game.name
                .split(/\s+/)
                .slice(0, 2)
                .map(word => word[0])
                .join('')
                .toUpperCase()}
            </div>
          }
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
        />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p data-testid="discover-name" className="line-clamp-2 text-sm font-medium leading-tight">
          {game.name}
        </p>

        <p className="text-xs text-muted-foreground">
          {[game.year, game.playtimeHours != null ? `${game.playtimeHours}h` : null]
            .filter(Boolean)
            .join(' · ') || 'Unplayed'}
        </p>

        {game.genres.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">{game.genres.join(' · ')}</p>
        )}

        {game.protonTier && (
          <CompatibilityBadges
            proton={{ tier: game.protonTier, steamDeck: game.deck ?? 'unknown' }}
          />
        )}

        <Badge variant="outline" className="mt-auto w-fit capitalize">
          {game.status.replace(/_/g, ' ')}
        </Badge>
      </div>
    </div>
  );
};
