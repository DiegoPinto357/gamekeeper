import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GameStatusResult, LibraryResponse } from '@gamekeeper/shared';
import { applyMove, type MoveRequest } from '@/features/library/board-utils';

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

export const useLibrary = () => {
  return useQuery({ queryKey: ['library'], queryFn: fetchLibrary });
};

export const useMoveGame = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: patchGameStatus,
    onMutate: async (input: MoveRequest) => {
      await queryClient.cancelQueries({ queryKey: ['library'] });
      const prev = queryClient.getQueryData<LibraryResponse>(['library']);
      if (prev) queryClient.setQueryData(['library'], applyMove(prev, input));
      return { prev };
    },
    onError: (_error, _input, context) => {
      if (context?.prev) queryClient.setQueryData(['library'], context.prev);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
  });
};
