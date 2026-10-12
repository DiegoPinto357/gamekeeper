import type { DatabaseSync } from 'node:sqlite';

export interface StatusSeed {
  key: string;
  label: string;
  color: string;
}

export const DEFAULT_STATUSES: StatusSeed[] = [
  { key: 'backlog', label: 'Backlog', color: '#64748b' },
  { key: 'want_to_play', label: 'Want to Play', color: '#eab308' },
  { key: 'queued_to_play', label: 'Up Next', color: '#f97316' },
  { key: 'trying', label: 'Trying Out', color: '#a855f7' },
  { key: 'playing', label: 'Playing', color: '#22c55e' },
  { key: 'paused', label: 'Paused', color: '#0ea5e9' },
  { key: 'completed', label: 'Completed', color: '#14b8a6' },
  { key: 'dropped', label: 'Dropped', color: '#ef4444' },
];

export const seedStatuses = (db: DatabaseSync): number => {
  const stmt = db.prepare(
    'INSERT INTO statuses (key, label, position, color) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO NOTHING',
  );
  let inserted = 0;
  DEFAULT_STATUSES.forEach((status, position) => {
    const result = stmt.run(status.key, status.label, position, status.color);
    inserted += Number(result.changes);
  });
  return inserted;
};
