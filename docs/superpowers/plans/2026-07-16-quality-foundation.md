# Quality Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立隔离、可重复、可由 CI 执行的服务端、客户端和移动端测试基础，不改变生产功能或 Docker/NAS 部署。

**Architecture:** 服务端测试使用 `node:test`，每个测试进程先设置临时 `EPUB_DATA_DIR` 和 `DATABASE_PATH` 再动态导入应用模块；客户端使用 Vitest、jsdom 与 Testing Library。移动端脚本在未提供 `APP_URL` 时启动临时后端和 Vite，运行现有触摸断言后只清理自己创建的系统临时目录。

**Tech Stack:** Node.js 22、node:test、better-sqlite3、adm-zip、React 19、Vitest、jsdom、Testing Library、Playwright、GitHub Actions

---

## File map

- Modify: `server/package.json` — 增加服务端测试脚本和 EPUB fixture 的开发依赖。
- Modify: `server/package-lock.json` — 由 npm 记录服务端依赖树。
- Modify: `server/src/services/fileStorage.js` — 让 books/covers 根目录可由 `EPUB_DATA_DIR` 隔离。
- Create: `server/test/helpers/createTestEnvironment.js` — 创建、关闭并安全清理测试数据库与目录。
- Create: `server/test/helpers/createEpubFixture.js` — 生成 epub2 可解析的最小 EPUB。
- Create: `server/test/quality-foundation.test.js` — 验证临时路径、fixture 和 HTTP app 基础链路。
- Modify: `client/package.json` — 增加 Vitest 脚本及 Testing Library 依赖。
- Modify: `client/package-lock.json` — 由 npm 记录客户端测试依赖树。
- Create: `client/vitest.config.js` — 配置 jsdom 与测试初始化文件。
- Create: `client/src/test/setup.js` — 在每个测试后清理 DOM、存储、timer 和 mock。
- Create: `client/src/components/bookshelf/DeleteConfirmDialog.test.jsx` — 客户端渲染烟雾测试。
- Modify: `client/vite.config.js` — 允许隔离验证脚本指定临时 API 地址。
- Create: `client/scripts/reader-verification-environment.mjs` — 管理临时 EPUB、子进程、端口探活和清理。
- Modify: `client/scripts/verify-reader-mobile.mjs` — 复用现有断言，但从隔离环境取得 URL、浏览器和截图路径。
- Create: `.github/workflows/quality.yml` — 独立运行 server、client 和 mobile 三个质量 job。

### Task 1: Server test command and isolated storage root

**Files:**
- Modify: `server/package.json`
- Modify: `server/package-lock.json`
- Modify: `server/src/services/fileStorage.js`
- Test: `server/test/quality-foundation.test.js`

- [ ] **Step 1: Install the fixture dependency and add the test command**

Run:

```powershell
Set-Location server
npm install --save-dev adm-zip@^0.5.16
npm pkg set 'scripts.test=node --test --test-concurrency=1'
```

Confirm the relevant `server/package.json` sections are exactly:

```json
{
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "node --test --test-concurrency=1"
  },
  "devDependencies": {
    "adm-zip": "^0.5.16"
  }
}
```

Expected: npm exits 0 and both package files are modified; `adm-zip` is not yet in production `dependencies`.

- [ ] **Step 2: Write the failing isolated-path test**

Create `server/test/quality-foundation.test.js` with this first test:

```js
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
```

- [ ] **Step 3: Run the test and verify the helper is missing**

Run: `npm test -- --test-name-pattern="EPUB_DATA_DIR isolates"`

Expected: exit code 1 with `ERR_MODULE_NOT_FOUND` for `server/test/helpers/createTestEnvironment.js`.

- [ ] **Step 4: Add the test-environment helper**

Create `server/test/helpers/createTestEnvironment.js`:

