/**
 * Normalize game name for matching
 * Removes special characters, extra whitespace, and common suffixes
 */
export const normalizeGameName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[™®©]/g, '') // Remove trademark symbols
    .replace(/[:'-]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/\b(the|a|an)\b/g, '') // Remove articles
    .replace(
      /\b(goty|game of the year|edition|definitive|complete|enhanced|remastered|directors cut)\b/g,
      ''
    )
    .trim();
};

/**
 * Generate a canonical ID from a game name
 * Used when no Steam AppID is available
 */
export const generateCanonicalId = (name: string): string => {
  const normalized = normalizeGameName(name);
  return normalized
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

/**
 * Check if two game names are likely the same game
 * Uses fuzzy matching to account for minor variations
 */
export const areNamesMatching = (name1: string, name2: string): boolean => {
  const normalized1 = normalizeGameName(name1);
  const normalized2 = normalizeGameName(name2);

  // Exact match after normalization
  if (normalized1 === normalized2) {
    return true;
  }

  // Check if one is a substring of the other (handles editions)
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return true;
  }

  // Calculate Levenshtein distance for fuzzy matching
  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);
  const similarity = 1 - distance / maxLength;

  // Consider a match if 85% similar
  return similarity >= 0.85;
};

/**
 * Calculate Levenshtein distance between two strings
 */
const levenshteinDistance = (str1: string, str2: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
};
