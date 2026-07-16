# EPUB Ingestion Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 只让结构有效且资源规模受限的 EPUB 进入书库，并在保持 epub.js 0.3.93 的同时消除生产 xmldom 公告。

**Architecture:** 上传先落到 data/staging，服务端读取 ZIP 中央目录并检查签名、必要条目和资源上限，随后由 epub2 解析，再原子移动到 books 并写库。手动目录同步对每个无效文件单独清理旧追踪记录并继续，任何上传失败都清除本次 staging、最终文件和封面副作用。

**Tech Stack:** Node.js、Express 5、Multer 2、adm-zip、epub2、better-sqlite3、React Fetch API、node:test、Vitest、npm audit

---

## File map

- Create: `server/src/services/epubValidation.js` — ZIP 签名、中央目录、mimetype、container 和资源限制校验。
- Create: `server/test/epubValidation.test.js` — 伪装文件、结构缺失和三类上限测试。
- Modify: `server/src/services/fileStorage.js` — staging、UUID 临时名、原子移动和 24 小时清理。
- Create: `server/test/fileStorage.test.js` — staging 移动和过期清理边界测试。
- Modify: `server/src/services/bookLibrary.js` — 严格校验/解析，不再用空元数据兜底；同步坏书时继续。
- Modify: `server/src/services/bookDirectoryWatcher.js` — watcher 遇到无效文件时移除旧记录并只记录路径/错误码。
- Create: `server/test/bookLibrary-security.test.js` — 合法与非法手动文件混合同步测试。
- Modify: `server/src/services/coverStorage.js` — 按书籍路径清除补偿产生的封面变体。
- Modify: `server/src/routes/books.js` — staging 上传编排与补偿清理。
- Modify: `server/src/app.js` — 启动 staging 清理并返回稳定错误码、记录 500 stack。
- Create: `server/test/books-upload-security.test.js` — 400、201 及四类孤儿资源断言。
- Modify: `server/package.json` — 将 adm-zip 移至生产依赖。
- Modify: `server/package-lock.json` — 记录生产依赖位置。
- Modify: `client/package.json` — 精确保持 epubjs 0.3.93，并 override xmldom 0.8.13。
- Modify: `client/package-lock.json` — 锁定修复后的传递依赖。
- Modify: `client/src/api/booksApi.js` — 显示服务端上传错误。
- Modify: `client/src/hooks/useUploadBooks.js` — 批量失败项包含逐书错误原因并继续后续上传。
- Create: `client/src/api/booksApi.test.js` — 上传错误消息测试。
- Modify: `.github/workflows/quality.yml` — 客户端生产依赖 audit 成为门禁。

### Task 1: Archive validation contract

**Files:**
- Create: `server/test/epubValidation.test.js`
- Create: `server/src/services/epubValidation.js`

- [ ] **Step 1: Write failing archive validation tests**

Create `server/test/epubValidation.test.js`:

