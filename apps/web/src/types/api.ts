export interface CatalogGame {
  id: string;
  title: string;
  available: boolean;
  coverImageUrl?: string;
  releaseDate?: string;
  firstSeenAt?: string;
  catalogPosition?: number;
}

export interface InterestsResponse {
  interests: string[];
}
