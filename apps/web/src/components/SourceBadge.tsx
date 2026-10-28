import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Brand-ish colors per source, in the spirit of the Notion board tags. */
const SOURCE_STYLES: Record<string, string> = {
  steam: 'bg-slate-600 text-white hover:bg-slate-600',
  gamepass: 'bg-[#9BF00B] text-black hover:bg-[#9BF00B]',
  xbox: 'bg-[#107C10] text-white hover:bg-[#107C10]',
  epic: 'bg-[#2f3136] text-white hover:bg-[#2f3136]',
  gog: 'bg-[#86328A] text-white hover:bg-[#86328A]',
  amazon: 'bg-[#FF9900] text-black hover:bg-[#FF9900]',
};

export type SourceBadgeProps = {
  source: string;
  className?: string;
};

export const SourceBadge = ({ source, className }: SourceBadgeProps) => (
  <Badge
    data-testid="source-badge"
    data-source={source}
    className={cn(SOURCE_STYLES[source] ?? 'bg-secondary text-secondary-foreground', className)}
  >
    {source}
  </Badge>
);
