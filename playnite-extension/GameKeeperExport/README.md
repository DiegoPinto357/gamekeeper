# GameKeeper Playnite Extension

Export your Epic, GOG, Amazon, and Xbox games from Playnite to a lightweight JSON file for use with GameKeeper.

## Features

- ✅ Exports only Epic, GOG, Amazon, and Xbox games (excludes Steam)
- ✅ Minimal file size (~100-500 KB vs 10+ MB full export)
- ✅ Only includes essential fields (Name, Source, Playtime, Last Activity, etc.)
- ✅ Accessible from Playnite's Extensions menu
- ✅ Choose where to save the export file

## Installation on Windows PC

### Step 1: Locate Playnite Extensions Folder

1. Open Windows Explorer
2. Navigate to: `%AppData%\Playnite\Extensions`
   - Quick: Press `Win + R`, type `%AppData%\Playnite\Extensions`, press Enter
3. If the folder doesn't exist, create it

### Step 2: Copy Extension Files

1. Copy the entire `playnite-extension` folder from this repo
2. Rename it to `GameKeeperExport` (remove the `-extension` suffix)
3. Paste into the Playnite Extensions folder

**Final structure should be:**

```
%AppData%\Playnite\Extensions\
└── GameKeeperExport\
    ├── extension.yaml
    ├── export.ps1
    └── (this README.md - optional)
```

### Step 3: Restart Playnite

1. Close Playnite completely
2. Reopen Playnite
3. The extension will be automatically loaded

### Step 4: Verify Installation

1. In Playnite, go to **Extensions** menu (top menu bar)
2. Look for **GameKeeper** section
3. You should see **"Export for GameKeeper"** menu item

## Usage

### Export Games

1. Open Playnite
2. Click **Extensions** → **GameKeeper** → **Export for GameKeeper**
3. Choose where to save the file (default: `Documents\gamekeeper-export.json`)
4. Click Save
5. You'll see a success message with game count and file size

### Transfer to Mac

After exporting, transfer the JSON file to your Mac using:

- **Cloud Storage**: OneDrive, Google Drive, Dropbox, iCloud Drive
- **Network Share**: SMB/CIFS share between Windows and Mac
- **USB Drive**: Copy manually
- **Git**: Commit the export to this repo (add to `.gitignore` if you don't want to version it)

### Update GameKeeper Path

Update the path in your GameKeeper sync to point to the exported file:

```typescript
// In src/index.ts
const playniteGames = await playniteAdapter.loadSnapshot(
  './data/gamekeeper-export.json' // or wherever you saved it
);
```

## Troubleshooting

### Extension doesn't appear in menu

1. Check folder structure matches exactly: `%AppData%\Playnite\Extensions\GameKeeperExport\`
2. Verify files are named correctly: `extension.yaml` and `export.ps1`
3. Restart Playnite again
4. Check Playnite logs: `%AppData%\Playnite\playnite.log`

### Export fails

1. Make sure you have write permissions to the export location
2. Try exporting to `Documents` folder instead
3. Check Playnite logs for detailed error messages

### Empty export file

- Verify you have Epic, GOG, Amazon, or Xbox games in your Playnite library
- Steam games are intentionally excluded (they come from Steam API)

## Updating the Extension

To update:

1. Pull latest changes from this repo
2. Copy updated files to `%AppData%\Playnite\Extensions\GameKeeperExport\`
3. Restart Playnite

## Uninstallation

1. Close Playnite
2. Delete folder: `%AppData%\Playnite\Extensions\GameKeeperExport\`
3. Restart Playnite

## Export File Format

The exported JSON is an array of game objects:

```json
[
  {
    "Id": "game-uuid",
    "Name": "Game Title",
    "Source": {
      "Id": "source-uuid",
      "Name": "Xbox"
    },
    "Playtime": 7200,
    "LastActivity": "2024-12-28T10:30:00",
    "ReleaseDate": {
      "ReleaseDate": "2024-01-15"
    },
    "Genres": [
      {
        "Id": "genre-uuid",
        "Name": "Action"
      }
    ],
    "CoverImage": "cover-uuid.jpg"
  }
]
```

## Technical Details

- **Language**: PowerShell
- **Playnite SDK**: Script Extension API
- **File Size**: Typically 100-500 KB (vs 10+ MB for full export)
- **Export Time**: < 1 second for most libraries
- **Supported Sources**: Epic Games, GOG, Amazon, Xbox, Microsoft Store

## Version History

- **1.0** (2025-12-28): Initial release
  - Menu-based export
  - Filters Epic, GOG, Amazon, Xbox games
  - Minimal JSON output
