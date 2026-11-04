import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { CatalogGrid } from '@/features/gamepass/CatalogGrid';
import { LibraryPage } from '@/features/library/LibraryPage';
import { BoardPage } from '@/features/board/BoardPage';
import { DiscoverHub } from '@/features/discover/DiscoverHub';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/board" replace />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/discover" element={<DiscoverHub />} />
          <Route path="/gamepass" element={<CatalogGrid />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
