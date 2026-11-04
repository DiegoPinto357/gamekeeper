import { ArrowRight, PanelRight, RefreshCw, Sparkles, X } from 'lucide-react';
import type { DiscoverGame } from '@gamekeeper/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CoverImage } from '@/components/CoverImage';

export type SurpriseMeModalProps = {
  loading: boolean;
  error: boolean;
  game: DiscoverGame | null;
  reasons: string[];
  onSpinAgain: () => void;
  onOpen: (game: DiscoverGame) => void;
  onMove: (game: DiscoverGame) => void;
  onClose: () => void;
};

export const SurpriseMeModal = ({
  loading,
  error,
  game,
  reasons,
  onSpinAgain,
  onOpen,
  onMove,
  onClose,
}: SurpriseMeModalProps) => {
  const showGame = !loading && !error && game !== null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        data-testid="suggest-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Surprise me"
        data-testid="suggest-modal"
        className="fixed inset-0 z-50 m-auto flex h-fit max-h-[90vh] w-full max-w-sm flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="size-4 text-primary" aria-hidden />
            Surprise me
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close suggestion"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading && (
            <p role="status" className="py-6 text-center text-muted-foreground">
              Picking a game…
            </p>
          )}

          {!loading && error && (
            <div className="space-y-3 py-4 text-center">
              <p className="text-destructive">Couldn&apos;t pick a game.</p>
              <Button
                variant="outline"
                size="sm"
                onClick={onSpinAgain}
                data-testid="suggest-retry"
              >
                <RefreshCw aria-hidden />
                Try again
              </Button>
            </div>
          )}

          {!loading && !error && !game && (
            <div className="space-y-3 py-4 text-center">
              <p className="font-medium">Nothing eligible right now.</p>
              <p className="text-sm text-muted-foreground">
                You&apos;ve seen everything these filters allow — start over or
                loosen a filter.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onSpinAgain}
                data-testid="suggest-spin"
              >
                <RefreshCw aria-hidden />
                Start over
              </Button>
            </div>
          )}

          {showGame && game && (
            <div className="space-y-4">
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
              <div>
                <h3
                  data-testid="suggest-game-name"
                  className="text-lg font-semibold leading-tight"
                >
                  {game.name}
                </h3>
                {(game.year || game.genres.length > 0) && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[game.year, ...game.genres].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5" data-testid="suggest-reasons">
                {reasons.map(reason => (
                  <Badge key={reason} variant="secondary">
                    {reason}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {showGame && game && (
          <div className="flex flex-wrap gap-2 border-t px-4 py-3">
            <Button
              size="sm"
              onClick={onSpinAgain}
              data-testid="suggest-spin"
            >
              <RefreshCw aria-hidden />
              Spin again
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpen(game)}
              data-testid="suggest-open"
            >
              <PanelRight aria-hidden />
              Open
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-label="Move to want-to-play"
              onClick={() => onMove(game)}
              data-testid="suggest-move"
            >
              <ArrowRight aria-hidden />
              Want to play
            </Button>
          </div>
        )}
      </div>
    </>
  );
};