```js
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import AdmZip from 'adm-zip';
import { createEpubFixture } from './helpers/createEpubFixture.js';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

function writeArchive(filePath, options = {}) {
  const zip = new AdmZip();
  if (!options.omitMimetype) {
    zip.addFile('mimetype', Buffer.from(options.mimetype || 'application/epub+zip'));
  }
  if (!options.omitContainer) {
    zip.addFile('META-INF/container.xml', Buffer.from('<container/>'));
  }
  for (const entry of options.entries || []) {
    zip.addFile(entry.name, Buffer.alloc(entry.size, 0x61));
  }
  zip.writeZip(filePath);
}

test('rejects disguised, incomplete, and oversized EPUB archives', async (t) => {
  const environment = await createTestEnvironment(t);
  const { InvalidEpubError, validateEpubArchive } = await import('../src/services/epubValidation.js');
  const file = (name) => path.join(environment.booksDir, name);

  const disguised = file('disguised.epub');
  writeFileSync(disguised, '{"not":"a zip"}');
  assert.throws(() => validateEpubArchive(disguised), InvalidEpubError);

  const noMimetype = file('no-mimetype.epub');
  writeArchive(noMimetype, { omitMimetype: true });
  assert.throws(() => validateEpubArchive(noMimetype), { code: 'INVALID_EPUB', status: 400 });

  const wrongMimetype = file('wrong-mimetype.epub');
  writeArchive(wrongMimetype, { mimetype: 'application/zip' });
  assert.throws(() => validateEpubArchive(wrongMimetype), { code: 'INVALID_EPUB' });

  const noContainer = file('no-container.epub');
  writeArchive(noContainer, { omitContainer: true });
  assert.throws(() => validateEpubArchive(noContainer), { code: 'INVALID_EPUB' });

  const tooManyEntries = file('too-many.epub');
  writeArchive(tooManyEntries, { entries: [{ name: 'one', size: 1 }] });
  assert.throws(() => validateEpubArchive(tooManyEntries, { maxEntries: 2 }), { code: 'INVALID_EPUB' });

  const totalTooLarge = file('total-large.epub');
  writeArchive(totalTooLarge, { entries: [{ name: 'one', size: 32 }, { name: 'two', size: 32 }] });
  assert.throws(() => validateEpubArchive(totalTooLarge, { maxTotalUncompressedBytes: 60 }), { code: 'INVALID_EPUB' });

  const entryTooLarge = file('entry-large.epub');
  writeArchive(entryTooLarge, { entries: [{ name: 'large', size: 32 }] });
  assert.throws(() => validateEpubArchive(entryTooLarge, { maxEntryUncompressedBytes: 31 }), { code: 'INVALID_EPUB' });

  const valid = file('valid.epub');
  createEpubFixture(valid);
  assert.doesNotThrow(() => validateEpubArchive(valid));
});
```

- [ ] **Step 2: Run the validation test and verify the module is missing**

Run: `npm test -- --test-name-pattern="rejects disguised"`

Expected: exit code 1 with `ERR_MODULE_NOT_FOUND` for `epubValidation.js`.

- [ ] **Step 3: Implement central-directory validation**

Create `server/src/services/epubValidation.js`:

```js
import { closeSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const ZIP_LOCAL_FILE_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const MEBIBYTE = 1024 * 1024;

function positiveLimit(value, fallback) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

export class InvalidEpubError extends Error {
  constructor(reason, options = {}) {
    super('EPUB 文件无效或已损坏', options);
    this.name = 'InvalidEpubError';
    this.status = 400;
    this.code = 'INVALID_EPUB';
    this.reason = reason;
  }
}

export function resolveEpubValidationLimits(options = {}) {
  return {
    maxEntries: positiveLimit(
      options.maxEntries ?? process.env.EPUB_MAX_ENTRIES,
      10_000,
    ),
    maxTotalUncompressedBytes: positiveLimit(
      options.maxTotalUncompressedBytes ??
        (Number(process.env.EPUB_MAX_UNCOMPRESSED_MB) * MEBIBYTE),
      500 * MEBIBYTE,
    ),
    maxEntryUncompressedBytes: positiveLimit(
      options.maxEntryUncompressedBytes ??
        (Number(process.env.EPUB_MAX_ENTRY_MB) * MEBIBYTE),
      100 * MEBIBYTE,
    ),
  };
}

function assertZipSignature(filePath) {
  const descriptor = openSync(filePath, 'r');
  try {
    const signature = Buffer.alloc(4);
    const bytesRead = readSync(descriptor, signature, 0, 4, 0);
    if (bytesRead !== 4 || !signature.equals(ZIP_LOCAL_FILE_SIGNATURE)) {
      throw new InvalidEpubError('ZIP_SIGNATURE');
    }
  } finally {
    closeSync(descriptor);
  }
}

function normalizedEntryName(entry) {
  return entry.entryName.replaceAll('\\', '/').replace(/^\/+/, '');
}

export function validateEpubArchive(filePath, options = {}) {
  if (path.extname(filePath).toLowerCase() !== '.epub') {
    throw new InvalidEpubError('FILE_EXTENSION');
  }

  try {
    assertZipSignature(filePath);
  } catch (error) {
    if (error instanceof InvalidEpubError) throw error;
    throw new InvalidEpubError('ZIP_READ', { cause: error });
  }

  let entries;
  try {
    entries = new AdmZip(filePath).getEntries();
  } catch (error) {
    throw new InvalidEpubError('ZIP_DIRECTORY', { cause: error });
  }

  const limits = resolveEpubValidationLimits(options);
  if (entries.length > limits.maxEntries) {
    throw new InvalidEpubError('ENTRY_COUNT');
  }

  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const entrySize = Number(entry.header?.size);
    if (!Number.isSafeInteger(entrySize) || entrySize < 0) {
      throw new InvalidEpubError('ENTRY_SIZE');
    }
    if (entrySize > limits.maxEntryUncompressedBytes) {
      throw new InvalidEpubError('ENTRY_SIZE_LIMIT');
    }
    totalUncompressedBytes += entrySize;
    if (!Number.isSafeInteger(totalUncompressedBytes) || totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throw new InvalidEpubError('TOTAL_SIZE_LIMIT');
    }
  }

  const entryMap = new Map(entries.map((entry) => [normalizedEntryName(entry), entry]));
  const mimetypeEntry = entryMap.get('mimetype');
  if (!mimetypeEntry || mimetypeEntry.isDirectory) {
    throw new InvalidEpubError('MIMETYPE_MISSING');
  }

  let mimetype;
  try {
    mimetype = mimetypeEntry.getData().toString('utf8');
  } catch (error) {
    throw new InvalidEpubError('MIMETYPE_READ', { cause: error });
  }
  if (mimetype !== 'application/epub+zip') {
    throw new InvalidEpubError('MIMETYPE_VALUE');
  }

  const containerEntry = entryMap.get('META-INF/container.xml');
  if (!containerEntry || containerEntry.isDirectory) {
    throw new InvalidEpubError('CONTAINER_MISSING');
  }

  return {
    entryCount: entries.length,
    totalUncompressedBytes,
  };
}
```

