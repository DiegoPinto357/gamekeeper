export type ForceMergeRule = {
  games: string[];
  canonicalName?: string;
};

export type PropertyOverride = {
  match: string;
  properties: Record<string, any>;
};

export type GameOverrides = {
  forceMerge?: ForceMergeRule[];
  propertyOverrides?: PropertyOverride[];
};
