import { useState } from 'react';
import type { ForceMergeRuleEntry, StatusEntry } from '@gamekeeper/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useAddForceMergeRule,
  useAddOwnedGame,
  useForceMergeRules,
  useOwnedGames,
  useRemoveForceMergeRule,
  useRemoveOwnedGame,
  useSaveStatuses,
  useStatuses,
  useUpdateForceMergeRule,
} from '@/hooks/useSettings';

const parseGames = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map(part => part.trim())
    .filter(Boolean);

function StatusesSection() {
  const { data, isLoading, error } = useStatuses();
  const save = useSaveStatuses();
  const [draft, setDraft] = useState<StatusEntry[] | null>(null);
  const [synced, setSynced] = useState('');

  // Sync server data into the draft during render (avoids the
  // set-state-in-effect lint rule); only re-sync when the payload
  // actually changes so background refetches never clobber edits.
  if (data) {
    const serialized = JSON.stringify(data.statuses);
    if (serialized !== synced) {
      setSynced(serialized);
      setDraft(data.statuses);
    }
  }

  const dirty =
    draft != null &&
    data != null &&
    JSON.stringify(draft) !== JSON.stringify(data.statuses);

  const updateAt = (index: number, patch: Partial<StatusEntry>) => {
    setDraft(prev =>
      prev
        ? prev.map((status, i) => (i === index ? { ...status, ...patch } : status))
        : prev,
    );
    save.reset();
  };

  const move = (index: number, delta: -1 | 1) => {
    setDraft(prev => {
      if (!prev) return prev;
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    save.reset();
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading statuses…</p>;
  if (error)
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load statuses
      </p>
    );
  if (!draft) return null;

  return (
    <section data-testid="settings-statuses" className="space-y-3">
      <h3 className="text-lg font-medium">Status columns</h3>
      <p className="text-sm text-muted-foreground">
        Edit labels and colors, reorder with the arrows. Column keys stay fixed.
      </p>
      <ul className="space-y-2">
        {draft.map((status, index) => (
          <li key={status.key} className="flex items-center gap-2">
            <input
              type="color"
              aria-label={`Color for ${status.label}`}
              value={status.color}
              onChange={e => updateAt(index, { color: e.target.value })}
              className="h-9 w-10 rounded-md border bg-background px-1"
            />
            <Input
              aria-label={`Label for ${status.key}`}
              value={status.label}
              onChange={e => updateAt(index, { label: e.target.value })}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Move ${status.label} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Move ${status.label} down`}
              disabled={index === draft.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate(draft)}
        >
          Save statuses
        </Button>
        {save.isSuccess && !dirty && (
          <span className="text-sm text-green-600">Statuses saved</span>
        )}
        {save.isError && (
          <span role="alert" className="text-sm text-destructive">
            Save failed
          </span>
        )}
      </div>
    </section>
  );
}

function OwnedGamesSection() {
  const { data, isLoading, error } = useOwnedGames();
  const add = useAddOwnedGame();
  const remove = useRemoveOwnedGame();
  const [name, setName] = useState('');
  const [platform, setPlatform] = useState('xbox');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    add.mutate(
      { name: trimmed, platform: platform.trim() || 'xbox' },
      { onSuccess: () => setName('') },
    );
  };

  return (
    <section data-testid="settings-owned-games" className="space-y-3">
      <h3 className="text-lg font-medium">Owned Xbox games</h3>
      <p className="text-sm text-muted-foreground">
        Feeds the sync ownership check and the Game Pass “owned” badges.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Game name"
          placeholder="Game name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-56"
        />
        <Input
          aria-label="Platform"
          placeholder="Platform"
          value={platform}
          onChange={e => setPlatform(e.target.value)}
          className="w-32"
        />
        <Button type="submit" disabled={!name.trim() || add.isPending}>
          Add game
        </Button>
        {add.isError && (
          <span role="alert" className="text-sm text-destructive">
            Add failed
          </span>
        )}
      </form>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading owned games…</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Failed to load owned games
        </p>
      )}
      <ul className="space-y-1" data-testid="owned-games-list">
        {data?.ownedGames.map(game => (
          <li
            key={game.canonicalId}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <span>
              {game.name}{' '}
              <span className="text-muted-foreground">({game.platform})</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove ${game.name}`}
              onClick={() => remove.mutate(game.canonicalId)}
            >
              Remove
            </Button>
          </li>
        ))}
        {data?.ownedGames.length === 0 && (
          <li className="text-sm text-muted-foreground">No owned games yet.</li>
        )}
      </ul>
      {remove.isError && (
        <p role="alert" className="text-sm text-destructive">
          Remove failed
        </p>
      )}
    </section>
  );
}

function ForceMergeSection() {
  const { data, isLoading, error } = useForceMergeRules();
  const add = useAddForceMergeRule();
  const update = useUpdateForceMergeRule();
  const remove = useRemoveForceMergeRule();
  const [gamesText, setGamesText] = useState('');
  const [canonicalName, setCanonicalName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);

  const mutation = editingId != null ? update : add;
  const dirty = gamesText.trim().length > 0 || canonicalName.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const games = parseGames(gamesText);
    if (games.length === 0) return;
    const canonical = canonicalName.trim();
    const payload = canonical ? { games, canonicalName: canonical } : { games };

    if (editingId != null) {
      update.mutate({ id: editingId, ...payload }, { onSuccess: reset });
    } else {
      add.mutate(payload, { onSuccess: reset });
    }
  };

  const reset = () => {
    setGamesText('');
    setCanonicalName('');
    setEditingId(null);
  };

  const startEdit = (rule: ForceMergeRuleEntry) => {
    setEditingId(rule.id);
    setGamesText(rule.games.join(', '));
    setCanonicalName(rule.canonicalName ?? '');
  };

  return (
    <section data-testid="settings-force-merge" className="space-y-3">
      <h3 className="text-lg font-medium">Force-merge rules</h3>
      <p className="text-sm text-muted-foreground">
        Titles listed here are treated as the same game during sync (comma or
        newline separated).
      </p>
      <form onSubmit={submit} className="space-y-2">
        <textarea
          aria-label="Games to merge"
          placeholder="Disco Elysium, Disco Elysium - The Final Cut"
          value={gamesText}
          onChange={e => setGamesText(e.target.value)}
          rows={2}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Canonical name"
            placeholder="Canonical name (optional)"
            value={canonicalName}
            onChange={e => setCanonicalName(e.target.value)}
            className="w-64"
          />
          <Button type="submit" disabled={!dirty || mutation.isPending}>
            {editingId != null ? 'Save rule' : 'Add rule'}
          </Button>
          {editingId != null && (
            <Button type="button" variant="outline" onClick={reset}>
              Cancel
            </Button>
          )}
          {mutation.isError && (
            <span role="alert" className="text-sm text-destructive">
              {editingId != null ? 'Update failed' : 'Add failed'}
            </span>
          )}
        </div>
      </form>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Loading rules…</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          Failed to load rules
        </p>
      )}
      <ul className="space-y-1" data-testid="force-merge-list">
        {data?.rules.map(rule => (
          <li
            key={rule.id}
            className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
          >
            <span>
              {rule.canonicalName
                ? `${rule.games.join(', ')} → ${rule.canonicalName}`
                : rule.games.join(', ')}
            </span>
            <span className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Edit rule ${rule.games[0]}`}
                onClick={() => startEdit(rule)}
              >
                Edit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove rule ${rule.games[0]}`}
                onClick={() => remove.mutate(rule.id)}
              >
                Remove
              </Button>
            </span>
          </li>
        ))}
        {data?.rules.length === 0 && (
          <li className="text-sm text-muted-foreground">No merge rules yet.</li>
        )}
      </ul>
      {remove.isError && (
        <p role="alert" className="text-sm text-destructive">
          Remove failed
        </p>
      )}
    </section>
  );
}

export function SettingsPage() {
  return (
    <div
      className="mx-auto max-w-3xl space-y-10"
      data-testid="settings-page"
    >
      <div>
        <h2 className="text-xl font-semibold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Library labels, owned games and merge rules.
        </p>
      </div>
      <StatusesSection />
      <OwnedGamesSection />
      <ForceMergeSection />
    </div>
  );
}