```js
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function restoreEnvironmentVariable(name, previousValue) {
  if (previousValue === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = previousValue;
}

export async function createTestEnvironment(t) {
  const rootDir = mkdtempSync(path.join(tmpdir(), 'epub-reader-test-'));
  const dataDir = path.join(rootDir, 'data');
  const booksDir = path.join(dataDir, 'books');
  const coversDir = path.join(dataDir, 'covers');
  const databasePath = path.join(dataDir, 'library.sqlite');
  const previousDataDir = process.env.EPUB_DATA_DIR;
  const previousDatabasePath = process.env.DATABASE_PATH;

  mkdirSync(booksDir, { recursive: true });
  mkdirSync(coversDir, { recursive: true });
  process.env.EPUB_DATA_DIR = dataDir;
  process.env.DATABASE_PATH = databasePath;

  const { createDatabase } = await import('../../src/db/database.js');
  const db = createDatabase({ databasePath });

  t.after(() => {
    if (db.open) db.close();
    restoreEnvironmentVariable('EPUB_DATA_DIR', previousDataDir);
    restoreEnvironmentVariable('DATABASE_PATH', previousDatabasePath);
    rmSync(rootDir, { recursive: true, force: true });
  });

  return {
    booksDir,
    coversDir,
    dataDir,
    databasePath,
    db,
    rootDir,
  };
}

export async function startTestServer(app, t) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));

  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}
```

- [ ] **Step 5: Derive storage paths from `EPUB_DATA_DIR`**

Replace the path declarations near the top of `server/src/services/fileStorage.js` with:

```js
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, '..', '..');

export const dataDir = process.env.EPUB_DATA_DIR
  ? path.resolve(process.env.EPUB_DATA_DIR)
  : path.join(serverRoot, 'data');
export const booksDir = path.join(dataDir, 'books');
export const coversDir = path.join(dataDir, 'covers');
```

Replace the two storage-path conversion functions at the bottom of that file with:

```js
export function toStoredPath(filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(dataDir, absolutePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    const error = new Error('Storage path is outside EPUB_DATA_DIR');
    error.status = 500;
    throw error;
  }

  return `data/${relativePath.replaceAll(path.sep, '/')}`;
}

export function toAbsoluteStoragePath(storedPath) {
  if (!storedPath?.startsWith('data/')) {
    const error = new Error('Stored path is outside EPUB_DATA_DIR');
    error.status = 500;
    throw error;
  }

  const absolutePath = path.resolve(dataDir, storedPath.slice('data/'.length));
  const relativePath = path.relative(dataDir, absolutePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    const error = new Error('Stored path is outside EPUB_DATA_DIR');
    error.status = 500;
    throw error;
  }

  return absolutePath;
}
```

- [ ] **Step 6: Run the isolated-path test**

Run: `npm test -- --test-name-pattern="EPUB_DATA_DIR isolates"`

Expected: exit code 0 with one passing test and no files created under `server/data`.

- [ ] **Step 7: Commit the server harness skeleton**

```powershell
git add server/package.json server/package-lock.json server/src/services/fileStorage.js server/test
git commit -m "test: add isolated server test harness"
```

### Task 2: Minimal EPUB fixture and HTTP smoke coverage

**Files:**
- Create: `server/test/helpers/createEpubFixture.js`
- Modify: `server/test/quality-foundation.test.js`

- [ ] **Step 1: Replace the smoke file with one isolated environment covering paths, fixture, and health**

Replace `server/test/quality-foundation.test.js` with:

```js
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createEpubFixture } from './helpers/createEpubFixture.js';
import {
  createTestEnvironment,
  startTestServer,
} from './helpers/createTestEnvironment.js';

test('isolated storage, EPUB fixture, and HTTP health work together', async (t) => {
  const environment = await createTestEnvironment(t);
  const storage = await import('../src/services/fileStorage.js');
  const fixturePath = path.join(environment.booksDir, 'Fixture.epub');
  createEpubFixture(fixturePath, { title: 'Fixture Book', paragraphCount: 3 });

  const [{ parseEpubDetails }, { createApp }] = await Promise.all([
    import('../src/services/epubService.js'),
    import('../src/app.js'),
  ]);
  const details = await parseEpubDetails(fixturePath);
  const baseUrl = await startTestServer(createApp({ db: environment.db }), t);
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(storage.booksDir, environment.booksDir);
  assert.equal(storage.coversDir, environment.coversDir);
  assert.equal(environment.databasePath.startsWith(environment.rootDir), true);
  assert.equal(existsSync(fixturePath), true);
  assert.equal(details.metadata.title, 'Fixture Book');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok',
    service: 'epub-reader-server',
    database: 'ok',
  });
});
```

