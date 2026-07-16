import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createEpubFixture } from './helpers/createEpubFixture.js';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

test('sync parses once, skips unchanged files, and honors forceRefresh', async (t) => {
  const environment = await createTestEnvironment(t);
  const bookPath = path.join(environment.booksDir, 'stable.epub');
  createEpubFixture(bookPath, { title: 'Stable Book' });

  const [
    { addBookFileToLibrary, syncBookDirectory },
    { parseEpubDetails },
    { toAbsoluteStoragePath },
  ] = await Promise.all([
    import('../src/services/bookLibrary.js'),
    import('../src/services/epubService.js'),
    import('../src/services/fileStorage.js'),
  ]);
  let parseCount = 0;
  const parseDetails = async (filePath) => {
    parseCount += 1;
    return parseEpubDetails(filePath);
  };

  await syncBookDirectory(environment.db, { parseDetails });
  const first = environment.db.prepare('SELECT * FROM books').get();
  assert.equal(parseCount, 1);
  assert.equal(Number.isInteger(first.file_mtime_ms), true);
  const coverPath = toAbsoluteStoragePath(first.cover_path);
  const firstCoverMtime = statSync(coverPath).mtimeMs;
  environment.db.exec(`
    CREATE TEMP TABLE book_update_counter (value INTEGER NOT NULL);
    CREATE TEMP TRIGGER count_book_updates
    AFTER UPDATE ON books
    BEGIN
      INSERT INTO book_update_counter (value) VALUES (1);
    END;
  `);

  await new Promise((resolve) => setTimeout(resolve, 25));
  await syncBookDirectory(environment.db, { parseDetails });
  assert.equal(parseCount, 1);
  assert.equal(environment.db.prepare('SELECT COUNT(*) AS value FROM book_update_counter').get().value, 0);
  assert.equal(statSync(coverPath).mtimeMs, firstCoverMtime);

  await addBookFileToLibrary(environment.db, bookPath, {
    forceRefresh: true,
    parseDetails,
  });
  assert.equal(parseCount, 2);
  assert.equal(environment.db.prepare('SELECT COUNT(*) AS value FROM book_update_counter').get().value, 1);
});