- [ ] **Step 4: Run the archive validation test**

Run: `npm test -- --test-name-pattern="rejects disguised"`

Expected: exit code 0 with the validation test passing; only `mimetype` data is inflated by the validator.

- [ ] **Step 5: Commit the validator**

```powershell
git add server/src/services/epubValidation.js server/test/epubValidation.test.js
git commit -m "feat: validate epub archives before ingestion"
```

### Task 2: Staging storage, atomic move, and stale cleanup

**Files:**
- Create: `server/test/fileStorage.test.js`
- Modify: `server/src/services/fileStorage.js`

- [ ] **Step 1: Write failing staging lifecycle tests**

Create `server/test/fileStorage.test.js`:

```js
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createTestEnvironment } from './helpers/createTestEnvironment.js';

test('moves validated uploads and only cleans stale direct files', async (t) => {
  const environment = await createTestEnvironment(t);
  const storage = await import('../src/services/fileStorage.js');
  storage.ensureStagingDirectory();

  const uploadedPath = path.join(storage.stagingDir, 'upload.epub');
  writeFileSync(uploadedPath, 'validated bytes');
  const movedPath = storage.moveValidatedUploadToBooks(uploadedPath, 'unsafe:name.epub');
  assert.equal(existsSync(uploadedPath), false);
  assert.equal(path.dirname(movedPath), environment.booksDir);
  assert.equal(path.basename(movedPath), 'unsafe_name.epub');

  const oldFile = path.join(storage.stagingDir, 'old.epub');
  const newFile = path.join(storage.stagingDir, 'new.epub');
  const directory = path.join(storage.stagingDir, 'keep-directory');
  writeFileSync(oldFile, 'old');
  writeFileSync(newFile, 'new');
  mkdirSync(directory);
  const now = Date.now();
  utimesSync(oldFile, new Date(now - 25 * 60 * 60 * 1000), new Date(now - 25 * 60 * 60 * 1000));

  assert.equal(storage.cleanupStaleUploads({ now }), 1);
  assert.deepEqual(readdirSync(storage.stagingDir).sort(), ['keep-directory', 'new.epub']);
});
```

