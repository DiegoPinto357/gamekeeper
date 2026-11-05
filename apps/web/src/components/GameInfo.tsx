import { useState } from 'react';
import { ChevronDown, ExternalLink, PinOff } from 'lucide-react';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { Badge } from '@/components/ui/badge';
import { gameLinks } from '@/lib/game-links';
import { CompatibilityBadges } from './CompatibilityBadges';
import { SimilarGames } from './SimilarGames';
import { SourceBadge } from './SourceBadge';
import { UnavailableBadge } from './UnavailableBadge';

export type GameInfoProps = {
  game: LibraryGame;
  statuses: StatusEntry[];
  onMove: (statusKey: string) => void;
  onUnpin?: () => void;
  /** Swap the hosting dialog to a similar game (P5). */
  onSelectGame?: (canonicalId: string) => void;
};

/**
 * The full detail block shared by the drawer and the discover modal:
 * badges, compatibility, store links, move menu, unpin, notes. Callers
 * decide where it sits in their layout.
 */
export const GameInfo = ({
  game,
  statuses,
  onMove,
  onUnpin,
  onSelectGame,
}: GameInfoProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const targets = statuses.filter(status => status.key !== game.status);
  const links = gameLinks(game);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {game.ownedSources.map(source => (
          <SourceBadge key={source} source={source} />
        ))}
        {game.playtimeHours != null && game.playtimeHours > 0 && (
          <Badge variant="outline">{Math.round(game.playtimeHours)}h played</Badge>
        )}
        {game.unavailableReason && <UnavailableBadge />}
      </div>

      {game.proton && <CompatibilityBadges proton={game.proton} />}

      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="drawer-links">
          {links.map(link => (
            <a
              key={link.key}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`game-link-${link.key}`}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent/40"
            >
              <ExternalLink className="size-3" aria-hidden />
              {link.label}
            </a>
          ))}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen(open => !open)}
          aria-haspopup="menu"
          className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent/40"
        >
          Move to
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </button>
        {menuOpen && (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border bg-background p-1 shadow-md">
            {targets.map(status => (
              <button
                key={status.key}
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onMove(status.key);
                }}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: status.color }}
                />
                {status.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {game.pinned && onUnpin && (
        <button
          type="button"
          onClick={onUnpin}
          className="flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent/40"
        >
          <PinOff aria-hidden />
          Unpin (back to auto order)
        </button>
      )}

      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide">
          Notes
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">No notes yet.</p>
      </div>

      <SimilarGames
        canonicalId={game.canonicalId}
        onSelect={onSelectGame}
      />
    </>
  );
};
