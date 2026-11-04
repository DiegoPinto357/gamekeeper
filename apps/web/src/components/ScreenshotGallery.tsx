import { useState } from 'react';
import { CoverImage } from './CoverImage';

export type ScreenshotGalleryProps = {
  screenshots: string[];
  alt: string;
};

/**
 * Hero screenshot + thumbnail strip. Renders nothing when the game has no
 * screenshots (callers pass the already store-resolved list).
 */
export const ScreenshotGallery = ({ screenshots, alt }: ScreenshotGalleryProps) => {
  const [selectedRaw, setSelected] = useState(0);

  if (screenshots.length === 0) return null;

  const selected = Math.min(selectedRaw, screenshots.length - 1);

  return (
    <div data-testid="screenshot-gallery" className="space-y-2">
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
      {screenshots.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {screenshots.map((url, index) => (
            <button
              key={url}
              type="button"
              aria-label={`Screenshot ${index + 1}`}
              aria-pressed={index === selected}
              onClick={() => setSelected(index)}
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
    </div>
  );
};