- [ ] **Step 2: Run the staging test and verify exports are missing**

Run: `npm test -- --test-name-pattern="moves validated uploads"`

Expected: exit code 1 because `ensureStagingDirectory` is not a function.

- [ ] **Step 3: Add staging declarations and filesystem imports**

Replace the imports at the top of `server/src/services/fileStorage.js` with:

```js
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
```

Add beside `booksDir` and `coversDir`:

```js
export const stagingDir = path.join(dataDir, 'staging');
export const STALE_UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
```

Add this directory helper:

```js
export function ensureStagingDirectory() {
  mkdirSync(stagingDir, { recursive: true });
}
```

- [ ] **Step 4: Replace upload storage and add move/cleanup functions**

Replace `createEpubUploadStorage` with:

```js
export function createEpubUploadStorage() {
  return multer.diskStorage({
    destination(req, file, callback) {
      ensureStagingDirectory();
      callback(null, stagingDir);
    },
    filename(req, file, callback) {
      callback(null, `${randomUUID()}.epub`);
    },
  });
}
```

Add after `availableBookFileName`:

```js
function isDirectStagingFile(filePath) {
  const relativePath = path.relative(path.resolve(stagingDir), path.resolve(filePath));
  return Boolean(relativePath) && !relativePath.includes(path.sep) && !path.isAbsolute(relativePath);
}

export function moveValidatedUploadToBooks(uploadedPath, originalName) {
  if (!isDirectStagingFile(uploadedPath)) {
    const error = new Error('Upload path is outside staging');
    error.status = 500;
    throw error;
  }

  ensureBookDirectory();
  const finalPath = path.join(booksDir, availableBookFileName(originalName));
  renameSync(uploadedPath, finalPath);
  return finalPath;
}

export function cleanupStaleUploads(options = {}) {
  ensureStagingDirectory();
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? STALE_UPLOAD_MAX_AGE_MS;
  let removedCount = 0;

  for (const entry of readdirSync(stagingDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filePath = path.join(stagingDir, entry.name);
    if (!isDirectStagingFile(filePath)) continue;
    const fileStat = statSync(filePath);
    if (now - fileStat.mtimeMs <= maxAgeMs) continue;
    unlinkSync(filePath);
    removedCount += 1;
  }

  return removedCount;
}
```

- [ ] **Step 5: Run the staging test**

Run: `npm test -- --test-name-pattern="moves validated uploads"`

Expected: exit code 0; one old file is removed, the new file and directory remain, and the moved name is sanitized.

- [ ] **Step 6: Commit staging storage**

```powershell
git add server/src/services/fileStorage.js server/test/fileStorage.test.js
git commit -m "feat: stage epub uploads before library move"
```

### Task 3: Strict parsing and resilient manual synchronization

**Files:**
- Create: `server/test/bookLibrary-security.test.js`
- Modify: `server/src/services/bookLibrary.js`
- Modify: `server/src/services/bookDirectoryWatcher.js`

- [ ] **Step 1: Write the mixed-directory failing test**

Create `server/test/bookLibrary-security.test.js`:

```js
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
```

- [ ] **Step 2: Run the sync test and observe the fallback record**

Run: `npm test -- --test-name-pattern="sync skips invalid"`

Expected: exit code 1 because the invalid file remains represented by fallback/previous metadata.

- [ ] **Step 3: Add strict inspection and replace `addBookFileToLibrary` parsing setup**

Add this import to `server/src/services/bookLibrary.js`:

```js
import { InvalidEpubError, validateEpubArchive } from './epubValidation.js';
```

Delete the `emptyMetadata` constant. Add this exported helper before `addBookFileToLibrary`:

```js
export async function inspectEpubFile(filePath, options = {}) {
  if (!options.archiveValidated) validateEpubArchive(filePath, options.validationLimits);
  if (options.epubDetails) return options.epubDetails;

  try {
    return await (options.parseDetails || parseEpubDetails)(filePath);
  } catch (error) {
    throw new InvalidEpubError('EPUB_PARSE', { cause: error });
  }
}
```

