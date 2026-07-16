import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createEpubFixture } from './helpers/createEpubFixture.js';
import { createTestEnvironment, startTestServer } from './helpers/createTestEnvironment.js';

test('book files revalidate and reading progress distinguishes missing books', async (t) => {
  const environment = await createTestEnvironment(t);
  const fixturePath = path.join(environment.booksDir, 'http.epub');
  createEpubFixture(fixturePath, { title: 'HTTP Book' });
  const [{ syncBookDirectory }, { createApp }] = await Promise.all([
    import('../src/services/bookLibrary.js'),
    import('../src/app.js'),
  ]);
  await syncBookDirectory(environment.db);
  const bookId = environment.db.prepare('SELECT id FROM books').get().id;
  const baseUrl = await startTestServer(createApp({ db: environment.db }), t);

  const fileResponse = await fetch(`${baseUrl}/api/books/${bookId}/file`);
  assert.equal(fileResponse.status, 200);
  assert.equal(fileResponse.headers.get('cache-control'), 'private, no-cache');
  assert.ok(fileResponse.headers.get('etag'));
  assert.ok(fileResponse.headers.get('last-modified'));

  const headResponse = await fetch(`${baseUrl}/api/books/${bookId}/file`, { method: 'HEAD' });
  assert.equal(headResponse.status, 200);
  assert.equal(headResponse.headers.get('cache-control'), 'private, no-cache');
  assert.ok(headResponse.headers.get('etag'));
  assert.ok(headResponse.headers.get('last-modified'));

  const missingResponse = await fetch(`${baseUrl}/api/reading/999999`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress: 0.2, cfi: 'missing' }),
  });
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), {
    error: 'Book not found',
    code: 'BOOK_NOT_FOUND',
  });

  const existingResponse = await fetch(`${baseUrl}/api/reading/${bookId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress: 0.2, cfi: 'existing' }),
  });
  assert.equal(existingResponse.status, 200);
  assert.equal((await existingResponse.json()).progress.bookId, bookId);
});
