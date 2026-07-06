import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, '..', '..');

export const defaultDatabasePath = path.join(serverRoot, 'data', 'library.sqlite');

export function resolveDatabasePath(databasePath = process.env.DATABASE_PATH) {
  return databasePath ? path.resolve(databasePath) : defaultDatabasePath;
}

export function openDatabase(options = {}) {
  const databasePath = resolveDatabasePath(options.databasePath);

  mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new Database(databasePath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

export function initializeDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

export function createDatabase(options = {}) {
  return initializeDatabase(openDatabase(options));
}

export function checkDatabase(db) {
  db.prepare('SELECT 1 AS ok').get();
  return 'ok';
}
