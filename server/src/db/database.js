import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, '..', '..');
const migrationsDir = path.join(currentDir, 'migrations');

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

  runMigrations(db);

  return db;
}

export function runMigrations(db) {
  const appliedMigrations = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name),
  );

  const migrationFiles = readdirSync(migrationsDir)
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  const applyMigration = db.transaction((fileName, sql) => {
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(fileName);
  });

  for (const fileName of migrationFiles) {
    if (appliedMigrations.has(fileName)) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, fileName), 'utf8');
    applyMigration(fileName, sql);
  }
}

export function createDatabase(options = {}) {
  return initializeDatabase(openDatabase(options));
}

export function checkDatabase(db) {
  db.prepare('SELECT 1 AS ok').get();
  return 'ok';
}
