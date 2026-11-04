import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type {
  DiscoverFacets,
  DiscoverResponse,
  HubResponse,
  SuggestResponse,
} from '@gamekeeper/shared';

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

/** Store-style shelves; the seed reshuffles every section in one request. */
export const useHub = (qs: string, seed: number): UseQueryResult<HubResponse> => {
  const params = new URLSearchParams(qs);
  params.set('seed', String(seed));
  const search = params.toString();
  return useQuery({
    queryKey: ['discover', 'hub', search],
    queryFn: () => fetchJson<HubResponse>(withQuery('/api/hub', search)),
  });
};

/**
 * Directed-random pick for the Surprise-me modal. `exclude` accumulates
 * shown picks (spin again); gcTime 0 so reopening always feels fresh.
 */
export const useSuggest = (
  qs: string,
  exclude: string[],
  enabled: boolean,
): UseQueryResult<SuggestResponse> => {
  const params = new URLSearchParams(qs);
  if (exclude.length > 0) params.set('exclude', exclude.join(','));
  const search = params.toString();
  return useQuery({
    queryKey: ['discover', 'suggest', search],
    queryFn: () => fetchJson<SuggestResponse>(withQuery('/api/suggest', search)),
    enabled,
    gcTime: 0,
  });
};
