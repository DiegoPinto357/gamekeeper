import { useCallback, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  pointerWithin,
  type CollisionDetection,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { BACKLOG_KEY, applyFilters, groupGames, moveToEndNeighbors, resolveDrop, sourceOptions, type BoardFilters } from './board-utils';
import { BoardCardFace } from './BoardCard';
import { BoardColumn } from './BoardColumn';
import { BoardToolbar } from './BoardToolbar';
import { GameDrawer } from './GameDrawer';
import { useLibrary, useMoveGame, useUnpinGame } from '@/hooks/useLibrary';
import { useLocalStorage } from '@/hooks/useLocalStorage';

const FILTERS_KEY = 'gamekeeper.library.filters';

export const BoardPage = () => {
  const { data, isPending, isError } = useLibrary();
  const [filters, setFilters] = useLocalStorage<BoardFilters>(FILTERS_KEY, {
    q: '',
    source: '',
  });
  const moveGame = useMoveGame();
  const unpinMutation = useUnpinGame();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // closestCorners alone misfires on empty columns: the nearest corners often
  // belong to a card in a *neighboring* column, so the drop never resolves to
  // the empty column. pointerWithin only considers droppables the cursor is
  // actually inside; fall back to closestCorners for pointerless (keyboard) drags.
  const collisionDetection = useCallback<CollisionDetection>(args => {
    const pointerCollisions = pointerWithin(args);
    return pointerCollisions.length > 0
      ? pointerCollisions
      : closestCorners(args);
  }, []);

  const games = data?.games ?? [];
  const allGroups = groupGames(games);
  const visible = applyFilters(games, filters);
  const renderGroups = groupGames(visible);
  const sources = sourceOptions(games);
  const statuses = data?.statuses ?? [];
  const selectedGame = selectedId
    ? (games.find(game => game.canonicalId === selectedId) ?? null)
    : null;
  const activeGame = activeId
    ? (games.find(game => game.canonicalId === activeId) ?? null)
    : null;

  const handleMoveTo = (targetStatus: string) => {
    if (!selectedGame) return;
    const activeStatus = selectedGame.status ?? BACKLOG_KEY;
    const neighbors = moveToEndNeighbors(allGroups, activeStatus, targetStatus);
    if (!neighbors) return;
    moveGame.mutate({
      id: selectedGame.canonicalId,
      status: targetStatus,
      ...neighbors,
    });
  };

  if (isPending) {
    return <p className="py-24 text-center text-muted-foreground">Loading library…</p>;
  }
  if (isError || !data) {
    return (
      <p className="py-24 text-center text-destructive">Couldn&apos;t load the library.</p>
    );
  }

  const handleDragEnd = ({ active, over }: { active: { id: string | number }; over: { id: string | number } | null }) => {
    setActiveId(null);
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const overIsColumn = statuses.some(status => status.key === overId);
    const target = overIsColumn
      ? ({ kind: 'column', status: overId } as const)
      : ({ kind: 'card', id: overId } as const);
    const move = resolveDrop(allGroups, activeId, target);
    if (!move) return;
    moveGame.mutate({
      id: activeId,
      status: move.status,
      beforeId: move.beforeId,
      afterId: move.afterId,
    });
  };

  return (
    <div data-testid="library-board" className="flex h-full min-h-0 flex-col">
      <BoardToolbar
        filters={filters}
        onChange={setFilters}
        sources={sources}
        total={visible.length}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={({ active }) => setActiveId(String(active.id))}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-4">
          {statuses.map(status => (
            <BoardColumn
              key={status.key}
              status={status}
              games={renderGroups[status.key] ?? []}
              lazy={status.key === BACKLOG_KEY}
              onOpenCard={setSelectedId}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeGame ? (
            <BoardCardFace game={activeGame} className="cursor-grabbing shadow-lg" />
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedGame && (
        <GameDrawer
          game={selectedGame}
          statuses={statuses}
          onClose={() => setSelectedId(null)}
          onMove={handleMoveTo}
          onUnpin={() => unpinMutation.mutate(selectedGame.canonicalId)}
        />
      )}
    </div>
  );
};
