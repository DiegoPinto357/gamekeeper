import { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  MinusCircle,
  Play,
  RefreshCw,
  X,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  useSyncStats,
  type SyncStartError,
  type SyncState,
  type SyncStepStatus,
} from '@/hooks/useSyncEvents';
import { cn } from '@/lib/utils';

export interface SyncPanelProps {
  open: boolean;
  onClose: () => void;
  state: SyncState;
  startError: SyncStartError;
  starting: boolean;
  onStart: (skipNotion: boolean) => void;
}

const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

function StepIcon({ status }: { status: SyncStepStatus }) {
  if (status === 'done') {
    return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-500" />;
  }
  if (status === 'error') {
    return <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />;
  }
  if (status === 'skip') {
    return <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />;
  }
  return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />;
}

export function SyncPanel({
  open,
  onClose,
  state,
  startError,
  starting,
  onStart,
}: SyncPanelProps) {
  const [alsoNotion, setAlsoNotion] = useState(false);
  const { total, currentStep, overall } = useSyncStats(state);
  const running = state.status === 'running';

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        data-testid="sync-backdrop"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Sync"
        className="fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l bg-background shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <RefreshCw className={cn('size-4', running && 'animate-spin')} aria-hidden />
            Sync
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close sync panel">
            <X aria-hidden />
          </Button>
        </div>

        <div className="border-b px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={alsoNotion}
              onChange={event => setAlsoNotion(event.target.checked)}
              disabled={running}
              className="size-4 accent-primary"
            />
            Also sync Notion
          </label>
          <Button
            className="mt-3 w-full"
            onClick={() => onStart(!alsoNotion)}
            disabled={running || starting}
          >
            <Play aria-hidden />
            {running ? 'Syncing…' : 'Start'}
          </Button>
          {startError === 'conflict' && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">
              Sync already running — showing its progress below.
            </p>
          )}
          {startError === 'request' && (
            <p className="mt-2 text-xs text-destructive">Could not start sync.</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {state.steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {running ? 'Waiting for sync to start…' : 'No sync runs yet.'}
            </p>
          ) : (
            <ol className="space-y-2.5">
              {state.steps.map(step => {
                const progress = state.progress[step.key];
                return (
                  <li key={step.key} className="flex items-start gap-2 text-sm">
                    <StepIcon status={step.status} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{step.label}</span>
                        {step.status === 'running' && progress && (
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {progress.current}/{progress.total}
                          </span>
                        )}
                      </div>
                      {step.detail && (
                        <p className="text-xs text-muted-foreground">{step.detail}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {(total > 0 || state.summary) && (
          <div className="border-t px-4 py-3 text-xs text-muted-foreground">
            {total > 0 && (
              <div className="flex items-center justify-between">
                <span>
                  Step {currentStep}/{total} · {Math.round(overall * 100)}%
                </span>
                {state.connected ? (
                  <span className="flex items-center gap-1">
                    <span className="size-1.5 rounded-full bg-green-500" aria-hidden />
                    live
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <span
                      className="size-1.5 rounded-full bg-muted-foreground/50"
                      aria-hidden
                    />
                    reconnecting…
                  </span>
                )}
              </div>
            )}
            {state.summary && (
              <p className={cn('mt-1.5', total === 0 && 'mt-0')} data-testid="sync-summary">
                Added {state.summary.added} · Updated {state.summary.updated} · Removed{' '}
                {state.summary.removed}
                {state.summary.errors > 0 && ` · Errors ${state.summary.errors}`} ·{' '}
                {formatDuration(state.summary.duration)}
              </p>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
