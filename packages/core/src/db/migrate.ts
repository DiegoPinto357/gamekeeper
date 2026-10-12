import type { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS } from './schema';

export { MIGRATIONS };

export const migrate = (db: DatabaseSync): number => {
  const row = db.prepare('PRAGMA user_version').get() as
    | { user_version: number }
    | undefined;
  let version = row?.user_version ?? 0;

  while (version < MIGRATIONS.length) {
    const next = MIGRATIONS[version];
    db.exec('BEGIN');
    try {
      db.exec(next);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    version += 1;
  }

  return version - (row?.user_version ?? 0);
};
