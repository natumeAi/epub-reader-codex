import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

test('migration 003 adds nullable file_mtime_ms to books', async (t) => {
  const environment = await createTestEnvironment(t);
  environment.db.prepare(`
    INSERT INTO books (title, file_name, file_path, file_size, sort_order)
    VALUES ('Legacy', 'legacy.epub', 'data/books/legacy.epub', 1, 1000)
  `).run();

  const columns = environment.db.prepare('PRAGMA table_info(books)').all();
  const mtimeColumn = columns.find((column) => column.name === 'file_mtime_ms');
  const legacy = environment.db.prepare('SELECT file_mtime_ms FROM books').get();

  assert.equal(mtimeColumn.type, 'INTEGER');
  assert.equal(mtimeColumn.notnull, 0);
  assert.equal(legacy.file_mtime_ms, null);
});
