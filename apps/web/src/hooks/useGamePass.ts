import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CatalogGame, InterestsResponse } from '@/types/api';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3010';

async function fetchCatalog(): Promise<CatalogGame[]> {
  const res = await fetch(`${API_BASE}/api/catalog`);
  if (!res.ok) throw new Error('Failed to fetch catalog');
  return res.json() as Promise<CatalogGame[]>;
}

async function fetchInterests(): Promise<InterestsResponse> {
  const res = await fetch(`${API_BASE}/api/interests`);
  if (!res.ok) throw new Error('Failed to fetch interests');
  return res.json() as Promise<InterestsResponse>;
}

async function addInterest(name: string): Promise<InterestsResponse> {
  const res = await fetch(`${API_BASE}/api/interests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error('Failed to add interest');
  return res.json() as Promise<InterestsResponse>;
}

async function removeInterest(name: string): Promise<InterestsResponse> {
  const res = await fetch(`${API_BASE}/api/interests/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to remove interest');
  return res.json() as Promise<InterestsResponse>;
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: fetchCatalog });
}

export function useInterests() {
  return useQuery({ queryKey: ['interests'], queryFn: fetchInterests });
}

export function useAddInterest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addInterest,
    onSuccess: (data) => {
      queryClient.setQueryData(['interests'], data);
    },
  });
}

export function useRemoveInterest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeInterest,
    onSuccess: (data) => {
      queryClient.setQueryData(['interests'], data);
    },
  });
}
