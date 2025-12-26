# Data Directory

Place your Playnite export file here:

```
data/playnite-export.json
```

## How to Export from Playnite

1. Open Playnite
2. Go to **Menu → Extensions → Scripts**
3. Look for an export script or use the built-in export feature
4. Export as JSON format
5. Save the file as `playnite-export.json` in this directory

## Expected Format

The JSON should have this structure:

```json
{
  "Games": [
    {
      "GameId": "unique-id",
      "Name": "Game Name",
      "Source": "Epic" | "GOG" | "Xbox",
      "Playtime": 3600,
      "LastActivity": "2024-01-01T00:00:00Z"
    }
  ]
}
```

If you don't have Playnite or don't want to export Epic/GOG/Xbox games, the sync will still work with Steam data only.
