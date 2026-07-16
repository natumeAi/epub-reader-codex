import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function restoreEnvironmentVariable(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = previousValue;
}

export async function createTestEnvironment(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'epub-reader-test-'));
  const dataDir = path.join(rootDir, 'data');
  const booksDir = path.join(dataDir, 'books');
  const coversDir = path.join(dataDir, 'covers');
  const databasePath = path.join(dataDir, 'library.sqlite');
  const previousDataDir = process.env.EPUB_DATA_DIR;
  const previousDatabasePath = process.env.DATABASE_PATH;

  mkdirSync(booksDir, { recursive: true });
  mkdirSync(coversDir, { recursive: true });
  process.env.EPUB_DATA_DIR = dataDir;
  process.env.DATABASE_PATH = databasePath;

  const { createDatabase } = await import('../../src/db/database.js');
  const db = createDatabase({ databasePath });

  t.after(() => {
    if (db.open) db.close();
    restoreEnvironmentVariable('EPUB_DATA_DIR', previousDataDir);
    restoreEnvironmentVariable('DATABASE_PATH', previousDatabasePath);
    rmSync(rootDir, { recursive: true, force: true });
  });

  return {
    booksDir,
    coversDir,
    dataDir,
    databasePath,
    db,
    rootDir,
  };
}

export async function startTestServer(app, t) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
