import { Moon, Sun } from 'lucide-react';
import { CatalogGrid } from '@/components/CatalogGrid';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/useTheme';

function App() {
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">🎮 GameKeeper</h1>
          <p className="text-sm text-muted-foreground">Game Pass Catalog</p>
        </div>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun className="size-5" /> : <Moon className="size-5" />}
        </Button>
      </header>
      <main className="px-6 py-6">
        <CatalogGrid />
      </main>
    </div>
  );
}

export default App

