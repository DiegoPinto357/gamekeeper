export type CatalogGame = {
  id: string;
  title: string;
  available: boolean;
  coverImageUrl?: string;
  releaseDate?: string;
  firstSeenAt?: string;
  catalogPosition?: number;
};

export type InterestsResponse = {
  interests: string[];
};

export type StatusEntry = {
  key: string;
  label: string;
  color: string;
  position: number;
};

export type LibraryGame = {
  canonicalId: string;
  name: string;
  coverImageUrl?: string;
  playtimeHours?: number;
  primarySource: string;
  ownedSources: string[];
  status: string | null;
  position: number | null;
};

export type LibraryResponse = {
  statuses: StatusEntry[];
  games: LibraryGame[];
};

export type GameStatusResult = {
  canonicalId: string;
  status: string;
  position: number;
};
