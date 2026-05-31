import { CatalogGrid } from '@/components/CatalogGrid';

function App() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold tracking-tight">🎮 GameKeeper</h1>
        <p className="text-sm text-muted-foreground">Game Pass Catalog</p>
      </header>
      <main className="px-6 py-6">
        <CatalogGrid />
      </main>
    </div>
  );
}

export default App

