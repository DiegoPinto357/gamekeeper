import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3010';

export type SyncSummary = {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  errors: number;
  duration: number;
};

export type SyncEvent =
  | { type: 'step:start'; key: string; label: string; detail?: string }
  | { type: 'step:done'; key: string; label: string; detail?: string }
  | { type: 'step:skip'; key: string; label: string; detail?: string }
  | { type: 'step:error'; key: string; label: string; detail?: string }
  | { type: 'progress'; key: string; current: number; total: number }
  | { type: 'summary'; summary: SyncSummary };

export type SyncStepStatus = 'running' | 'done' | 'skip' | 'error';

export type SyncStepRow = {
  key: string;
  label: string;
  status: SyncStepStatus;
  detail?: string;
};

export type SyncRunStatus = 'idle' | 'running' | 'done' | 'error';

export type SyncState = {
  connected: boolean;
  status: SyncRunStatus;
  runId: string | null;
  steps: SyncStepRow[];
  progress: Record<string, { current: number; total: number }>;
  summary: SyncSummary | null;
};

export type SyncSnapshot = {
  type: 'snapshot';
  status: SyncRunStatus;
  runId: string | null;
  events: SyncEvent[];
  summary: SyncSummary | null;
};

export type SyncStartError = 'conflict' | 'request' | null;

const initialState: SyncState = {
  connected: false,
  status: 'idle',
  runId: null,
  steps: [],
  progress: {},
  summary: null,
};

const upsertStep = (
  steps: SyncStepRow[],
  event: Exclude<SyncEvent, { type: 'progress' | 'summary' }>,
  status: SyncStepStatus,
): SyncStepRow[] => {
  const row: SyncStepRow = {
    key: event.key,
    label: event.label,
    status,
    detail: event.detail,
  };
  return steps.some(step => step.key === event.key)
    ? steps.map(step => (step.key === event.key ? row : step))
    : [...steps, row];
};

export const applySyncEvent = (
  state: SyncState,
  event: SyncEvent | SyncSnapshot,
): SyncState => {
  if (event.type === 'snapshot') {
    let next: SyncState = { ...initialState, connected: true };
    for (const e of event.events) next = applySyncEvent(next, e);
    return {
      ...next,
      status: event.status,
      runId: event.runId,
      summary: event.summary ?? next.summary,
    };
  }

  if (event.type === 'summary') {
    return { ...state, status: 'done', summary: event.summary };
  }

  if (event.type === 'progress') {
    return {
      ...state,
      progress: {
        ...state.progress,
        [event.key]: { current: event.current, total: event.total },
      },
    };
  }

  // a step:start outside an active run means a new run just began —
  // drop whatever the previous run left behind
  const base =
    state.status === 'running'
      ? state
      : {
          ...state,
          status: 'running' as const,
          steps: [],
          progress: {},
          summary: null,
        };

  if (event.type === 'step:start') {
    return {
      ...base,
      steps: upsertStep(base.steps, event, 'running'),
    };
  }

  const terminalStatus: SyncStepStatus =
    event.type === 'step:done' ? 'done' : event.type === 'step:skip' ? 'skip' : 'error';
  return {
    ...base,
    steps: upsertStep(base.steps, event, terminalStatus),
  };
};

export const useSyncStats = (state: SyncState) => {
  const total = state.steps.length;
  const completed = state.steps.filter(step => step.status !== 'running').length;
  const running = state.steps.find(step => step.status === 'running');
  let fraction = 0;
  if (running) {
    const progress = state.progress[running.key];
    if (progress && progress.total > 0) {
      fraction = Math.min(1, progress.current / progress.total);
    }
  }
  const overall = total === 0 ? 0 : (completed + fraction) / total;
  return {
    total,
    completed,
    currentStep: completed + (running ? 1 : 0),
    overall,
  };
};

export function useSyncEvents() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SyncState>(initialState);
  const [startError, setStartError] = useState<SyncStartError>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/sync/events`);

    source.onopen = () => {
      setState(prev => ({ ...prev, connected: true }));
    };
    source.onerror = () => {
      setState(prev => ({ ...prev, connected: false }));
    };
    source.onmessage = message => {
      let payload: SyncEvent | SyncSnapshot;
      try {
        payload = JSON.parse(message.data) as SyncEvent | SyncSnapshot;
      } catch {
        return;
      }
      setState(prev => applySyncEvent(prev, payload));
      if (payload.type === 'summary') {
        void queryClient.invalidateQueries({ queryKey: ['catalog'] });
        void queryClient.invalidateQueries({ queryKey: ['interests'] });
        void queryClient.invalidateQueries({ queryKey: ['library'] });
        // reserved for P4:
        // void queryClient.invalidateQueries({ queryKey: ['discover'] });
      }
    };

    return () => source.close();
  }, [queryClient]);

  const start = useCallback(async (skipNotion: boolean) => {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skipNotion }),
      });
      if (response.status === 409) {
        setStartError('conflict');
        return;
      }
      if (!response.ok) {
        setStartError('request');
        return;
      }
      const body = (await response.json()) as { runId: string };
      setState(prev => ({
        ...prev,
        status: 'running',
        runId: body.runId,
        steps: [],
        progress: {},
        summary: null,
      }));
    } catch {
      setStartError('request');
    } finally {
      setStarting(false);
    }
  }, []);

  return { state, startError, starting, start };
}
