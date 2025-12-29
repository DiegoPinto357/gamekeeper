import { shouldForceMerge } from './overrides';

/**
 * Calculate similarity between two game names
 * Returns a score from 0 to 1, where 1 is identical
 */
export const calculateNameSimilarity = (name1: string, name2: string): number => {
  const normalized1 = normalizeGameName(name1);
  const normalized2 = normalizeGameName(name2);

  // Exact match
  if (normalized1 === normalized2) {
    return 1.0;
  }

  // Check substring match
  const minSubstringLength = 10;
  if (normalized1.length >= minSubstringLength && normalized2.length >= minSubstringLength) {
    if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
      return 0.95; // High similarity for substring matches
    }
  }

  // Calculate Levenshtein distance
  const distance = levenshteinDistance(normalized1, normalized2);
  const maxLength = Math.max(normalized1.length, normalized2.length);
  return 1 - distance / maxLength;
};

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
      /\b(goty|game of the year edition)\b/g,
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
  // Check manual overrides first
  const forcedMerge = shouldForceMerge(name1, name2);
  if (forcedMerge) {
    return true;
  }

  const normalized1 = normalizeGameName(name1);
  const normalized2 = normalizeGameName(name2);

  // Exact match after normalization
  if (normalized1 === normalized2) {
    return true;
  }

  // No fuzzy or substring matching - games must match exactly or via override
  return false;
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
