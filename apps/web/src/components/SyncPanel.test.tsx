import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { AppShell } from '@/components/AppShell';
import type { SyncEvent, SyncSummary } from '@/hooks/useSyncEvents';

class FakeEventSource {
  static current: FakeEventSource | null = null;
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.current = this;
  }

  close() {
    /* noop */
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

const configStepEvents: SyncEvent[] = [
  { type: 'step:start', key: 'config', label: 'Configuration loaded' },
  { type: 'step:done', key: 'config', label: 'Configuration loaded' },
];

const steamRunningEvents: SyncEvent[] = [
  ...configStepEvents,
  { type: 'step:start', key: 'steam', label: 'Steam' },
];

const makeSummary = (overrides: Partial<SyncSummary> = {}): SyncSummary => ({
  added: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  errors: 0,
  duration: 1000,
  ...overrides,
});

const stubFetch = (handler?: (url: string, init?: RequestInit) => Response | undefined) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const custom = handler?.(url, init);
    if (custom) return custom;
    return new Response('Not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const renderShell = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient };
};

const openPanel = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Sync' }));
  return user;
};

describe('SyncPanel', () => {
  beforeEach(() => {
    FakeEventSource.current = null;
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts a sync with skipNotion: true by default', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/sync')) {
        return new Response(JSON.stringify({ runId: 'run-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return undefined;
    });
    renderShell();
    const user = await openPanel();

    expect(screen.getByLabelText('Also sync Notion')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3010/api/sync',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ skipNotion: true }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Syncing…' })).toBeDisabled(),
    );
  });

  it('sends skipNotion: false when the Notion toggle is checked', async () => {
    const fetchMock = stubFetch((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/sync')) {
        return new Response(JSON.stringify({ runId: 'run-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return undefined;
    });
    renderShell();
    const user = await openPanel();

    await user.click(screen.getByLabelText('Also sync Notion'));
    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:3010/api/sync',
        expect.objectContaining({ body: JSON.stringify({ skipNotion: false }) }),
      ),
    );
  });

  it('shows "Sync already running" when the server responds 409', async () => {
    stubFetch((url, init) => {
      if (init?.method === 'POST' && url.endsWith('/api/sync')) {
        return new Response(
          JSON.stringify({ error: 'sync already in progress', runId: 'other' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return undefined;
    });
    renderShell();
    const user = await openPanel();

    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(screen.getByText(/Sync already running/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('renders the checklist from a mid-run snapshot with progress counters', async () => {
    stubFetch();
    renderShell();
    await openPanel();

    act(() => {
      FakeEventSource.current?.emit({
        type: 'snapshot',
        status: 'running',
        runId: 'run-1',
        events: steamRunningEvents,
        summary: null,
      });
    });
    act(() => {
      FakeEventSource.current?.emit({
        type: 'progress',
        key: 'steam',
        current: 5,
        total: 10,
      });
    });

    expect(screen.getByText('Configuration loaded')).toBeInTheDocument();
    expect(screen.getByText('Steam')).toBeInTheDocument();
    expect(screen.getByText('5/10')).toBeInTheDocument();
    expect(screen.getByText('Step 2/2 · 75%')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
  });

  it('renders the summary line, invalidates queries, and re-enables Start', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    stubFetch();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AppShell />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await openPanel();

    act(() => {
      FakeEventSource.current?.emit({
        type: 'summary',
        summary: makeSummary({ added: 7, updated: 692, duration: 185119 }),
      });
    });

    expect(
      screen.getByText('Added 7 · Updated 692 · Removed 0 · 3m 5s'),
    ).toBeInTheDocument();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['catalog'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['interests'] });
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('closes the panel via the close button and backdrop', async () => {
    stubFetch();
    renderShell();
    const user = await openPanel();

    await user.click(screen.getByRole('button', { name: 'Close sync panel' }));
    expect(screen.queryByRole('dialog', { name: 'Sync' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sync' }));
    expect(screen.getByRole('dialog', { name: 'Sync' })).toBeInTheDocument();
    await user.click(screen.getByTestId('sync-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Sync' })).not.toBeInTheDocument();
  });
});
