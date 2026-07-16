# Library Sync and API Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除重复启动同步和未变化 EPUB 的重复解析，同时修复 EPUB 缓存、缺失书籍进度、文件夹名称边界及文件夹预览 N+1 查询。

**Architecture:** 数据库用可空 `file_mtime_ms` 配合现有 file size 判断启动扫描是否可短路，watcher 的 change 事件显式强制刷新。HTTP 修复保持现有成功 JSON 结构；文件夹列表使用一次聚合查询加一次窗口函数查询，随后在 JavaScript 中组装预览。

**Tech Stack:** Node.js、chokidar 5、better-sqlite3/SQLite window functions、Express 5、node:test、HTTP cache validators

---

## File map

- Create: `server/src/db/migrations/003_add_book_file_mtime.sql` — 为 books 增加可空毫秒 mtime。
- Create: `server/test/database-migration.test.js` — 验证升级列存在且旧记录为 null。
- Modify: `server/src/services/bookLibrary.js` — 未变化短路、强制刷新及 mtime 写入。
- Create: `server/test/bookLibrary-mtime.test.js` — 首扫、二扫及 forceRefresh 解析次数测试。
- Modify: `server/src/services/bookDirectoryWatcher.js` — 只在 ready 同步一次，change 强制刷新，并支持依赖注入测试。
- Create: `server/test/bookDirectoryWatcher.test.js` — fake watcher 事件测试。
- Modify: `server/src/routes/books.js` — EPUB 响应每次重验证。
- Modify: `server/src/routes/reading.js` — upsert 前检查 book，并返回 404。
- Create: `server/test/http-correctness.test.js` — cache headers、ETag、Last-Modified 和 reading 404/成功测试。
- Modify: `server/src/services/folderLibrary.js` — 80 字服务端规则及固定两查询预览。
- Create: `server/test/folderLibrary-correctness.test.js` — 名称边界、API code、预览排序与查询计数测试。

### Task 1: Add the backward-compatible mtime migration

**Files:**
- Create: `server/test/database-migration.test.js`
- Create: `server/src/db/migrations/003_add_book_file_mtime.sql`

- [ ] **Step 1: Write the failing migration test**

Create `server/test/database-migration.test.js`:

```js
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
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
```

- [ ] **Step 2: Run the migration test and verify the missing column**

Run: `npm test -- --test-name-pattern="migration 003"`

Expected: exit code 1 because `mtimeColumn` is undefined or the SELECT reports no `file_mtime_ms` column.

- [ ] **Step 3: Add the additive migration**

Create `server/src/db/migrations/003_add_book_file_mtime.sql`:

```sql
ALTER TABLE books ADD COLUMN file_mtime_ms INTEGER;
```

- [ ] **Step 4: Run the migration test**

Run: `npm test -- --test-name-pattern="migration 003"`

Expected: exit code 0; the column is nullable INTEGER and the inserted legacy record reads null.

- [ ] **Step 5: Commit the migration**

```powershell
git add server/src/db/migrations/003_add_book_file_mtime.sql server/test/database-migration.test.js
git commit -m "feat: track book file modification time"
```

### Task 2: Skip unchanged files and retain force refresh

**Files:**
- Create: `server/test/bookLibrary-mtime.test.js`
- Modify: `server/src/services/bookLibrary.js`

- [ ] **Step 1: Write the failing parse-count test**

Create `server/test/bookLibrary-mtime.test.js`:

```js
import assert from 'node:assert/strict';
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
```

- [ ] **Step 2: Run the test and observe a second parse**

Run: `npm test -- --test-name-pattern="sync parses once"`

Expected: exit code 1 because the second sync increments `parseCount` to 2.

- [ ] **Step 3: Add the pre-parse file-state short circuit**

In `addBookFileToLibrary`, immediately after `fileName`, `storedPath`, `fallbackTitle`, and `existing` are determined, add:

```js
  const fileMtimeMs = Math.trunc(fileStat.mtimeMs);
  const fileIsUnchanged = Boolean(
    existing &&
    existing.file_size === fileStat.size &&
    existing.file_mtime_ms === fileMtimeMs,
  );

  if (fileIsUnchanged && !options.forceRefresh) {
    return existing;
  }
```

