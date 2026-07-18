import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestEnvironment, startTestServer } from './helpers/createTestEnvironment.js';

test('catalog returns every book with folder and reading metadata without writes', async (t) => {
  const environment = await createTestEnvironment(t);
  const folderId = environment.db.prepare(
    'INSERT INTO folders (name, sort_order) VALUES (?, ?)',
  ).run('历史', 2000).lastInsertRowid;
  const insertBook = environment.db.prepare(`
    INSERT INTO books (
      folder_id, title, author, file_name, file_path, file_size,
      sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
  `);
  const rootId = insertBook.run(
    null, '根层书', null, 'root.epub', 'data/books/root.epub', 1000,
    '2026-07-16T00:00:00.000Z', '2026-07-16T01:00:00.000Z',
  ).lastInsertRowid;
  const unreadId = insertBook.run(
    folderId, '万历十五年', '黄仁宇', 'wanli.epub', 'data/books/wanli.epub', 1000,
    '2026-07-17T00:00:00.000Z', '2026-07-17T01:00:00.000Z',
  ).lastInsertRowid;
  const readId = insertBook.run(
    folderId, '中国大历史', '黄仁宇', 'history.epub', 'data/books/history.epub', 2000,
    '2026-07-18T00:00:00.000Z', '2026-07-18T01:00:00.000Z',
  ).lastInsertRowid;
  environment.db.prepare(`
    INSERT INTO reading_progress (book_id, progress, updated_at)
    VALUES (?, ?, ?)
  `).run(readId, 0.42, '2026-07-18T02:00:00.000Z');
  const before = environment.db.prepare(`
    SELECT id, folder_id, sort_order, created_at, updated_at
    FROM books ORDER BY id
  `).all();
  const { createApp } = await import('../src/app.js');
  const baseUrl = await startTestServer(createApp({ db: environment.db }), t);

  const response = await fetch(`${baseUrl}/api/books/catalog`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.books.map((book) => book.id), [rootId, unreadId, readId]);
  const rootBook = body.books.find((book) => book.id === rootId);
  assert.deepEqual({
    folderId: rootBook.folderId,
    folderName: rootBook.folderName,
    readingProgress: rootBook.readingProgress,
    readingUpdatedAt: rootBook.readingUpdatedAt,
  }, {
    folderId: null,
    folderName: null,
    readingProgress: null,
    readingUpdatedAt: null,
  });
  const unreadBook = body.books.find((book) => book.id === unreadId);
  assert.deepEqual({
    folderId: unreadBook.folderId,
    folderName: unreadBook.folderName,
    readingProgress: unreadBook.readingProgress,
    readingUpdatedAt: unreadBook.readingUpdatedAt,
  }, {
    folderId,
    folderName: '历史',
    readingProgress: null,
    readingUpdatedAt: null,
  });
  const readBook = body.books.find((book) => book.id === readId);
  assert.deepEqual({
    folderId: readBook.folderId,
    folderName: readBook.folderName,
    readingProgress: readBook.readingProgress,
    readingUpdatedAt: readBook.readingUpdatedAt,
  }, {
    folderId,
    folderName: '历史',
    readingProgress: 0.42,
    readingUpdatedAt: '2026-07-18T02:00:00.000Z',
  });
  assert.deepEqual(
    environment.db.prepare(`
      SELECT id, folder_id, sort_order, created_at, updated_at
      FROM books ORDER BY id
    `).all(),
    before,
  );

  const rootList = await (await fetch(`${baseUrl}/api/books`)).json();
  assert.deepEqual(rootList.books.map((book) => book.id), [rootId]);
  assert.equal((await fetch(`${baseUrl}/api/books/${readId}`)).status, 200);
});
