import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createEpubFixture } from './helpers/createEpubFixture.js';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

test('sync skips invalid files, removes stale tracking, and continues', async (t) => {
  const environment = await createTestEnvironment(t);
  const validPath = path.join(environment.booksDir, 'valid.epub');
  const invalidPath = path.join(environment.booksDir, 'invalid.epub');
  createEpubFixture(validPath, { title: 'Valid Book' });
  writeFileSync(invalidPath, '{"fake":true}');

  environment.db.prepare(`
    INSERT INTO books (title, file_name, file_path, file_size, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run('Previously accepted bad book', 'invalid.epub', 'data/books/invalid.epub', 13, 1000);

  const { syncBookDirectory } = await import('../src/services/bookLibrary.js');
  await syncBookDirectory(environment.db);

  const rows = environment.db.prepare('SELECT title, file_path FROM books ORDER BY id').all();
  assert.deepEqual(rows, [{ title: 'Valid Book', file_path: 'data/books/valid.epub' }]);
});
