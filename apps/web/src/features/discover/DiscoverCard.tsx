import { Badge } from '@/components/ui/badge';
import { CoverImage } from '@/components/CoverImage';
import { CompatibilityBadges } from '@/components/CompatibilityBadges';
import { SourceBadge } from '@/components/SourceBadge';
import type { DiscoverGame } from '@gamekeeper/shared';
import { cn } from '@/lib/utils';

export type DiscoverCardProps = {
  game: DiscoverGame;
  onClick?: () => void;
};

export const DiscoverCard = ({ game, onClick }: DiscoverCardProps) => {
  const playtime =
    game.playtimeHours != null && game.playtimeHours > 0
      ? `${Math.round(game.playtimeHours)}h`
      : null;

  return (
    <div
      data-testid="discover-card"
      data-status={game.status}
      onClick={onClick}
      className={cn(
        'group flex flex-col overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md',
        onClick && 'cursor-pointer',
      )}
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

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p data-testid="discover-name" className="line-clamp-2 text-sm font-medium leading-tight">
          {game.name}
        </p>

        <div className="flex flex-wrap items-center gap-1">
          {game.ownedSources.map(source => (
            <SourceBadge key={source} source={source} />
          ))}
          {playtime && <Badge variant="outline">{playtime}</Badge>}
        </div>

        {game.protonTier && (
          <CompatibilityBadges
            proton={{ tier: game.protonTier, steamDeck: game.deck ?? 'unknown' }}
          />
        )}

        {(game.year || game.genres.length > 0) && (
          <p className="truncate text-xs text-muted-foreground">
            {[game.year, ...game.genres].filter(Boolean).join(' · ')}
          </p>
        )}

        <Badge variant="outline" className="mt-auto w-fit capitalize">
          {game.status.replace(/_/g, ' ')}
        </Badge>
      </div>
    </div>
  );
};
