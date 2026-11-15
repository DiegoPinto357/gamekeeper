import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  ForceMergeRuleEntry,
  ForceMergeRulesResponse,
  OwnedGamesResponse,
  StatusEntry,
  StatusesResponse,
} from '@gamekeeper/shared';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3010';

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`Failed to ${init?.method ?? 'GET'} ${path}`);
  return res.json() as Promise<T>;
};

const postJson = <T>(path: string, method: string, body: unknown): Promise<T> =>
  fetchJson<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export function useStatuses() {
  return useQuery({
    queryKey: ['settings', 'statuses'],
    queryFn: () => fetchJson<StatusesResponse>('/api/statuses'),
  });
}

export function useSaveStatuses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (statuses: StatusEntry[]) =>
      postJson<StatusesResponse>('/api/statuses', 'PUT', { statuses }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'statuses'], data);
    },
  });
}

export function useOwnedGames() {
  return useQuery({
    queryKey: ['settings', 'owned-games'],
    queryFn: () => fetchJson<OwnedGamesResponse>('/api/owned-games'),
  });
}

export function useAddOwnedGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; platform?: string; notes?: string }) =>
      postJson<OwnedGamesResponse>('/api/owned-games', 'POST', input),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'owned-games'], data);
    },
  });
}

export function useRemoveOwnedGame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (canonicalId: string) =>
      fetchJson<OwnedGamesResponse>(
        `/api/owned-games/${encodeURIComponent(canonicalId)}`,
        { method: 'DELETE' },
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'owned-games'], data);
    },
  });
}

export function useForceMergeRules() {
  return useQuery({
    queryKey: ['settings', 'force-merge'],
    queryFn: () => fetchJson<ForceMergeRulesResponse>('/api/force-merge-rules'),
  });
}

export type ForceMergeRuleDraft = {
  games: string[];
  canonicalName?: string;
};

export function useAddForceMergeRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ForceMergeRuleDraft) =>
      postJson<ForceMergeRulesResponse>('/api/force-merge-rules', 'POST', input),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'force-merge'], data);
    },
  });
}

export function useUpdateForceMergeRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ForceMergeRuleDraft & { id: number }) => {
      const { id, ...body } = input;
      return postJson<ForceMergeRulesResponse>(
        `/api/force-merge-rules/${id}`,
        'PATCH',
        body,
      );
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'force-merge'], data);
    },
  });
}

export function useRemoveForceMergeRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      fetchJson<ForceMergeRulesResponse>(`/api/force-merge-rules/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'force-merge'], data);
    },
  });
}

export type { ForceMergeRuleEntry };