- [ ] **Step 2: Run the fixture test and verify it fails**

Run: `npm test -- --test-name-pattern="EPUB fixture"`

Expected: exit code 1 with `ERR_MODULE_NOT_FOUND` for `createEpubFixture.js`.

- [ ] **Step 3: Implement the fixture generator**

Create `server/test/helpers/createEpubFixture.js`:

```js
import path from 'node:path';
import AdmZip from 'adm-zip';

const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

function contentOpf(title, author) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:fixture-book</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`;
}

function chapterXhtml(paragraphCount) {
  const paragraphs = Array.from(
    { length: paragraphCount },
    (_, index) => `<p>测试段落 ${index + 1}：用于隔离阅读器验证。</p>`,
  ).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Fixture Chapter</title></head>
  <body><h1>Fixture Chapter</h1>${paragraphs}</body>
</html>`;
}

export function createEpubFixture(filePath, options = {}) {
  const title = options.title || 'Test Book';
  const author = options.author || 'Test Author';
  const paragraphCount = Number.isInteger(options.paragraphCount)
    ? Math.max(1, options.paragraphCount)
    : 1;
  const zip = new AdmZip();

  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.getEntry('mimetype').header.method = 0;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));
  zip.addFile('OEBPS/content.opf', Buffer.from(contentOpf(title, author)));
  zip.addFile('OEBPS/chapter.xhtml', Buffer.from(chapterXhtml(paragraphCount)));
  zip.writeZip(path.resolve(filePath));

  return path.resolve(filePath);
}
```

- [ ] **Step 4: Run all server tests**

Run: `npm test`

Expected: exit code 0, one passing integration test, and no open-handle warning. Keeping one environment per test file avoids rebinding import-time storage constants to a deleted directory.

- [ ] **Step 5: Commit the fixture**

```powershell
git add server/test
git commit -m "test: add minimal epub fixture"
```

### Task 3: Client Vitest and Testing Library foundation

**Files:**
- Modify: `client/package.json`
- Modify: `client/package-lock.json`
- Create: `client/vitest.config.js`
- Create: `client/src/test/setup.js`
- Create: `client/src/components/bookshelf/DeleteConfirmDialog.test.jsx`

- [ ] **Step 1: Install the client test dependencies and scripts**

Run:

```powershell
Set-Location client
npm install --save-dev vitest@^3.2.4 jsdom@^26.1.0 @testing-library/react@^16.3.0 @testing-library/jest-dom@^6.6.3
npm pkg set 'scripts.test=vitest run' 'scripts.test:watch=vitest'
```

Expected: npm exits 0; `package.json` contains `test` and `test:watch`, and the four packages are in `devDependencies`.

- [ ] **Step 2: Write the failing component smoke test**

Create `client/src/components/bookshelf/DeleteConfirmDialog.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConfirmDialog } from './DeleteConfirmDialog.jsx';

describe('DeleteConfirmDialog', () => {
  it('renders an accessible confirmation dialog', () => {
    render(
      <DeleteConfirmDialog
        book={{ id: 7, title: '测试书' }}
        isDeleting={false}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '删除《测试书》？' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '删除' })).toBeEnabled();
  });
});
```

- [ ] **Step 3: Run the test and verify Vitest is not configured**

Run: `npm test -- DeleteConfirmDialog.test.jsx`

Expected: exit code 1 because `toBeInTheDocument`/`toBeEnabled` is unavailable before setup is loaded.

- [ ] **Step 4: Add Vitest configuration and deterministic cleanup**

Create `client/vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    clearMocks: true,
    restoreMocks: true,
  },
});
```

Create `client/src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (timer) => clearTimeout(timer);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 5: Run the client smoke test and production build**

Run:

```powershell
npm test -- DeleteConfirmDialog.test.jsx
npm run build
```

Expected: both commands exit 0; Vitest reports one passing test and Vite writes `dist/`.

- [ ] **Step 6: Commit the client test foundation**

```powershell
git add client/package.json client/package-lock.json client/vitest.config.js client/src/test client/src/components/bookshelf/DeleteConfirmDialog.test.jsx
git commit -m "test: add client vitest foundation"
```

### Task 4: Self-contained mobile verification environment

**Files:**
- Modify: `client/vite.config.js`
- Create: `client/scripts/reader-verification-environment.mjs`
- Modify: `client/scripts/verify-reader-mobile.mjs`

- [ ] **Step 1: Make Vite's proxy target configurable**

Replace `client/vite.config.js` with:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = process.env.EPUB_API_URL || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
      '/covers': apiTarget,
    },
  },
});
```

- [ ] **Step 2: Add the isolated process/environment manager**

Create `client/scripts/reader-verification-environment.mjs`:

```js
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEpubFixture } from '../../server/test/helpers/createEpubFixture.js';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(clientRoot, '..');
const serverRoot = path.join(repositoryRoot, 'server');
const browserCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

function collectOutput(child) {
  const chunks = [];
  const append = (chunk) => {
    chunks.push(String(chunk));
    if (chunks.length > 80) chunks.shift();
  };

  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return () => chunks.join('').trim();
}

function startNode(scriptPath, args, options) {
  return spawn(process.execPath, [scriptPath, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  await new Promise((resolve) => {
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5000);
    child.once('exit', () => {
      clearTimeout(forceTimer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function waitFor(url, predicate, diagnostics, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.json().catch(() => null);
      if (response.ok && predicate(body)) return body;
      lastError = `HTTP ${response.status}: ${JSON.stringify(body)}`;
    } catch (error) {
      lastError = error.message;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError}\n${diagnostics()}`);
}

