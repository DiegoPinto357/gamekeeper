import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// vitest globals are disabled, so RTL's auto-cleanup never registers
afterEach(cleanup);

// jsdom does not implement matchMedia; useTheme (systemTheme) requires it
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// jsdom does not implement EventSource; useSyncEvents connects on mount.
// Tests that need events stub a recording implementation globally.
if (typeof window.EventSource !== 'function') {
  class NoopEventSource {
    url: string;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(url: string) {
      this.url = url;
    }

    close() {
      /* noop */
    }
  }

  Object.defineProperty(window, 'EventSource', {
    writable: true,
    configurable: true,
    value: NoopEventSource,
  });
}