Inside `addBookFileToLibrary`, replace the block from `let metadata = emptyMetadata` through the existing `const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(storedPath);` declaration after its parse catch with:

```js
  const existing = db.prepare('SELECT * FROM books WHERE file_path = ?').get(storedPath);
  const epubDetails = await inspectEpubFile(filePath, options);
  const metadata = epubDetails.metadata;
  const coverImage = epubDetails.coverImage;
```

Replace the following derived fields:

```js
  const title = metadata.title || options.title || existing?.title || fallbackTitle;
  const author = metadata.author;
```

In the existing UPDATE parameter object, replace all `hasParsedMetadata` conditional values with direct metadata values:

```js
        author: metadata.author,
        description: metadata.description,
        publisher: metadata.publisher,
        language: metadata.language,
        identifier: metadata.identifier,
```

- [ ] **Step 4: Make directory sync continue only for invalid EPUB errors**

Replace `syncBookDirectory` with:

```js
export async function syncBookDirectory(db, options = {}) {
  ensureBookDirectory();
  const currentBookPaths = new Set();
  const filePaths = listEpubFilesRecursive(booksDir);

  for (const filePath of filePaths) {
    try {
      const book = await addBookFileToLibrary(db, filePath, {
        parseDetails: options.parseDetails,
      });
      if (book) currentBookPaths.add(toStoredPath(filePath));
    } catch (error) {
      if (!(error instanceof InvalidEpubError)) throw error;
      console.warn(`Skipped invalid EPUB file ${path.resolve(filePath)} [${error.code}]`);
      removeBookFileFromLibrary(db, filePath);
    }
  }

  const trackedBooks = db
    .prepare('SELECT id, file_path, cover_path FROM books WHERE file_path LIKE ?')
    .all(`${booksStoragePrefix}%`);

  for (const book of trackedBooks) {
    const absolutePath = toAbsoluteStoragePath(book.file_path);
    if (!currentBookPaths.has(book.file_path) && !existsSync(absolutePath)) {
      removeBookFileFromLibrary(db, absolutePath);
    }
  }
}
```

- [ ] **Step 5: Normalize watcher failures and remove stale invalid records**

Add this import to `server/src/services/bookDirectoryWatcher.js`:

```js
import { InvalidEpubError } from './epubValidation.js';
```

Replace `logSyncError` with:

```js
function logSyncError(action, filePath, error) {
  console.error(`Failed to ${action} EPUB file ${path.resolve(filePath)} [${error.code || 'UNEXPECTED_ERROR'}]`);
}
```

Add `import path from 'node:path';` at the top. In both `add` and `change` handlers, replace each catch body with:

```js
      } catch (error) {
        if (error instanceof InvalidEpubError) removeBookFileFromLibrary(db, filePath);
        logSyncError('add or update', filePath, error);
      }
```

- [ ] **Step 6: Run strict synchronization tests**

Run:

```powershell
npm test -- --test-name-pattern="sync skips invalid"
npm test
```

Expected: both commands exit 0; the mixed-directory test leaves exactly the valid book and logs only the invalid path plus `INVALID_EPUB`.

- [ ] **Step 7: Commit strict library ingestion**

```powershell
git add server/src/services/bookLibrary.js server/src/services/bookDirectoryWatcher.js server/test/bookLibrary-security.test.js
git commit -m "fix: reject invalid books during library sync"
```

### Task 4: Upload compensation and stable error responses

**Files:**
- Create: `server/test/books-upload-security.test.js`
- Modify: `server/src/services/coverStorage.js`
- Modify: `server/src/routes/books.js`
- Modify: `server/src/app.js`

- [ ] **Step 1: Write failing invalid/valid upload tests**

Create `server/test/books-upload-security.test.js`:

```js
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
```

- [ ] **Step 2: Run the upload tests and observe invalid acceptance**

Run: `npm test -- --test-name-pattern="invalid and valid uploads"`

Expected: exit code 1; the invalid upload is not yet returned as the stable 400 response.

- [ ] **Step 3: Add cover compensation by book path**