function browserLaunchOptions() {
  const executablePath = browserCandidates.find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath, headless: true } : { headless: true };
}

export async function prepareReaderVerification() {
  const externalAppUrl = process.env.APP_URL;

  if (externalAppUrl) {
    return {
      appUrl: externalAppUrl,
      browserOptions: browserLaunchOptions(),
      cleanup: async () => {},
      screenshotPath: process.env.SCREENSHOT_PATH || path.join(tmpdir(), `reader-mobile-${process.pid}.png`),
    };
  }

  const rootDir = mkdtempSync(path.join(tmpdir(), 'epub-reader-mobile-'));
  const dataDir = path.join(rootDir, 'data');
  const booksDir = path.join(dataDir, 'books');
  const databasePath = path.join(dataDir, 'library.sqlite');
  const serverPort = Number(process.env.READER_TEST_SERVER_PORT || 3199);
  const clientPort = Number(process.env.READER_TEST_CLIENT_PORT || 4173);
  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const appUrl = `http://127.0.0.1:${clientPort}/`;
  const screenshotPath = process.env.SCREENSHOT_PATH || path.join(rootDir, 'reader-settings-narrow.png');
  const children = [];

  mkdirSync(booksDir, { recursive: true });
  createEpubFixture(path.join(booksDir, 'Mobile Fixture.epub'), {
    title: 'Mobile Fixture',
    paragraphCount: 80,
  });

  const serverChild = startNode(path.join(serverRoot, 'src', 'index.js'), [], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATABASE_PATH: databasePath,
      EPUB_DATA_DIR: dataDir,
      HOST: '127.0.0.1',
      PORT: String(serverPort),
    },
  });
  const serverOutput = collectOutput(serverChild);
  children.push(serverChild);

  const viteEntry = path.join(clientRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const clientChild = startNode(viteEntry, ['--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'], {
    cwd: clientRoot,
    env: { ...process.env, EPUB_API_URL: serverUrl },
  });
  const clientOutput = collectOutput(clientChild);
  children.push(clientChild);

  const diagnostics = () => [
    `server output:\n${serverOutput()}`,
    `client output:\n${clientOutput()}`,
  ].join('\n');

  const cleanup = async () => {
    await Promise.all(children.reverse().map(stopProcess));
    rmSync(rootDir, { recursive: true, force: true });
  };

  try {
    await waitFor(`${serverUrl}/api/health`, (body) => body?.database === 'ok', diagnostics);
    await waitFor(`${serverUrl}/api/folders/shelf`, (body) => body?.items?.length === 1, diagnostics);
    await waitFor(appUrl, () => true, diagnostics);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    appUrl,
    browserOptions: browserLaunchOptions(),
    cleanup,
    screenshotPath,
  };
}
```

- [ ] **Step 3: Wire the existing mobile assertions to the environment manager**

At the top of `client/scripts/verify-reader-mobile.mjs`, replace the existing URL, screenshot, browser-path and `findBrowserPath` declarations with:

```js
import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification();
const APP_URL = environment.appUrl;
const SCREENSHOT_PATH = environment.screenshotPath;
const browser = await chromium.launch(environment.browserOptions);
```

Keep the existing `browser.newPage` call and all existing assertions unchanged. Replace the final block with:

```js
} finally {
  await browser.close();
  await environment.cleanup();
}
```

- [ ] **Step 4: Run the isolated mobile verification**

Run: `npm run verify:reader-mobile`

Expected: exit code 0; JSON output includes `viewport.width: 375`, all required labels, `darkTheme: true`, and `font.title: "字号"`. If no system Chrome/Edge exists, Playwright bundled Chromium is used.

- [ ] **Step 5: Confirm the script did not mutate tracked data or the user's screenshot**

Run:

```powershell
git status --short -- server/data client/reader-settings-narrow.png
```

Expected: no output. The pre-existing untracked root/client screenshot remains untouched.

- [ ] **Step 6: Commit the isolated browser harness**

```powershell
git add client/vite.config.js client/scripts/reader-verification-environment.mjs client/scripts/verify-reader-mobile.mjs
git commit -m "test: isolate mobile reader verification"
```

### Task 5: Independent quality CI workflow

**Files:**
- Create: `.github/workflows/quality.yml`

- [ ] **Step 1: Add the workflow**

Create `.github/workflows/quality.yml`:

```yaml
name: Quality

