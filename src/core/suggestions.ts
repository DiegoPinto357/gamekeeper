import fs from 'fs/promises';
import { RawGameData } from '../types/game';
import { calculateNameSimilarity, normalizeGameName } from './normalize';

export type MergeSuggestion = {
  games: string[];
  sources: string[];
  similarity: number;
  reason: string;
};

/**
 * Generate merge suggestions for similar games
 */
export const generateMergeSuggestions = (
  rawGames: RawGameData[]
): MergeSuggestion[] => {
  const suggestions: MergeSuggestion[] = [];
  const processed = new Set<string>();

  for (let i = 0; i < rawGames.length; i++) {
    const game1 = rawGames[i];
    const key1 = `${game1.name}|${game1.source}`;
    
    if (processed.has(key1)) continue;

    for (let j = i + 1; j < rawGames.length; j++) {
      const game2 = rawGames[j];
      const key2 = `${game2.name}|${game2.source}`;
      
      if (processed.has(key2)) continue;
      
      // Skip if same source (likely already handled by Steam AppID)
      if (game1.source === game2.source) continue;

      const similarity = calculateNameSimilarity(game1.name, game2.name);

      // Suggest merges for high similarity (but not exact matches, those are auto-merged)
      if (similarity >= 0.85 && similarity < 1.0) {
        let reason = '';
        
        if (similarity >= 0.95) {
          reason = 'Substring match - likely same game with different edition name';
        } else if (similarity >= 0.90) {
          reason = 'Very high similarity - likely same game with minor name variation';
        } else {
          reason = 'High similarity - possibly same game or related (e.g., sequel)';
        }

        suggestions.push({
          games: [game1.name, game2.name],
          sources: [game1.source, game2.source],
          similarity: Math.round(similarity * 100) / 100,
          reason,
        });
      }
    }
  }

  // Sort by similarity (highest first)
  return suggestions.sort((a, b) => b.similarity - a.similarity);
};

/**
 * Save merge suggestions to a JSON file
 */
export const saveMergeSuggestions = async (
  suggestions: MergeSuggestion[],
  outputPath: string = './data/merge-suggestions.json'
): Promise<void> => {
  const output = {
    generatedAt: new Date().toISOString(),
    totalSuggestions: suggestions.length,
    suggestions: suggestions.map((s, idx) => ({
      id: idx + 1,
      ...s,
    })),
    instructions: {
      howToUse: 'Review these suggestions and add confirmed merges to data/overrides.json in the "forceMerge" array',
      example: {
        games: ['Game Name', 'Game Name: Enhanced Edition'],
        canonicalName: 'Game Name',
      },
    },
  };

  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`📝 Saved ${suggestions.length} merge suggestions to ${outputPath}`);
};
