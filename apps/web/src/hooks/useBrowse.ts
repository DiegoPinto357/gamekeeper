import { useQuery } from '@tanstack/react-query';
import type { DiscoverFacets, DiscoverResponse } from '@gamekeeper/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3010';

const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json() as Promise<T>;
};

const withQuery = (path: string, qs: string): string =>
  qs ? `${path}?${qs}` : path;

export const useBrowseGames = (qs: string) =>
  useQuery({
    queryKey: ['library', 'games', qs],
    queryFn: () => fetchJson<DiscoverResponse>(withQuery('/api/games', qs)),
  });

export const useBrowseFacets = (qs: string) =>
  useQuery({
    queryKey: ['library', 'facets', qs],
    queryFn: () => fetchJson<DiscoverFacets>(withQuery('/api/facets', qs)),
  });
