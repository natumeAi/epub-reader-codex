import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createEpubFixture } from './helpers/createEpubFixture.js';
import { createTestEnvironment, startTestServer } from './helpers/createTestEnvironment.js';

async function upload(baseUrl, filePath, fileName) {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(filePath)], { type: 'application/epub+zip' }), fileName);
  return fetch(`${baseUrl}/api/books`, { method: 'POST', body: form });
}

test('invalid and valid uploads leave exactly the expected resources', async (t) => {
  const environment = await createTestEnvironment(t);
  const invalidPath = path.join(environment.rootDir, 'fake.epub');
  writeFileSync(invalidPath, '{"fake":"epub"}');
  const [{ createApp }, storage] = await Promise.all([
    import('../src/app.js'),
    import('../src/services/fileStorage.js'),
  ]);
  const baseUrl = await startTestServer(createApp({ db: environment.db }), t);

  const response = await upload(baseUrl, invalidPath, 'fake.epub');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'EPUB 文件无效或已损坏',
    code: 'INVALID_EPUB',
  });
  assert.equal(environment.db.prepare('SELECT COUNT(*) AS value FROM books').get().value, 0);
  assert.deepEqual(readdirSync(storage.stagingDir), []);
  assert.deepEqual(readdirSync(environment.booksDir), []);
  assert.deepEqual(readdirSync(environment.coversDir), []);

  const fixturePath = path.join(environment.rootDir, 'valid.epub');
  createEpubFixture(fixturePath, { title: 'Uploaded Book' });

  environment.db.exec(`
    CREATE TRIGGER reject_book_insert
    BEFORE INSERT ON books
    BEGIN
      SELECT RAISE(ABORT, 'forced insert failure');
    END;
  `);
  const failedAfterMove = await upload(baseUrl, fixturePath, 'Rollback.epub');
  assert.equal(failedAfterMove.status, 500);
  environment.db.exec('DROP TRIGGER reject_book_insert');
  assert.equal(environment.db.prepare('SELECT COUNT(*) AS value FROM books').get().value, 0);
  assert.deepEqual(readdirSync(storage.stagingDir), []);
  assert.deepEqual(readdirSync(environment.booksDir), []);
  assert.deepEqual(readdirSync(environment.coversDir), []);

  const validResponse = await upload(baseUrl, fixturePath, 'Uploaded Book.epub');
  assert.equal(validResponse.status, 201);
  assert.equal(environment.db.prepare('SELECT COUNT(*) AS value FROM books').get().value, 1);
  assert.deepEqual(readdirSync(storage.stagingDir), []);
  assert.deepEqual(readdirSync(environment.booksDir), ['Uploaded Book.epub']);
  assert.equal(readdirSync(environment.coversDir).length, 1);
});
