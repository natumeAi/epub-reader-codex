import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

test('EPUB_DATA_DIR isolates books, covers, and the database', async (t) => {
  const environment = await createTestEnvironment(t);
  const storage = await import('../src/services/fileStorage.js');

  assert.equal(storage.booksDir, environment.booksDir);
  assert.equal(storage.coversDir, environment.coversDir);
  assert.equal(environment.databasePath.startsWith(environment.rootDir), true);
});
