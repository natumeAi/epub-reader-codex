import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestEnvironment, startTestServer } from './helpers/createTestEnvironment.js';

test('folder names stop at 80 characters and previews use two queries', async (t) => {
  const environment = await createTestEnvironment(t);
  const { createApp } = await import('../src/app.js');
  const { listFolders, normalizeFolderName } = await import('../src/services/folderLibrary.js');

  assert.equal(normalizeFolderName('x'.repeat(80)).length, 80);
  assert.equal(normalizeFolderName('   '), '新建文件夹');
  assert.throws(() => normalizeFolderName('x'.repeat(81)), {
    status: 400,
    code: 'INVALID_FOLDER_NAME',
  });

  const insertFolder = environment.db.prepare('INSERT INTO folders (name, sort_order) VALUES (?, ?)');
  const insertBook = environment.db.prepare(`
    INSERT INTO books (folder_id, title, file_name, file_path, file_size, sort_order)
    VALUES (?, ?, ?, ?, 1, ?)
  `);
  for (let folderIndex = 1; folderIndex <= 5; folderIndex += 1) {
    const folderId = insertFolder.run(`Folder ${folderIndex}`, folderIndex * 1000).lastInsertRowid;
    for (let bookIndex = 1; bookIndex <= 6; bookIndex += 1) {
      insertBook.run(
        folderId,
        `F${folderIndex} Book ${bookIndex}`,
        `f${folderIndex}-${bookIndex}.epub`,
        `data/books/f${folderIndex}-${bookIndex}.epub`,
        bookIndex * 1000,
      );
    }
  }

  const statements = [];
  const trackedDb = {
    prepare(sql) {
      statements.push(sql);
      return environment.db.prepare(sql);
    },
  };
  const folders = listFolders(trackedDb);
  assert.equal(statements.length, 2);
  assert.equal(folders.length, 5);
  assert.ok(folders.every((folder) => folder.bookCount === 6));
  assert.ok(folders.every((folder) => folder.previewBooks.length === 4));
  assert.deepEqual(
    folders[0].previewBooks.map((book) => book.title),
    ['F1 Book 1', 'F1 Book 2', 'F1 Book 3', 'F1 Book 4'],
  );

  environment.db.prepare(`
    INSERT INTO books (title, file_name, file_path, file_size, sort_order)
    VALUES ('Root 1', 'root-1.epub', 'data/books/root-1.epub', 1, 10000),
           ('Root 2', 'root-2.epub', 'data/books/root-2.epub', 1, 11000)
  `).run();
  const rootIds = environment.db.prepare('SELECT id FROM books WHERE folder_id IS NULL ORDER BY id').all();
  const baseUrl = await startTestServer(createApp({ db: environment.db }), t);
  const response = await fetch(`${baseUrl}/api/folders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sourceBookId: rootIds[0].id,
      targetBookId: rootIds[1].id,
      name: '界'.repeat(81),
    }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Folder name must be 80 characters or fewer',
    code: 'INVALID_FOLDER_NAME',
  });
});
