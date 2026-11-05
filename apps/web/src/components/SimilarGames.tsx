import { useSimilarGames } from '@/hooks/useBrowse';
import { Badge } from '@/components/ui/badge';
import { CoverImage } from '@/components/CoverImage';

export type SimilarGamesProps = {
  canonicalId: string;
  /** Swap the hosting drawer/modal to the clicked game. */
  onSelect?: (canonicalId: string) => void;
};

const statusLabel = (status: string): string => status.replace(/_/g, ' ');

const originBadge = (origin: 'igdb' | 'overlap', score: number | null): string =>
  origin === 'igdb' ? 'IGDB similar' : `${Math.round((score ?? 0) * 100)}% match`;

/**
 * P5 — the detail section's similar-games list. Hides itself while loading
 * and when the endpoint errors or returns nothing, so the section only
 * appears when there is something to show.
 */
export const SimilarGames = ({ canonicalId, onSelect }: SimilarGamesProps) => {
  const { data, isPending, isError } = useSimilarGames(canonicalId);

  if (isPending || isError) return null;
  const similar = data.similar;
  if (similar.length === 0) return null;

  return (
    <div data-testid="similar-games">
      <h3 className="text-xs font-semibold uppercase tracking-wide">
        Similar games
      </h3>
      <ul className="mt-1.5 space-y-1">
        {similar.map(game => (
          <li key={game.canonicalId}>
            <button
              type="button"
              data-testid="similar-row"
              onClick={() => onSelect?.(game.canonicalId)}
              className="flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-accent/40"
            >
              <CoverImage
                src={game.coverImageUrl}
                alt=""
                className="size-9 shrink-0 rounded bg-muted object-cover"
                fallback={
                  <div className="flex size-9 items-center justify-center rounded bg-muted text-sm font-bold text-muted-foreground">
                    {game.name.charAt(0)}
                  </div>
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium leading-tight">
                  {game.name}
                </span>
                <span className="block truncate text-xs capitalize text-muted-foreground">
                  {statusLabel(game.status)}
                </span>
              </span>
              <Badge variant="outline" className="shrink-0 text-xs">
                {originBadge(game.origin, game.score)}
              </Badge>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
