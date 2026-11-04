import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';
import { CoverImage } from './CoverImage';

export type ScreenshotGalleryProps = {
  screenshots: string[];
  alt: string;
};

/**
 * Hero screenshot + thumbnail strip. Renders nothing when the game has no
 * screenshots (callers pass the already store-resolved list). Clicking any
 * screenshot opens a fullscreen lightbox with a working carousel (arrows,
 * keyboard, counter); the overlay sits above both the drawer and the
 * discover modal.
 */
export const ScreenshotGallery = ({ screenshots, alt }: ScreenshotGalleryProps) => {
  const [selectedRaw, setSelected] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
      if (event.key === 'ArrowRight') {
        setSelected(index => (index + 1) % screenshots.length);
      }
      if (event.key === 'ArrowLeft') {
        setSelected(index => (index - 1 + screenshots.length) % screenshots.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen, screenshots.length]);

  if (screenshots.length === 0) return null;

  const selected = Math.min(selectedRaw, screenshots.length - 1);
  const step = (delta: number) =>
    setSelected(index => (index + delta + screenshots.length) % screenshots.length);
  const openAt = (index: number) => {
    setSelected(index);
    setFullscreen(true);
  };

  return (
    <div data-testid="screenshot-gallery" className="space-y-2">
      <button
        type="button"
        onClick={() => setFullscreen(true)}
        aria-label={`View ${alt} screenshots fullscreen`}
        className="group relative block w-full"
      >
        <CoverImage
          src={screenshots[selected]}
          alt={`${alt} screenshot`}
          className="aspect-video w-full rounded-lg bg-muted object-cover"
          fallback={
            <div
              data-testid="screenshot-hero-fallback"
              className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"
            >
              No preview
            </div>
          }
        />
        <span className="absolute right-2 top-2 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="size-3.5" aria-hidden />
        </span>
      </button>

      {screenshots.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {screenshots.map((url, index) => (
            <button
              key={url}
              type="button"
              aria-label={`Screenshot ${index + 1}`}
              aria-pressed={index === selected}
              onClick={() => openAt(index)}
              className={`size-14 shrink-0 overflow-hidden rounded-md border ${
                index === selected
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              <img
                src={url}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {fullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${alt} screenshots`}
          data-testid="screenshot-lightbox"
          className="fixed inset-0 z-[60] flex flex-col bg-black/95"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-white/70" data-testid="lightbox-counter">
              {selected + 1} / {screenshots.length}
            </span>
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              aria-label="Close screenshots"
              className="rounded-md p-1 text-white/80 hover:bg-white/10"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
            {screenshots.length > 1 && (
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous screenshot"
                className="absolute left-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronLeft className="size-6" aria-hidden />
              </button>
            )}
            <img
              src={screenshots[selected]}
              alt={`${alt} screenshot ${selected + 1}`}
              data-testid="lightbox-image"
              className="max-h-full max-w-full rounded-lg object-contain"
            />
            {screenshots.length > 1 && (
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next screenshot"
                className="absolute right-2 z-10 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              >
                <ChevronRight className="size-6" aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
