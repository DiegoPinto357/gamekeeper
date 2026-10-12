import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the header and catalog grid from a stubbed fetch', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/catalog')) {
        return new Response(
          JSON.stringify([
            {
              id: '9NZ6T11M0R2N',
              title: 'Hades II',
              available: true,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/api/interests')) {
        return new Response(JSON.stringify({ interests: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderApp();

    expect(screen.getByText(/GameKeeper/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByText('Hades II').length).toBeGreaterThan(0),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/catalog'),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/interests'),
    );
  });
});