Add this function to `server/src/services/coverStorage.js`:

```js
export function deleteBookCoverFiles(bookFilePath) {
  ensureCoverDirectory();
  const baseName = coverBaseName(toStoredPath(bookFilePath));

  for (const fileName of readdirSync(coversDir)) {
    if (!fileName.startsWith(`${baseName}.`)) continue;
    const filePath = path.join(coversDir, fileName);
    if (existsSync(filePath)) unlinkSync(filePath);
  }
}
```

- [ ] **Step 4: Replace the upload route orchestration**

In `server/src/routes/books.js`, change the imports to include:

```js
import { existsSync, unlinkSync } from 'node:fs';
import { deleteBookCoverFiles } from '../services/coverStorage.js';
import {
  createEpubUploadStorage,
  fileNameFromUpload,
  isEpubUpload,
  moveValidatedUploadToBooks,
  titleFromUpload,
} from '../services/fileStorage.js';
import {
  addBookFileToLibrary,
  deleteBookById,
  getBookById,
  getBookFilePath,
  inspectEpubFile,
  listBooks,
  updateShelfBookOrder,
} from '../services/bookLibrary.js';
```

Replace the complete POST route handler that begins with `router.post('/', handleUpload, async` with:

```js
router.post('/', handleUpload, async (req, res, next) => {
  const stagedPath = req.file?.path;
  let finalPath = null;
  let committed = false;

  try {
    const db = requireDatabase(req);
    if (!req.file) {
      const error = new Error('EPUB file is required');
      error.status = 400;
      throw error;
    }

    const displayFileName = fileNameFromUpload(req.file);
    const epubDetails = await inspectEpubFile(stagedPath);
    finalPath = moveValidatedUploadToBooks(stagedPath, displayFileName);
    const book = await addBookFileToLibrary(db, finalPath, {
      archiveValidated: true,
      epubDetails,
      fileName: displayFileName,
      title: titleFromUpload(req.file),
    });
    committed = true;
    res.status(201).json({ book });
  } catch (error) {
    if (!committed) {
      for (const filePath of [stagedPath, finalPath]) {
        if (!filePath || !existsSync(filePath)) continue;
        try { unlinkSync(filePath); } catch { /* Preserve the primary error. */ }
      }
      if (finalPath) {
        try { deleteBookCoverFiles(finalPath); } catch { /* Preserve the primary error. */ }
      }
    }
    next(error);
  }
});
```

- [ ] **Step 5: Initialize staging and return/log errors safely**

Replace the file-storage import in `server/src/app.js` with:

```js
import {
  cleanupStaleUploads,
  coversDir,
  ensureCoverDirectory,
  ensureStagingDirectory,
} from './services/fileStorage.js';
```

Immediately after `ensureCoverDirectory()` in `createApp`, add:

```js
  ensureStagingDirectory();
  cleanupStaleUploads();
```

Replace the global error middleware with:

```js
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) {
      console.error(`${req.method} ${req.path}`, err.stack || err);
    }

    const body = {
      error: status === 500 ? 'Internal Server Error' : err.message,
    };
    if (err.code) body.code = err.code;
    res.status(status).json(body);
  });
```

- [ ] **Step 6: Run upload and cleanup tests**

Run:

```powershell
npm test -- --test-name-pattern="invalid and valid uploads"
npm test
```

Expected: both commands exit 0; invalid response is 400/`INVALID_EPUB`, valid response is 201, and staging/books/covers/database counts match the tests.

- [ ] **Step 7: Commit upload compensation**

```powershell
git add server/src/services/coverStorage.js server/src/routes/books.js server/src/app.js server/test/books-upload-security.test.js
git commit -m "fix: compensate failed epub uploads"
```

### Task 5: Production dependencies, client error text, and audit gate

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `client/package.json`
- Modify: `client/package-lock.json`
- Create: `client/src/api/booksApi.test.js`
- Modify: `client/src/api/booksApi.js`
- Modify: `client/src/hooks/useUploadBooks.js`
- Modify: `.github/workflows/quality.yml`

