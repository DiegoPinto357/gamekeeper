# Sync Logs

This directory contains logs from Notion sync operations. Logs are automatically generated each time you run the sync and track:

- **Games Added**: New games created in Notion
- **Games Updated**: Existing games with property changes
- **Games Removed**: Games no longer in your library (marked with `⚠️ Removed` status)
- **Games Skipped**: Count of games with no changes
- **Errors**: Count of failures during sync

## Log Format

Logs are saved as simple JSON files with game names organized by operation type.

**File naming**: `sync-YYYY-MM-DDTHH-MM-SS.json` (ISO 8601 timestamp)

**Example**:

```json
{
  "timestamp": "2026-03-22T15:30:45.123Z",
  "duration": 12500,
  "added": ["Baldur's Gate 3", "Cyberpunk 2077", "Hades"],
  "updated": ["Elden Ring", "The Witcher 3: Wild Hunt"],
  "removed": ["Old Game Title"],
  "skipped": 131,
  "errors": 0
}
```

### Fields

- `timestamp`: ISO 8601 timestamp when sync completed
- `duration`: Time taken in milliseconds
- `added`: Array of game names added to Notion (sorted alphabetically)
- `updated`: Array of game names updated in Notion (sorted alphabetically)
- `removed`: Array of game names marked as removed (sorted alphabetically)
- `skipped`: Count of games with no changes
- `errors`: Count of failed operations

## Usage Examples

### Using jq

```bash
# Get summary
jq '{added: (.added | length), updated: (.updated | length), removed: (.removed | length)}' logs/sync-*.json

# List all added games
jq '.added[]' logs/sync-*.json

# List all removed games
jq '.removed[]' logs/sync-*.json

# Find logs with errors
jq 'select(.errors > 0)' logs/*.json

# Get total duration across all syncs
jq '.duration' logs/*.json | awk '{sum+=$1} END {print sum/1000 " seconds"}'

# Count total games added across all syncs
jq '.added | length' logs/*.json | awk '{sum+=$1} END {print sum " games"}'
```

### Using grep

```bash
# Find syncs that added a specific game
grep -l "Cyberpunk 2077" logs/*.json

# Find all syncs with errors
grep -l '"errors": [1-9]' logs/*.json
```

### Track a specific game

```bash
# See all syncs where a game was updated
jq --arg game "The Witcher 3: Wild Hunt" 'select(.updated[] == $game) | {timestamp, game: $game}' logs/*.json

# Check if a game was recently added
jq --arg game "Baldur's Gate 3" 'select(.added[] == $game) | .timestamp' logs/sync-*.json | tail -1
```

### Analysis

```bash
# Compare two sync logs
diff <(jq -S . logs/sync-2026-03-22T15-30-45.json) <(jq -S . logs/sync-2026-03-22T16-30-45.json)

# Get stats for latest sync
jq '{
  timestamp,
  duration_seconds: (.duration / 1000),
  total_operations: ((.added | length) + (.updated | length) + (.removed | length) + .skipped + .errors),
  added: (.added | length),
  updated: (.updated | length),
  removed: (.removed | length),
  skipped,
  errors
}' logs/sync-*.json | tail -1
```

## Console Output

Each sync also prints a summary to the console:

```
📊 Sync Summary:
   Duration: 12.50s
   Total: 150 games
   ✅ Added: 5
   🔄 Updated: 12
   ⚠️  Removed: 2
   ⏭️  Skipped: 131
📝 Log saved to: logs/sync-2026-03-22T15-30-45.json
```

## Log Retention

Logs are stored indefinitely by default. Consider:

- Archiving old logs periodically
- Deleting logs older than a certain date
- Compressing historical logs

Example cleanup script:

```bash
# Delete logs older than 30 days
find logs/ -name "sync-*.json" -mtime +30 -delete

# Archive logs older than 90 days
find logs/ -name "sync-*.json" -mtime +90 -exec gzip {} \;
```