This block must remain before `inspectEpubFile` and `saveBookCover`, so a skipped file performs neither parse nor cover write.

- [ ] **Step 4: Persist mtime in UPDATE and INSERT statements**

Add this assignment to the existing UPDATE SQL immediately after `file_size = @fileSize`:

```sql
             file_mtime_ms = @fileMtimeMs,
```

Add the matching parameter:

```js
        fileMtimeMs,
```

Add `file_mtime_ms` after `file_size` in the INSERT column list, add `@fileMtimeMs` at the same position in VALUES, and add this insert parameter:

```js
        fileMtimeMs,
```

- [ ] **Step 5: Forward test parsing dependencies without forcing normal sync**

In `syncBookDirectory`, keep its per-file call as:

```js
      const book = await addBookFileToLibrary(db, filePath, {
        parseDetails: options.parseDetails,
      });
```

Do not pass `forceRefresh` from a startup scan.

- [ ] **Step 6: Run mtime and security sync tests**

Run:

```powershell
npm test -- --test-name-pattern="sync parses once|sync skips invalid"
npm test
```

Expected: both commands exit 0; unchanged scan parse count remains one, forceRefresh makes it two, and invalid-file handling still continues.

- [ ] **Step 7: Commit unchanged-file skipping**

```powershell
git add server/src/services/bookLibrary.js server/test/bookLibrary-mtime.test.js
git commit -m "perf: skip unchanged epub metadata refresh"
```

### Task 3: One watcher-ready sync and forced change events

**Files:**
- Create: `server/test/bookDirectoryWatcher.test.js`
- Modify: `server/src/services/bookDirectoryWatcher.js`

- [ ] **Step 1: Write a failing fake-watcher test**

Create `server/test/bookDirectoryWatcher.test.js`:

```js
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

class FakeWatcher {
  handlers = new Map();

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
    return this;
  }

  async emit(eventName, ...args) {
    return this.handlers.get(eventName)?.(...args);
  }

  async close() {}
}

test('watcher syncs once on ready and force-refreshes change events', async (t) => {
  const environment = await createTestEnvironment(t);
  const fakeWatcher = new FakeWatcher();
  const syncCalls = [];
  const addCalls = [];
  const { startBookDirectoryWatcher } = await import('../src/services/bookDirectoryWatcher.js');

  startBookDirectoryWatcher(environment.db, {
    addBookFileToLibrary: async (...args) => { addCalls.push(args); },
    syncBookDirectory: async (...args) => { syncCalls.push(args); },
    watch: () => fakeWatcher,
  });

  assert.equal(syncCalls.length, 0);
  await fakeWatcher.emit('ready');
  await fakeWatcher.emit('ready');
  assert.equal(syncCalls.length, 1);

  const changedPath = path.join(environment.booksDir, 'changed.epub');
  await fakeWatcher.emit('change', changedPath);
  assert.equal(addCalls.length, 1);
  assert.deepEqual(addCalls[0][2], { forceRefresh: true });
});
```

- [ ] **Step 2: Run the watcher test and observe eager/double sync behavior**

Run: `npm test -- --test-name-pattern="watcher syncs once"`

Expected: exit code 1 because startup sync occurs before ready and/or the change call lacks `forceRefresh: true`.

- [ ] **Step 3: Replace `startBookDirectoryWatcher` with injectable, guarded setup**

Keep existing imports and replace the exported function with:

```js
export function startBookDirectoryWatcher(db, dependencies = {}) {
  const addBook = dependencies.addBookFileToLibrary || addBookFileToLibrary;
  const removeBook = dependencies.removeBookFileFromLibrary || removeBookFileFromLibrary;
  const syncBooks = dependencies.syncBookDirectory || syncBookDirectory;
  const watch = dependencies.watch || chokidar.watch;
  let readySyncStarted = false;

  ensureBookDirectory();
  const watcher = watch(booksDir, {
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
    ignoreInitial: true,
  });

  watcher.on('add', async (filePath) => {
    if (!isEpubFileName(filePath)) return;
    try {
      await addBook(db, filePath);
    } catch (error) {
      if (error instanceof InvalidEpubError) removeBook(db, filePath);
      logSyncError('add', filePath, error);
    }
  });

  watcher.on('change', async (filePath) => {
    if (!isEpubFileName(filePath)) return;
    try {
      await addBook(db, filePath, { forceRefresh: true });
    } catch (error) {
      if (error instanceof InvalidEpubError) removeBook(db, filePath);
      logSyncError('update', filePath, error);
    }
  });

  watcher.on('unlink', (filePath) => {
    if (!isEpubFileName(filePath)) return;
    try {
      removeBook(db, filePath);
    } catch (error) {
      logSyncError('remove', filePath, error);
    }
  });

  watcher.on('ready', async () => {
    if (readySyncStarted) return;
    readySyncStarted = true;
    try {
      await syncBooks(db);
    } catch (error) {
      console.error('Failed to sync EPUB directory on watcher ready:', error);
    }
  });

  watcher.on('error', (error) => {
    console.error('Book directory watcher error:', error);
  });

  return watcher;
}
```

There is no call to `syncBooks` before watcher construction.

- [ ] **Step 4: Run the watcher and full server tests**

Run:

```powershell
npm test -- --test-name-pattern="watcher syncs once"
npm test
```

Expected: both commands exit 0; two emitted ready events produce one sync and change carries the force flag.

- [ ] **Step 5: Commit watcher synchronization**

```powershell
git add server/src/services/bookDirectoryWatcher.js server/test/bookDirectoryWatcher.test.js
git commit -m "fix: synchronize library once on watcher ready"
```

### Task 4: HTTP cache revalidation and missing-book 404

**Files:**
- Create: `server/test/http-correctness.test.js`
- Modify: `server/src/routes/books.js`
- Modify: `server/src/routes/reading.js`

- [ ] **Step 1: Write failing HTTP correctness tests**

Create `server/test/http-correctness.test.js`:

```js
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
```

- [ ] **Step 2: Run the HTTP test and verify both failures**

Run: `npm test -- --test-name-pattern="book files revalidate"`

Expected: exit code 1; cache-control is `private, max-age=3600` and the missing progress PUT is 500.

- [ ] **Step 3: Require revalidation for EPUB responses**

In `server/src/routes/books.js`, replace the current Cache-Control assignment with:

```js
    res.setHeader('Cache-Control', 'private, no-cache');
```

Keep `res.sendFile(filePath)` so Express continues producing ETag and Last-Modified.

- [ ] **Step 4: Check book existence before the progress INSERT**

In the PUT handler in `server/src/routes/reading.js`, after validating `progressValue` and before `INSERT INTO reading_progress`, add:

```js
    const bookExists = db.prepare('SELECT 1 FROM books WHERE id = ?').get(bookId);
    if (!bookExists) {
      const error = new Error('Book not found');
      error.status = 404;
      error.code = 'BOOK_NOT_FOUND';
      throw error;
    }
```

- [ ] **Step 5: Run the HTTP correctness test**

Run: `npm test -- --test-name-pattern="book files revalidate"`

Expected: exit code 0 with exact `private, no-cache`, non-empty validators, 404 for missing ID and 200 for existing ID.

- [ ] **Step 6: Commit HTTP correctness fixes**

```powershell
git add server/src/routes/books.js server/src/routes/reading.js server/test/http-correctness.test.js
git commit -m "fix: revalidate books and report missing progress targets"
```

### Task 5: Folder name boundary and two-query previews

**Files:**
- Create: `server/test/folderLibrary-correctness.test.js`
- Modify: `server/src/services/folderLibrary.js`

- [ ] **Step 1: Write the failing service/API/query-count test**

Create `server/test/folderLibrary-correctness.test.js`:

```js
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
```

- [ ] **Step 2: Run the folder test and observe missing export/N+1**

Run: `npm test -- --test-name-pattern="folder names stop"`

Expected: exit code 1 because `normalizeFolderName` is not exported; after exporting alone, query count would be 6 rather than 2.

- [ ] **Step 3: Enforce the shared 80-character rule**

Replace the top name declarations/functions in `server/src/services/folderLibrary.js` with:

