export interface CatalogGame {
  id: string;
  title: string;
  available: boolean;
  coverImageUrl?: string;
  firstSeenAt?: string;
}

export interface InterestsResponse {
  interests: string[];
}
