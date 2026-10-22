import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { CatalogGrid } from '@/features/gamepass/CatalogGrid';
import { DiscoverPage } from '@/features/discover/DiscoverPage';
import { BoardPage } from '@/features/library/BoardPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/library" replace />} />
          <Route path="/library" element={<BoardPage />} />
          <Route path="/discover" element={<DiscoverPage />} />
          <Route path="/gamepass" element={<CatalogGrid />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
