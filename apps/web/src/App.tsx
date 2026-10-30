import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { CatalogGrid } from '@/features/gamepass/CatalogGrid';
import { LibraryPage } from '@/features/library/LibraryPage';
import { BoardPage } from '@/features/board/BoardPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/board" replace />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/library" element={<LibraryPage />} />
          {/* temporary until the Discover hub lands (P4.4b) */}
          <Route path="/discover" element={<Navigate to="/board" replace />} />
          <Route path="/gamepass" element={<CatalogGrid />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