- [ ] **Step 1: Move adm-zip to production dependencies**

Run:

```powershell
Set-Location server
npm install --save-prod adm-zip@^0.5.16
npm pkg delete devDependencies.adm-zip
npm install
```

Expected: `server/package.json` contains `"adm-zip": "^0.5.16"` under `dependencies`, contains no devDependency with that name, and `npm test` can import it.

- [ ] **Step 2: Pin epub.js and override xmldom without upgrading epub.js**

Change the relevant `client/package.json` fields to:

```json
{
  "dependencies": {
    "epubjs": "0.3.93"
  },
  "overrides": {
    "@xmldom/xmldom": "0.8.13"
  }
}
```

Keep every other existing dependency unchanged, then run:

```powershell
Set-Location client
npm install
npm ls epubjs @xmldom/xmldom
```

Expected: the tree reports `epubjs@0.3.93` and `@xmldom/xmldom@0.8.13` with no `invalid` marker.

- [ ] **Step 3: Write a failing upload error-message test**

Create `client/src/api/booksApi.test.js`:

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadBook } from './booksApi.js';

describe('uploadBook', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the server error message for an invalid EPUB', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'EPUB 文件无效或已损坏', code: 'INVALID_EPUB' }),
    }));

    await expect(uploadBook(new File(['bad'], 'bad.epub')))
      .rejects.toThrow('EPUB 文件无效或已损坏');
  });
});
```

- [ ] **Step 4: Run the client test and observe the generic message**

Run: `npm test -- booksApi.test.js`

Expected: exit code 1 because the current message is only `上传失败`.

- [ ] **Step 5: Parse the response and retain per-file failure reasons**

Replace the failed-response block in `uploadBook` with:

```js
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || '上传失败');
  }
```

In `client/src/hooks/useUploadBooks.js`, replace the inner catch with:

```js
          } catch (error) {
            const fileName = file.name || '未命名文件';
            failedFiles.push(`${fileName}（${error.message || '上传失败'}）`);
          }
```

The existing `for` loop and final aggregate error remain unchanged, so a bad book does not stop later files.

- [ ] **Step 6: Add client audit to quality CI**

In `.github/workflows/quality.yml`, add this step to the `client` job immediately after `npm test`:

```yaml
      - run: npm audit --omit=dev
```

- [ ] **Step 7: Run dependency and application gates**

Run:

```powershell
npm test --prefix server
npm audit --omit=dev --prefix server
npm test --prefix client
npm audit --omit=dev --prefix client
npm run build --prefix client
npm run verify:reader-mobile --prefix client
```

Expected: all commands exit 0; client audit reports zero production vulnerabilities, and the build still resolves epubjs 0.3.93.

- [ ] **Step 8: Commit dependency and client error fixes**

```powershell
git add server/package.json server/package-lock.json client/package.json client/package-lock.json client/src/api/booksApi.js client/src/api/booksApi.test.js client/src/hooks/useUploadBooks.js .github/workflows/quality.yml
git commit -m "fix: pin safe xmldom and report invalid uploads"
```

## Self-review checklist

- [ ] Disguised files, missing/wrong mimetype, missing container, corrupt ZIP, entry count, total size, per-entry size and epub2 parse failures all become status 400 with code `INVALID_EPUB`.
- [ ] Upload ordering is staging → inspect → atomic move → database; pre-commit failures remove staging/final/cover artifacts; manual invalid files remain on disk but lose any database/cover tracking.
- [ ] Stale cleanup only examines direct regular files under `stagingDir`, retains directories and files no older than 24 hours, and never recursively deletes.
- [ ] `epubjs` is exactly 0.3.93, xmldom is exactly 0.8.13, adm-zip is a server production dependency, and client audit is mandatory.
- [ ] Scan this document for every prohibited placeholder phrase named by the writing-plans skill; expected result is zero matches.
- [ ] Verify consistent names: `InvalidEpubError`, `INVALID_EPUB`, `validateEpubArchive`, `inspectEpubFile`, `stagingDir`, `moveValidatedUploadToBooks`, and `deleteBookCoverFiles`.
