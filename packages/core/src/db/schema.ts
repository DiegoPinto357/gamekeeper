export const MIGRATIONS: string[] = [
  `
  CREATE TABLE statuses (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    position INTEGER NOT NULL,
    color TEXT NOT NULL
  );

  CREATE TABLE game_status (
    canonical_id TEXT PRIMARY KEY,
    status TEXT NOT NULL REFERENCES statuses(key),
    position REAL,
    notes TEXT,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE interests (
    catalog_product_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    canonical_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE owned_games (
    canonical_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'xbox',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE force_merge_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_ids TEXT NOT NULL DEFAULT '[]',
    match_names TEXT NOT NULL DEFAULT '[]',
    canonical_name TEXT,
    position REAL
  );

  CREATE TABLE property_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT,
    match_name TEXT,
    properties TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE games (
    canonical_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    primary_source TEXT NOT NULL,
    owned_sources TEXT NOT NULL DEFAULT '[]',
    steam_app_id INTEGER,
    playtime_hours REAL,
    last_played_at TEXT,
    cover_image_url TEXT,
    release_date TEXT,
    interest TEXT,
    proton_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    raw_json TEXT,
    igdb_id INTEGER,
    meta_source TEXT,
    enriched_at TEXT
  );

  CREATE INDEX idx_games_name ON games(name);
  CREATE INDEX idx_games_primary_source ON games(primary_source);

  CREATE TABLE genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE game_genres (
    canonical_id TEXT NOT NULL REFERENCES games(canonical_id) ON DELETE CASCADE,
    genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (canonical_id, genre_id)
  );

  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE game_tags (
    canonical_id TEXT NOT NULL REFERENCES games(canonical_id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (canonical_id, tag_id)
  );

  CREATE TABLE similar_games (
    canonical_id TEXT NOT NULL REFERENCES games(canonical_id) ON DELETE CASCADE,
    similar_canonical_id TEXT NOT NULL,
    score REAL,
    rank INTEGER,
    PRIMARY KEY (canonical_id, similar_canonical_id)
  );

  CREATE VIRTUAL TABLE games_fts USING fts5(
    canonical_id UNINDEXED,
    name,
    tokenize = 'porter unicode61'
  );
  `,
  `
  CREATE TRIGGER game_status_touch_updated_at
  AFTER UPDATE ON game_status
  FOR EACH ROW
  BEGIN
    UPDATE game_status
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE canonical_id = NEW.canonical_id;
  END;
  `,
  `
  INSERT INTO statuses (key, label, position, color)
  VALUES ('recurrent', 'Recurrent', 4, '#ec4899')
  ON CONFLICT(key) DO NOTHING;

  UPDATE statuses SET position = CASE key
    WHEN 'backlog' THEN 0
    WHEN 'want_to_play' THEN 1
    WHEN 'queued_to_play' THEN 2
    WHEN 'trying' THEN 3
    WHEN 'recurrent' THEN 4
    WHEN 'playing' THEN 5
    WHEN 'paused' THEN 6
    WHEN 'completed' THEN 7
    WHEN 'dropped' THEN 8
  END
  WHERE key IN (
    'backlog', 'want_to_play', 'queued_to_play', 'trying', 'recurrent',
    'playing', 'paused', 'completed', 'dropped'
  );
  `,
  `
  -- P2.1: catalog-availability flag (e.g. left Game Pass), written by the
  -- sync availability step, keyed by canonical id (the JSON report has names only)
  ALTER TABLE games ADD COLUMN unavailable_reason TEXT;
  `,
];