on:
  push:
  pull_request:

permissions:
  contents: read

jobs:
  server:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: server/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm audit --omit=dev

  client:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: client
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: client/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run build

  mobile:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: |
            server/package-lock.json
            client/package-lock.json
      - run: npm ci
        working-directory: server
      - run: npm ci
        working-directory: client
      - run: npx playwright install --with-deps chromium
        working-directory: client
      - run: npm run verify:reader-mobile
        working-directory: client
```

- [ ] **Step 2: Run the exact non-Docker local quality commands**

Run:

```powershell
npm test --prefix server
npm audit --omit=dev --prefix server
npm test --prefix client
npm run build --prefix client
npm run verify:reader-mobile --prefix client
```

Expected: all five commands exit 0. Docker image build, Compose startup and NAS checks are intentionally absent.

- [ ] **Step 3: Commit the quality workflow**

```powershell
git add .github/workflows/quality.yml
git commit -m "ci: add application quality workflow"
```

### Task 6: Plan-level acceptance check

**Files:**
- Verify only: `server/data`
- Verify only: `client/reader-settings-narrow.png`
- Verify only: `.github/workflows/quality.yml`

- [ ] **Step 1: Capture protected-path state, run the suite, and compare**

Run:

```powershell
$before = git status --porcelain=v1 -- server/data client/reader-settings-narrow.png
npm test --prefix server
npm test --prefix client
npm run build --prefix client
npm run verify:reader-mobile --prefix client
$after = git status --porcelain=v1 -- server/data client/reader-settings-narrow.png
if ($before -ne $after) { throw "测试修改了受保护路径" }
```

Expected: all commands exit 0 and the comparison throws no error.

- [ ] **Step 2: Inspect final changes and commit any test-only corrections**

Run: `git status --short`

Expected: no uncommitted files from this plan except the user's pre-existing `client/reader-settings-narrow.png`; if a correction was required, stage only files listed in this plan and commit with `git commit -m "test: stabilize quality foundation"`.

## Self-review checklist

- [ ] Every quality-foundation spec item maps to Tasks 1–5: server isolation, valid fixture, client test stack, autonomous mobile run, and separate CI jobs.
- [ ] No Dockerfile, Compose file, Docker registry secret, NAS command, or deployed environment check appears in the implementation steps.
- [ ] Scan this document for every prohibited placeholder phrase named by the writing-plans skill; expected result is zero matches.
- [ ] Verify the shared names are consistent: `EPUB_DATA_DIR`, `createTestEnvironment`, `createEpubFixture`, `prepareReaderVerification`, `EPUB_API_URL`, and `verify:reader-mobile`.
- [ ] Verify every code-changing step includes an exact command or complete code block, and every test command states its expected failure or success.
