import type { DiscoverGame } from '@gamekeeper/shared';

export type LibrarySelection = {
  q: string;
  genres: string[];
  tags: string[];
  sources: string[];
  statuses: string[];
  decks: string[];
  protonTiers: string[];
  years: number[];
};

export const EMPTY_SELECTION: LibrarySelection = {
  q: '',
  genres: [],
  tags: [],
  sources: [],
  statuses: [],
  decks: [],
  protonTiers: [],
  years: [],
};

export type LibraryDimension = Exclude<keyof LibrarySelection, 'q'>;

export const hasActiveFilters = (selection: LibrarySelection): boolean =>
  selection.q !== '' ||
  (Object.keys(EMPTY_SELECTION) as Array<keyof LibrarySelection>)
    .filter(key => key !== 'q')
    .some(key => (selection[key] as unknown[]).length > 0);

export const toggleInList = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter(entry => entry !== value) : [...list, value];

const parseList = (params: URLSearchParams, key: string): string[] =>
  params
    .getAll(key)
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(value => value.length > 0);

export const parseSelection = (params: URLSearchParams): LibrarySelection => ({
  q: params.get('q')?.trim() ?? '',
  genres: parseList(params, 'genre'),
  tags: parseList(params, 'tag'),
  sources: parseList(params, 'source'),
  statuses: parseList(params, 'status'),
  decks: parseList(params, 'deck'),
  protonTiers: parseList(params, 'proton'),
  years: parseList(params, 'year')
    .map(value => Number(value))
    .filter(value => Number.isInteger(value)),
});

/** Build the server query string; omits empty dimensions. */
export const selectionToQueryString = (selection: LibrarySelection): string => {
  const params = new URLSearchParams();
  if (selection.q) params.set('q', selection.q);
  const put = (key: string, values: Array<string | number>) => {
    if (values.length > 0) params.set(key, values.join(','));
  };
  put('genre', selection.genres);
  put('tag', selection.tags);
  put('source', selection.sources);
  put('status', selection.statuses);
  put('deck', selection.decks);
  put('proton', selection.protonTiers);
  put('year', selection.years);
  return params.toString();
};

export type SortKey = 'name' | 'year' | 'playtime';

export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name A–Z',
  year: 'Release year',
  playtime: 'Playtime',
};

const compareNullableNumber = (a: number | undefined, b: number | undefined): number => {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1; // missing values last
  if (b === undefined) return -1;
  return b - a; // descending
};

export const sortGames = (games: DiscoverGame[], key: SortKey): DiscoverGame[] => {
  const sorted = [...games];
  if (key === 'name') {
    return sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }
  if (key === 'year') {
    return sorted.sort((a, b) => compareNullableNumber(a.year, b.year));
  }
  return sorted.sort((a, b) => compareNullableNumber(a.playtimeHours, b.playtimeHours));
};
