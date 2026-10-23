import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { GameCompatibility } from '@gamekeeper/shared';

const DECK_STYLES: Record<
  GameCompatibility['steamDeck'],
  { label: string; className: string } | null
> = {
  verified: {
    label: '✓ Verified',
    className: 'bg-green-500/15 text-green-700 dark:text-green-400',
  },
  playable: {
    label: '⚠ Playable',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  unsupported: {
    label: '✕ Unsupported',
    className: 'bg-red-500/15 text-red-700 dark:text-red-400',
  },
  unknown: null,
};

const TIER_STYLES: Record<GameCompatibility['tier'], string> = {
  platinum: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400',
  gold: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-500',
  silver: 'bg-slate-400/20 text-slate-600 dark:text-slate-300',
  bronze: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  borked: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

export type CompatibilityBadgesProps = {
  proton: GameCompatibility;
};

export const CompatibilityBadges = ({ proton }: CompatibilityBadgesProps) => {
  const deck = DECK_STYLES[proton.steamDeck];
  return (
    <div
      className="flex flex-wrap items-center gap-1"
      data-testid="compat-badges"
    >
      {deck && (
        <Badge
          data-testid="deck-badge"
          data-status={proton.steamDeck}
          title="Steam Deck compatibility"
          className={deck.className}
        >
          {deck.label}
        </Badge>
      )}
      <Badge
        data-testid="proton-tier-badge"
        data-tier={proton.tier}
        title={`ProtonDB: ${proton.tier}`}
        className={cn(TIER_STYLES[proton.tier])}
      >
        {proton.tier}
      </Badge>
    </div>
  );
};
