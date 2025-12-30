# Configuring Notion Sync Properties

You can now control which properties are synced to your Notion database using environment variables.

## How It Works

By default, **all properties are enabled**. You can selectively disable properties you don't want to sync by setting their corresponding environment variable to `false`.

## Available Configuration Options

Add these to your `.env` file:

```bash
# Disable specific properties by setting to 'false'
# All properties are enabled by default if not specified

NOTION_SYNC_CANONICAL_ID=false      # Disable syncing Canonical ID
NOTION_SYNC_PRIMARY_SOURCE=false    # Disable syncing Primary Source
NOTION_SYNC_OWNED_ON=false          # Disable syncing Owned On
NOTION_SYNC_STEAM_APP_ID=false      # Disable syncing Steam App ID
NOTION_SYNC_PLAYTIME=false          # Disable syncing Playtime
NOTION_SYNC_LAST_PLAYED=false       # Disable syncing Last Played date
NOTION_SYNC_PROTON_TIER=false       # Disable syncing ProtonDB tier
NOTION_SYNC_STEAM_DECK=false        # Disable syncing Steam Deck status
NOTION_SYNC_COVER_IMAGE=false       # Disable syncing Cover Image URL
NOTION_SYNC_LIBRARY_STATUS=false    # Disable syncing Library Status (removed games flag)
```

## What Each Property Does

| Property             | Description                       | Type         | Always Synced |
| -------------------- | --------------------------------- | ------------ | ------------- |
| **Name**             | Game name                         | Title        | ✅ Yes        |
| **Canonical ID**     | Unique game identifier            | Text         | Configurable  |
| **Primary Source**   | Main platform (Steam, Xbox, etc.) | Select       | Configurable  |
| **Owned On**         | All platforms where game is owned | Multi-select | Configurable  |
| **Steam App ID**     | Steam application ID              | Number       | Configurable  |
| **Playtime (hours)** | Total hours played                | Number       | Configurable  |
| **Last Played**      | Last time game was played         | Date         | Configurable  |
| **Proton Tier**      | ProtonDB compatibility tier       | Select       | Configurable  |
| **Steam Deck**       | Steam Deck verification status    | Select       | Configurable  |
| **Cover Image**      | Game cover image URL              | URL          | Configurable  |
| **Library Status**   | Flags games removed from library  | Select       | Configurable  |

**Note:** The `Name` property is always synced as it's the primary identifier in Notion.

## Example Configurations

### Minimal Setup (Only game names and sources)

```bash
NOTION_SYNC_CANONICAL_ID=false
NOTION_SYNC_STEAM_APP_ID=false
NOTION_SYNC_PLAYTIME=false
NOTION_SYNC_LAST_PLAYED=false
NOTION_SYNC_PROTON_TIER=false
NOTION_SYNC_STEAM_DECK=false
NOTION_SYNC_COVER_IMAGE=false
```

### PC Gaming Focus (Include ProtonDB data)

```bash
NOTION_SYNC_OWNED_ON=false
NOTION_SYNC_PLAYTIME=false
NOTION_SYNC_LAST_PLAYED=false
# ProtonDB and Steam Deck enabled by default
```

### Playtime Tracking Focus

```bash
NOTION_SYNC_CANONICAL_ID=false
NOTION_SYNC_STEAM_APP_ID=false
NOTION_SYNC_PROTON_TIER=false
NOTION_SYNC_STEAM_DECK=false
# Playtime and Last Played enabled by default
```

## Database Setup

**Important:** You only need to create properties in Notion for the fields you're syncing.

1. If you disable a property in `.env`, you **don't need to create it** in Notion
2. If you enable a property (or leave it enabled by default), you **must create it** in Notion with the correct type

### Example: Minimal Database Setup

If you're using the "Minimal Setup" above, your Notion database only needs:

- ✅ Name (Title)
- ✅ Primary Source (Select)

You can skip creating the other properties entirely.

## Benefits

✅ **Simpler database structure** - Only include what you need  
✅ **Faster sync** - Less data to transfer  
✅ **Cleaner UI** - Avoid cluttered Notion pages  
✅ **Flexibility** - Easy to enable/disable properties as needs change

## Changing Configuration

1. Update your `.env` file with the desired settings
2. If enabling a previously disabled property, create it in Notion first
3. Run the sync - it will only update the enabled properties
4. Existing pages will retain their old values for disabled properties
