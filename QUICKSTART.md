# Quick Start Guide

Get GameKeeper running in 5 minutes.

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment

```bash
# Copy the template
cp .env.example .env

# Edit with your credentials
nano .env
```

Required values:
- **STEAM_API_KEY** - Get from https://steamcommunity.com/dev/apikey
- **STEAM_USER_ID** - Your 64-bit Steam ID from https://steamid.io/
- **NOTION_API_KEY** - Create integration at https://www.notion.so/my-integrations
- **NOTION_DATABASE_ID** - From your Notion database URL

## 3. Set Up Notion Database

Create a new database in Notion with these properties:

```
Name (Title)
Canonical ID (Text)
Primary Source (Select)
Owned On (Multi-select)
Steam App ID (Number)
Playtime (hours) (Number)
Last Played (Date)
Proton Tier (Select)
Steam Deck (Select)
Cover Image (URL)
```

Share the database with your Notion integration.

## 4. (Optional) Export from Playnite

If you use Epic, GOG, or Xbox:

1. Open Playnite
2. Export your library as JSON
3. Save to `data/playnite-export.json`

If you skip this, GameKeeper will only sync Steam games.

## 5. Validate Setup

```bash
npm run validate
```

This checks that all configuration is correct.

## 6. Run First Sync

```bash
npm run dev
```

The first sync will:
- Fetch all your Steam games
- Load Playnite snapshot (if available)
- Deduplicate across platforms
- Enrich with ProtonDB data (this takes time!)
- Sync everything to Notion

## 7. Subsequent Syncs

Just run `npm run dev` again. The sync is idempotent - it will update existing games and add new ones.

## Troubleshooting

### "Steam API error"
- Check your API key and Steam ID
- Make sure your Steam profile is public

### "Cannot access Notion database"
- Verify the integration has access to the database
- Check the database ID is correct

### "Playnite export not found"
- This is optional - skip if you only use Steam
- Otherwise, export from Playnite to `data/playnite-export.json`

## Next Steps

- Set up a cron job or scheduled task to run syncs automatically
- Customize the Notion database with views and filters
- Add manual games if needed (coming soon)

## Need Help?

See the full README.md for detailed documentation.
