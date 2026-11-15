export type CatalogGame = {
  id: string;
  title: string;
  available: boolean;
  coverImageUrl?: string;
  releaseDate?: string;
  firstSeenAt?: string;
  catalogPosition?: number;
};

export type InterestEntry = {
  id: string;
  title: string;
};

export type InterestsResponse = {
  interests: InterestEntry[];
};

export type StatusEntry = {
  key: string;
  label: string;
  color: string;
  position: number;
};

export type StatusesResponse = {
  statuses: StatusEntry[];
};

export type ForceMergeRuleEntry = {
  id: number;
  games: string[];
  canonicalName?: string;
};

export type ForceMergeRulesResponse = {
  rules: ForceMergeRuleEntry[];
};

export type OwnedGame = {
  canonicalId: string;
  name: string;
  platform: string;
  notes: string | null;
};

export type OwnedGamesResponse = {
  ownedGames: OwnedGame[];
};

export type ProtonTier = 'platinum' | 'gold' | 'silver' | 'bronze' | 'borked';
export type SteamDeckStatus = 'verified' | 'playable' | 'unsupported' | 'unknown';

export type Source = 'steam' | 'xbox' | 'epic' | 'gog' | 'amazon' | 'gamepass' | 'manual';

/**
 * Usual precedence for picking a game's store link (lower = preferred).
 * Mirrors PLATFORM_PRIORITY in @gamekeeper/core — keep in sync.
 */
export const PLATFORM_PRIORITY: Record<Source, number> = {
  steam: 1,
  xbox: 2,
  gamepass: 2,
  epic: 3,
  gog: 4,
  amazon: 5,
  manual: 6,
};

export type GameCompatibility = {
  tier: ProtonTier;
  steamDeck: SteamDeckStatus;
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
  /** Manually prioritized (drag-pinned); false = flows live by last played. */
  pinned: boolean;
  /** Reason the game left its source's catalog (e.g. 'interest-unavailable'). */
  unavailableReason?: string;
  /** ProtonDB tier + Steam Deck status when known (mostly Steam games). */
  proton?: GameCompatibility;
  /** Steam app id when known; drives store + ProtonDB links. */
  steamAppId?: number;
  /** Resolved per store precedence (IGDB last resort); [] when none. */
  screenshots?: string[];
};

export type LibraryResponse = {
  statuses: StatusEntry[];
  games: LibraryGame[];
};

export type DiscoverGame = {
  canonicalId: string;
  name: string;
  coverImageUrl?: string;
  playtimeHours?: number;
  primarySource: string;
  ownedSources: string[];
  /** Board status; games without a tracked row count as 'backlog'. */
  status: string;
  releaseDate?: string;
  year?: number;
  lastPlayedAt?: string;
  genres: string[];
  tags: string[];
  deck?: SteamDeckStatus;
  protonTier?: ProtonTier;
  unavailableReason?: string;
  /** Steam app id when known; drives store + ProtonDB links. */
  steamAppId?: number;
  /** Resolved per store precedence (IGDB last resort); [] when none. */
  screenshots?: string[];
};

export type FacetCount = { value: string; count: number };
export type YearFacetCount = { value: number; count: number };

export type DiscoverFacets = {
  genres: FacetCount[];
  tags: FacetCount[];
  sources: FacetCount[];
  statuses: FacetCount[];
  decks: FacetCount[];
  protonTiers: FacetCount[];
  years: YearFacetCount[];
};

export type DiscoverResponse = {
  games: DiscoverGame[];
  total: number;
};

/** P4.3 — one directed-random pick; game is null when the pool is empty. */
export type SuggestResponse = {
  game: DiscoverGame | null;
  reasons: string[];
};

export type SuggestShelf = {
  key: string;
  title: string;
  games: DiscoverGame[];
};

/** P4.3 — store-style shelves for the Discover hub. */
export type HubResponse = {
  shelves: SuggestShelf[];
};

export type GameStatusResult = {
  canonicalId: string;
  status: string;
  /** null for cross-column moves (the game joins the auto flow). */
  position: number | null;
};

export type UnpinResult = {
  canonicalId: string;
  status: string;
  pinned: false;
};

/** P5 — how a similar pair was found: IGDB's curated list vs local overlap. */
export type SimilarOrigin = 'igdb' | 'overlap';

export type SimilarGame = {
  canonicalId: string;
  name: string;
  coverImageUrl: string | null;
  /** Board status; games without a tracked row count as 'backlog'. */
  status: string;
  origin: SimilarOrigin;
  /** 0.4·jaccard(genres) + 0.6·jaccard(tags); null for IGDB-curated rows. */
  score: number | null;
  /** IGDB curated rank (1-based); null for computed overlap. */
  rank: number | null;
};

export type SimilarResponse = {
  similar: SimilarGame[];
};
