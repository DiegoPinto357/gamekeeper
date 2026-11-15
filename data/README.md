# Data Directory

## Source of truth: SQLite

All user data lives in **`data/gamekeeper.db`** (gitignored, local-only):

| Table            | Contents                                            |
| ---------------- | --------------------------------------------------- |
| `interests`      | Game Pass interests (want-to-play list)             |
| `owned_games`    | Owned Xbox games (platform, notes)                  |
| `force_merge_rules` | Manual merge rules for duplicate titles          |
| `statuses`       | Board columns (label, color, order)                 |
| `game_status`    | Per-game status, position, pin state, notes         |
| `games`          | The synced library itself                           |

Edit this data through the app:

- **Game Pass page** — add/remove interests
- **Settings page** — status labels/colors/order, owned games, force-merge rules

The database is created and seeded automatically on first run. User data never
leaves this machine and must never be committed or pushed.

## Legacy JSON backups

These files are one-time import sources kept as a backup only (they are no
longer read after the initial import, and are candidates for untracking):

- `gamepass-interests.json` → `interests`
- `owned-xbox-games.json` → `owned_games`
- `overrides.json` → `force_merge_rules` + `property_overrides`

If the database is ever deleted, re-import happens automatically the next time
the app opens it **as long as these files are still present** with empty target
tables.

## Playnite export (historical)

The original import flow read a Playnite export:

```
data/playnite-export.json
```

See `playnite-export.example.json` for the expected format. The export is no
longer required — the sync works from Steam + the manual lists above.
