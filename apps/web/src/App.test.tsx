import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function stubCatalogFetch() {
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
  return fetchMock;
}

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.pushState({}, '', '/');
  });

  it('renders nav links and the library placeholder at /', async () => {
    renderApp();

    expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Discover' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Game Pass' })).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: 'Library' })).toBeInTheDocument();
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();
  });

  it('shows the catalog grid when navigating to /gamepass', async () => {
    const fetchMock = stubCatalogFetch();
    const user = userEvent.setup();

    renderApp();
    await user.click(screen.getByRole('link', { name: 'Game Pass' }));

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

  it('renders the discover placeholder when navigating to /discover', async () => {
    stubCatalogFetch();
    const user = userEvent.setup();

    renderApp();
    await user.click(screen.getByRole('link', { name: 'Discover' }));

    expect(screen.getByRole('heading', { name: 'Discover' })).toBeInTheDocument();
    expect(screen.queryByText('Hades II')).not.toBeInTheDocument();
  });
});
