export interface CatalogGame {
  id: string;
  title: string;
  available: boolean;
  coverImageUrl?: string;
}

export interface InterestsResponse {
  interests: string[];
}