```js
const defaultFolderName = '\u65b0\u5efa\u6587\u4ef6\u5939';
export const MAX_FOLDER_NAME_LENGTH = 80;

export function normalizeFolderName(name) {
  if (typeof name !== 'string') return defaultFolderName;
  const normalizedName = name.trim() || defaultFolderName;

  if (normalizedName.length > MAX_FOLDER_NAME_LENGTH) {
    const error = new Error('Folder name must be 80 characters or fewer');
    error.status = 400;
    error.code = 'INVALID_FOLDER_NAME';
    throw error;
  }

  return normalizedName;
}
```

Both `createFolderFromBooks` and `renameFolder` already call this function; do not duplicate the limit in routes.

- [ ] **Step 4: Replace `listFolders` with two fixed queries**

Replace `listFolders` in `server/src/services/folderLibrary.js` with:

```js
export function listFolders(db) {
  const folderRows = db.prepare(`
    SELECT f.*,
           COUNT(b.id) AS book_count
    FROM folders f
    LEFT JOIN books b ON b.folder_id = f.id
    GROUP BY f.id
    ORDER BY f.sort_order ASC, f.id ASC
  `).all();

  const previewRows = db.prepare(`
    SELECT *
    FROM (
      SELECT b.*,
             ROW_NUMBER() OVER (
               PARTITION BY b.folder_id
               ORDER BY b.sort_order ASC, b.id ASC
             ) AS preview_rank
      FROM books b
      WHERE b.folder_id IS NOT NULL
    ) ranked_books
    WHERE preview_rank <= 4
    ORDER BY folder_id ASC, sort_order ASC, id ASC
  `).all();

  const previewsByFolderId = new Map();
  for (const row of previewRows) {
    const previews = previewsByFolderId.get(row.folder_id) || [];
    previews.push(formatBook(row));
    previewsByFolderId.set(row.folder_id, previews);
  }

  return folderRows.map((row) => formatFolder(
    row,
    previewsByFolderId.get(row.id) || [],
  ));
}
```

Keep `folderPreviewBooks` and `getFolder` unchanged for the single-folder endpoint.

- [ ] **Step 5: Run the folder correctness test and full server suite**

Run:

```powershell
npm test -- --test-name-pattern="folder names stop"
npm test
```

Expected: both commands exit 0; five folders still execute exactly two statements and every folder receives its first four ordered books.

- [ ] **Step 6: Commit folder API correctness**

```powershell
git add server/src/services/folderLibrary.js server/test/folderLibrary-correctness.test.js
git commit -m "fix: bound folder names and batch previews"
```

### Task 6: Non-Docker acceptance gate

**Files:**
- Verify: all files changed by this plan

- [ ] **Step 1: Run server tests and production audit**

Run:

```powershell
npm test --prefix server
npm audit --omit=dev --prefix server
```

Expected: both commands exit 0; tests cover one ready sync, unchanged skip, forced change, cache headers, 404, length boundaries and two preview queries.

- [ ] **Step 2: Run client regression gates affected by HTTP behavior**

Run:

```powershell
npm test --prefix client
npm run build --prefix client
npm run verify:reader-progress --prefix client
```

Expected: all commands exit 0; revalidation and 404 changes do not break reading progress.

- [ ] **Step 3: Inspect commits and working tree**

Run: `git status --short`

Expected: no uncommitted plan changes; Docker/NAS validation is intentionally not performed.

## Self-review checklist

- [ ] Double startup sync maps to Task 3; unchanged parsing maps to Tasks 1–2; stale cache and progress 404 map to Task 4; name limit and N+1 map to Task 5.
- [ ] Existing records start with null mtime and therefore parse once; new/updated records persist truncated milliseconds; normal sync skips only when size and mtime both match; change events always force.
- [ ] `formatBook` and all successful API JSON fields remain unchanged; `file_mtime_ms` is internal only.
- [ ] Folder list performs exactly two prepared SQL statement executions regardless of folder count, while `getFolder` remains a focused single-folder path.
- [ ] Scan this document for every prohibited placeholder phrase named by the writing-plans skill; expected result is zero matches.
- [ ] Verify consistent names: `file_mtime_ms`, `forceRefresh`, `readySyncStarted`, `BOOK_NOT_FOUND`, `MAX_FOLDER_NAME_LENGTH`, and `INVALID_FOLDER_NAME`.
