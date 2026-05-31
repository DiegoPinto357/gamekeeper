import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  interestCount: number;
}

export function SearchBar({ value, onChange, interestCount }: SearchBarProps) {
  return (
    <div className="flex items-center gap-3">
      <Input
        placeholder="Search games..."
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className="max-w-sm"
      />
      {interestCount > 0 && (
        <Badge variant="secondary">
          {interestCount} interest{interestCount !== 1 ? 's' : ''}
        </Badge>
      )}
    </div>
  );
}
