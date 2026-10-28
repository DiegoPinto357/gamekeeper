import { Badge } from '@/components/ui/badge';

/**
 * Renders when a game left its source's catalog (e.g. delisted from
 * Game Pass) — the DB stores the reason on games.unavailable_reason.
 */
export const UnavailableBadge = () => (
  <Badge variant="destructive" data-testid="unavailable-badge">
    Not available
  </Badge>
);
