import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { LibraryGame, StatusEntry } from '@gamekeeper/shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { CoverImage } from './CoverImage';
import { GameInfo } from './GameInfo';
import { ScreenshotGallery } from './ScreenshotGallery';

export type GameModalProps = {
  game: LibraryGame;
  statuses: StatusEntry[];
  onClose: () => void;
  onMove: (statusKey: string) => void;
  onUnpin?: () => void;
};

/**
 * The discover page's big detail modal: screenshots take the stage, the cover
 * plays a supporting role beside the full detail block (same content as the
 * drawer — badges, compatibility, links, move menu, notes).
 */
export const GameModal = ({
  game,
  statuses,
  onClose,
  onMove,
  onUnpin,
}: GameModalProps) => {
  const hasScreenshots = !!game.screenshots && game.screenshots.length > 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Escape closes the modal — unless the lightbox is stacked on top of it
  useEscapeKey(onClose, !lightboxOpen);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        data-testid="game-modal-backdrop"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Details: ${game.name}`}
        data-testid="game-modal"
        tabIndex={-1}
        className="fixed inset-0 z-50 m-auto flex h-[90vh] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border bg-background shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-2 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold">{game.name}</h2>
            {game.status && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {game.status.replace(/_/g, ' ')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {hasScreenshots && game.screenshots && (
            <ScreenshotGallery
              screenshots={game.screenshots}
              alt={game.name}
              onLightboxChange={setLightboxOpen}
            />
          )}

          <div className="flex items-start gap-5">
            <div className={hasScreenshots ? 'w-36 shrink-0' : 'w-56 shrink-0'}>
              <CoverImage
                src={game.coverImageUrl}
                alt={game.name}
                className="w-full rounded-lg bg-muted"
                fallback={
                  <div className="flex aspect-3/4 w-full items-center justify-center rounded-lg bg-muted text-3xl font-bold text-muted-foreground">
                    {game.name.charAt(0)}
                  </div>
                }
              />
            </div>

            <div className="min-w-0 flex-1 space-y-4">
              <GameInfo
                game={game}
                statuses={statuses}
                onMove={onMove}
                onUnpin={onUnpin}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
