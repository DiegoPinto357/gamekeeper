import { X } from 'lucide-react';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { CoverImage } from './CoverImage';
import { GameInfo } from './GameInfo';
import { ScreenshotGallery } from './ScreenshotGallery';

export type GameDrawerProps = {
  game: LibraryGame;
  statuses: StatusEntry[];
  onClose: () => void;
  onMove: (statusKey: string) => void;
  /**
   * Unpin is opt-in per page: the library passes this callback (shown only for
   * pinned games); pages that don't support pinning (browse) omit it and the
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

          {game.screenshots && game.screenshots.length > 0 && (
            <ScreenshotGallery screenshots={game.screenshots} alt={game.name} />
          )}

          <GameInfo
            game={game}
            statuses={statuses}
            onMove={onMove}
            onUnpin={onUnpin}
          />
        </div>
      </aside>
    </>
  );
};
