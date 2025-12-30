# Notion Database Setup Guide

## Required Properties

Your Notion database needs the following properties (columns). Create them exactly as shown:

### 1. **Name** (Title)

- Type: `Title`
- This is created by default when you create a new database

### 2. **Canonical ID** (Text)

- Type: `Text`
- Used to identify unique games across sources

### 3. **Primary Source** (Select)

- Type: `Select`
- Options to add:
  - Steam
  - Xbox
  - Epic Games
  - GOG
  - Amazon
  - Game Pass
  - Manual

### 4. **Owned On** (Multi-select)

- Type: `Multi-select`
- Options to add (same as Primary Source):
  - Steam
  - Xbox
  - Epic Games
  - GOG
  - Amazon
  - Game Pass
  - Manual

### 5. **Steam App ID** (Number)

- Type: `Number`
- Format: Number (no decimals)

### 6. **Playtime (hours)** (Number)

- Type: `Number`
- Format: Number (1 decimal place recommended)

### 7. **Last Played** (Date)

- Type: `Date`
- Include time: No

### 8. **Proton Tier** (Select)

- Type: `Select`
- Options to add:
  - Platinum
  - Gold
  - Silver
  - Bronze
  - Borked

### 9. **Steam Deck** (Select)

- Type: `Select`
- Options to add:
  - Verified
  - Playable
  - Unsupported
  - Unknown

### 10. **Cover Image** (URL)

- Type: `URL`

### 11. **Library Status** (Select)

- Type: `Select`
- Options to add:
  - ⚠️ Removed
- Note: This field is automatically managed. Games currently in your library will have this empty (clean card appearance). Games no longer in your library will show "⚠️ Removed" so you can manually review/delete them.

## Quick Setup Steps

1. **Create a new database** in Notion (or use existing empty one)
2. **Rename the default "Name" column** if needed (it should already be Title type)
3. **Add each property** listed above by clicking the `+` button in the database header
4. **Select the correct type** for each property
5. **Add select options** for the Select and Multi-select properties
6. **Get your database ID**:
   - Open the database as a full page
   - Copy the URL - it looks like: `https://notion.so/your-workspace/DATABASE_ID?v=...`
   - The DATABASE_ID is the long string (32 characters) between the workspace name and the `?v=`
7. **Add to your `.env` file**:
   ```
   NOTION_DATABASE_ID=your-database-id-here
   ```

## Optional: Add More Properties

You can add additional properties for your own use:

- **Tags** (Multi-select) - For custom categorization
- **Rating** (Number) - Personal game rating
- **Status** (Select) - Playing, Completed, Backlog, etc.
- **Notes** (Text) - Personal notes about the game

The sync will only update the required properties listed above.
