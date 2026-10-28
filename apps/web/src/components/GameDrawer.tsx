import { useState } from 'react';
import { ChevronDown, ExternalLink, PinOff, X } from 'lucide-react';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { Badge } from '@/components/ui/badge';
import { gameLinks } from '@/lib/game-links';
import { CompatibilityBadges } from './CompatibilityBadges';
import { CoverImage } from './CoverImage';
import { SourceBadge } from './SourceBadge';
import { UnavailableBadge } from './UnavailableBadge';

export type GameDrawerProps = {
  game: LibraryGame;
  statuses: StatusEntry[];
  onClose: () => void;
  onMove: (statusKey: string) => void;
  /**
   * Unpin is opt-in per page: the library passes this callback (shown only for
   * pinned games); pages that don't support pinning (discover) omit it and the
   * button never renders.
   */
  onUnpin?: () => void;
};

export const GameDrawer = ({
  game,
  statuses,
  onClose,
  onMove,
  onUnpin,
}: GameDrawerProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const targets = statuses.filter(status => status.key !== game.status);
  const links = gameLinks(game);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        data-testid="drawer-backdrop"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Details: ${game.name}`}
        className="fixed inset-y-0 right-0 z-50 flex w-96 flex-col border-l bg-background shadow-xl"
      >
        <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {game.name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close drawer"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <CoverImage
            src={game.coverImageUrl}
            alt={game.name}
            className="w-full rounded-lg bg-muted"
            fallback={
              <div className="flex aspect-3/4 max-h-64 w-full items-center justify-center rounded-lg bg-muted text-4xl font-bold text-muted-foreground">
                {game.name.charAt(0)}
              </div>
            }
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {game.ownedSources.map(source => (
              <SourceBadge key={source} source={source} />
            ))}
            {game.playtimeHours != null && game.playtimeHours > 0 && (
              <Badge variant="outline">
                {Math.round(game.playtimeHours)}h played
              </Badge>
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
              <ChevronDown
                className="size-4 text-muted-foreground"
                aria-hidden
              />
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
              <PinOff className="size-4" aria-hidden />
              Unpin (back to auto order)
            </button>
          )}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notes
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">No notes yet.</p>
          </div>
        </div>
      </aside>
    </>
  );
};
