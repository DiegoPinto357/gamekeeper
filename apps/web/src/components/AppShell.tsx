import { useState } from 'react';
import { NavLink, Outlet } from 'react-router';
import { Moon, Play, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SyncPanel } from '@/components/SyncPanel';
import { useSyncEvents } from '@/hooks/useSyncEvents';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/library', label: 'Library' },
  { to: '/discover', label: 'Discover' },
  { to: '/gamepass', label: 'Game Pass' },
] as const;

export function AppShell() {
  const { theme, toggle } = useTheme();
  const [syncOpen, setSyncOpen] = useState(false);
  const { state, startError, starting, start } = useSyncEvents();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">🎮 GameKeeper</h1>
            <p className="text-sm text-muted-foreground">Your game library</p>
          </div>
          <nav className="flex items-center gap-1">
            {navItems.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-secondary text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setSyncOpen(true)}>
            <Play aria-hidden />
            Sync
          </Button>
          <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
            {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </Button>
        </div>
      </header>
      <main className="px-6 py-6">
        <Outlet />
      </main>
      <SyncPanel
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        state={state}
        startError={startError}
        starting={starting}
        onStart={start}
      />
    </div>
  );
}
