import { useEffect, useRef } from 'react';

/**
 * Escape dismisses the overlay while `enabled`. Stacked layers pass
 * `enabled: false` while a child overlay (the screenshot lightbox) is open,
 * so the first Escape unwraps only the top layer.
 */
export const useEscapeKey = (handler: () => void, enabled = true): void => {
  const ref = useRef(handler);

  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') ref.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
};
