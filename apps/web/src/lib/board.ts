import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GameStatusResult, LibraryResponse, UnpinResult } from '@gamekeeper/shared';
import { applyMove, type MoveRequest } from '@/features/board/board-utils';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3010';

const fetchLibrary = async (): Promise<LibraryResponse> => {
  const res = await fetch(`${API_BASE}/api/library`);
  if (!res.ok) throw new Error('Failed to fetch library');
  return res.json() as Promise<LibraryResponse>;
};

const patchGameStatus = async (input: MoveRequest): Promise<GameStatusResult> => {
  const res = await fetch(
    `${API_BASE}/api/games/${encodeURIComponent(input.id)}/status`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: input.status,
        beforeId: input.beforeId,
        afterId: input.afterId,
      }),
    },
  );
  if (!res.ok) throw new Error('Failed to move game');
  return res.json() as Promise<GameStatusResult>;
};

const postUnpin = async (id: string): Promise<UnpinResult> => {
  const res = await fetch(
    `${API_BASE}/api/library/games/${encodeURIComponent(id)}/unpin`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error('Failed to unpin game');
  return res.json() as Promise<UnpinResult>;
};

export const useBoard = () => {
  return useQuery({ queryKey: ['board'], queryFn: fetchLibrary });
};

export const useMoveGame = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchGameStatus,
    onMutate: async (input: MoveRequest) => {
      await queryClient.cancelQueries({ queryKey: ['board'] });
      const prev = queryClient.getQueryData<LibraryResponse>(['board']);
      if (prev) queryClient.setQueryData(['board'], applyMove(prev, input));
      return { prev };
    },
    onError: (_error, _input, context) => {
      if (context?.prev) queryClient.setQueryData(['board'], context.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
};

export const useUnpinGame = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postUnpin,
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['board'] });
      const prev = queryClient.getQueryData<LibraryResponse>(['board']);
      if (prev) {
        queryClient.setQueryData<LibraryResponse>(['board'], {
          ...prev,
          games: prev.games.map(game =>
            game.canonicalId === id ? { ...game, pinned: false } : game,
          ),
        });
      }
      return { prev };
    },
    onError: (_error, _id, context) => {
      if (context?.prev) queryClient.setQueryData(['board'], context.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
    },
  });
};
