import { useState } from 'react';

export type CoverImageProps = {
  src: string | null | undefined;
  alt: string;
  /** Rendered in place of the image when src is missing or fails to load. */
  fallback: React.ReactNode;
  className?: string;
  loading?: 'lazy' | 'eager';
};

export const CoverImage = ({
  src,
  alt,
  fallback,
  className,
  loading = 'lazy',
}: CoverImageProps) => {
  // Comparing against the current src means a changed URL automatically
  // resets the failure (e.g. sync refreshed the cover) — no effect needed.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || src === failedSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading={loading}
      onError={() => setFailedSrc(src)}
      className={className}
    />
  );
};
