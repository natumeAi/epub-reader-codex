import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import {
  inspectBookshelfLayout,
  inspectBookshelfSearch,
} from './bookshelf-verification-assertions.mjs';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const CATALOG_SIZE = 350;
const HISTORY_FOLDER_ID = 1001;

function buildFixtures() {
  const catalogBooks = Array.from({ length: CATALOG_SIZE }, (_, index) => {
    const id = index + 1;
    const isHistoryBook = id >= 301;
    return {
      id,
      title: `书籍 ${id}`,
      author: `作者 ${id}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      folderId: isHistoryBook ? HISTORY_FOLDER_ID : null,
      folderName: isHistoryBook ? '历史' : null,
    };
  });
  const recentItems = catalogBooks.slice(0, 10).map((book, index) => ({
    book,
    progress: {
      bookId: book.id,
      cfi: null,
      progress: (index + 1) / 20,
      chapterHref: null,
      chapterLabel: null,
      updatedAt: new Date(Date.UTC(2026, 6, 18, 0, 10 - index)).toISOString(),
    },
  }));
  const rootBookItems = catalogBooks.slice(0, 18).map((book, index) => ({
    type: 'book',
    id: book.id,
    sortOrder: index,
    book,
  }));
  const folders = [
    {
      id: HISTORY_FOLDER_ID,
      name: '历史',
      previewBooks: catalogBooks.slice(300, 304),
    },
    { id: 1002, name: '文学', previewBooks: [] },
    { id: 1003, name: '科技', previewBooks: [] },
  ];
  const folderItems = folders.map((folder, index) => ({
    type: 'folder',
    id: folder.id,
    sortOrder: rootBookItems.length + index,
    folder,
  }));

  return {
    catalogBooks,
    recentItems,
    shelfItems: [...rootBookItems, ...folderItems],
  };
}

async function installFixtureRoutes(page, fixtures, { catalogFailure = false } = {}) {
  await page.route('**/api/folders/shelf', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: fixtures.shelfItems }),
  }));
  await page.route('**/api/reading/recent', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ items: fixtures.recentItems }),
  }));
  await page.route('**/api/books/catalog', (route) => route.fulfill({
    status: catalogFailure ? 503 : 200,
    contentType: 'application/json',
    body: JSON.stringify(catalogFailure
      ? { error: 'catalog fixture unavailable' }
      : { books: fixtures.catalogBooks }),
  }));
  await page.route('**/api/folders/1001/books', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      books: fixtures.catalogBooks.filter((book) => book.folderId === HISTORY_FOLDER_ID),
    }),
  }));
}

async function collectLayoutSnapshot(page) {
  return page.evaluate(() => {
    const toRect = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };
    const shelfItems = Array.from(document.querySelectorAll('.shelf-grid > .shelf-item'));
    const firstItemTop = shelfItems[0]?.getBoundingClientRect().top;
    const firstShelfRow = firstItemTop === undefined
      ? []
      : shelfItems
          .filter((item) => Math.abs(item.getBoundingClientRect().top - firstItemTop) < 1)
          .map(toRect);
    const touchTargets = Array.from(document.querySelectorAll([
      '.upload-button',
      '.library-search-input',
      '.library-search-clear',
      '.library-search-cancel',
      '.library-catalog-error button',
      '.library-view-options button',
      '.library-view-toolbar select',
      '.library-empty-action',
      '.library-error-action',
      '.empty-state button',
    ].join(','))).map(toRect);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      app: toRect(document.querySelector('.app-shell')),
      documentScrollWidth: document.documentElement.scrollWidth,
      search: toRect(document.querySelector('.library-search-control')),
      continueSection: toRect(document.querySelector('.continue-reading')),
      firstShelfRow,
      continueViewport: toRect(document.querySelector('.continue-reading-list')),
      continueCards: Array.from(document.querySelectorAll('.continue-book-button'))
        .slice(0, 2)
        .map(toRect),
      touchTargets,
    };
  });
}

function requireNoErrors(label, errors, snapshot) {
  if (!errors.length) return;
  throw new Error(`${label}: ${errors.join('；')}\n${JSON.stringify(snapshot, null, 2)}`);
}

async function setSearchAndMeasure(page, value) {
  return page.evaluate(async (nextValue) => {
    const input = document.querySelector('#library-search-input');
    if (!input) throw new Error('未找到书架搜索框');
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!valueSetter) throw new Error('无法设置书架搜索值');

    const start = performance.now();
    valueSetter.call(input, nextValue);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    return new Promise((resolve, reject) => {
      const deadline = start + 5000;
      const inspect = () => {
        const modeStatus = document.querySelector('.library-mode-status')?.textContent || '';
        const result = document.querySelector('.read-only-shelf-item');
        if (result && modeStatus.includes(nextValue)) {
          resolve(performance.now() - start);
          return;
        }
        if (performance.now() >= deadline) {
          reject(new Error(`等待搜索“${nextValue}”更新超时`));
          return;
        }
        requestAnimationFrame(inspect);
      };
      requestAnimationFrame(inspect);
    });
  }, value);
}

async function hasVisibleSearchFocus(page, searchbox) {
  const control = page.locator('.library-search-control');
  const before = await control.evaluate((element) => getComputedStyle(element).boxShadow);
  await searchbox.focus();
  const after = await control.evaluate((element) => getComputedStyle(element).boxShadow);
  return before !== after && after !== 'none';
}

async function probeReadOnlyDrag(page) {
  const item = page.locator('.read-only-shelf-item').first();
  const box = await item.boundingBox();
  if (!box) throw new Error('无法定位只读搜索结果');
  await item.evaluate((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, once: true });
  });

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 48, startY, { steps: 4 });
  await page.waitForTimeout(150);
  const activated = await page.evaluate(() => Boolean(
    document.querySelector('.read-only-shelf-item.is-dragging') ||
    document.querySelector('.drag-preview') ||
    document.querySelector('.delete-drop-zone'),
  ));
  await page.mouse.up();
  return activated;
}

if (process.env.APP_URL) {
  throw new Error('verify:bookshelf-home 只允许使用本地临时验证环境');
}

const fixtures = buildFixtures();
const environment = await prepareReaderVerification({ fixtureCount: 1 });
let browser;

try {
  browser = await chromium.launch(environment.browserOptions);
  const page = await browser.newPage({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  await installFixtureRoutes(page, fixtures);

  let typedRequestCount = 0;
  let countTypedRequests = false;
  page.on('request', (request) => {
    if (
      countTypedRequests &&
      new URL(request.url()).pathname.startsWith('/api/')
    ) {
      typedRequestCount += 1;
    }
  });

  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.getByRole('searchbox', { name: '搜索书名、作者或文件夹' }).waitFor();
  await page.getByRole('heading', { name: '继续阅读' }).waitFor();
  await page.getByLabel('可编辑书架列表').waitFor();

  const mobile430 = await collectLayoutSnapshot(page);
  requireNoErrors('430×932 布局不符合规格', inspectBookshelfLayout(mobile430), mobile430);

  const searchbox = page.getByRole('searchbox', { name: '搜索书名、作者或文件夹' });
  const focusIndicatorVisible = await hasVisibleSearchFocus(page, searchbox);
  await searchbox.fill('书籍 1');
  await page.getByRole('button', { name: '书籍 1', exact: true }).click();
  const reader = page.locator('.reader-overlay');
  await reader.waitFor({ timeout: 15000 });
  await page.locator('.reader-gesture-layer').tap({ position: { x: 215, y: 466 } });
  await page.locator('.reader-close-button').click();
  await reader.waitFor({ state: 'detached', timeout: 5000 });
  const readerQueryPreserved = (await searchbox.inputValue()) === '书籍 1';
  if (!readerQueryPreserved) throw new Error('关闭 reader 后搜索词未保留');

  await searchbox.fill('历史');
  await page.locator('.read-only-shelf-item').filter({ hasText: /^历史$/ }).click();
  const folder = page.locator('.folder-overlay');
  await folder.waitFor({ timeout: 5000 });
  await page.locator('.folder-close-button').click();
  await folder.waitFor({ state: 'detached', timeout: 5000 });
  const folderQueryPreserved = (await searchbox.inputValue()) === '历史';
  if (!folderQueryPreserved) throw new Error('关闭 folder 后搜索词未保留');

  await page.waitForLoadState('networkidle');
  countTypedRequests = true;
  const searchDurationMs = await setSearchAndMeasure(page, '作者 349');
  await page.waitForTimeout(500);
  await page.waitForLoadState('networkidle');
  countTypedRequests = false;
  const readOnlyDragActivated = await probeReadOnlyDrag(page);
  const searchSnapshot = await page.evaluate(({
    durationMs,
    dragActivated,
    focusVisible,
    requestCount,
  }) => ({
    durationMs,
    typedRequestCount: requestCount,
    folderContextVisible: Array.from(document.querySelectorAll('.shelf-item-context'))
      .some((element) => element.textContent?.includes('历史')),
    readOnlyItemCount: document.querySelectorAll('.read-only-shelf-item').length,
    focusIndicatorVisible: focusVisible,
    readOnlyDragActivated: dragActivated,
  }), {
    durationMs: searchDurationMs,
    dragActivated: readOnlyDragActivated,
    focusVisible: focusIndicatorVisible,
    requestCount: typedRequestCount,
  });
  requireNoErrors(
    '350 本本地搜索不符合规格',
    inspectBookshelfSearch(searchSnapshot),
    searchSnapshot,
  );

  await page.getByRole('button', { name: '取消搜索' }).click();
  await page.getByLabel('可编辑书架列表').waitFor();
  await page.setViewportSize({ width: 320, height: 800 });
  const narrow320 = await collectLayoutSnapshot(page);
  requireNoErrors('320px 布局不符合规格', inspectBookshelfLayout(narrow320), narrow320);

  await page.setViewportSize({ width: 1200, height: 932 });
  const wide1200 = await collectLayoutSnapshot(page);
  requireNoErrors('1200px 布局不符合规格', inspectBookshelfLayout(wide1200), wide1200);

  const fallbackPage = await browser.newPage({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  await installFixtureRoutes(fallbackPage, fixtures, { catalogFailure: true });
  await fallbackPage.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });
  const retry = fallbackPage.getByRole('button', { name: '重试加载搜索目录' });
  await retry.waitFor();
  const fallbackContinueVisible = await fallbackPage
    .getByRole('heading', { name: '继续阅读' })
    .isVisible();
  const fallbackEditableShelfVisible = await fallbackPage
    .getByLabel('可编辑书架列表')
    .isVisible();
  const fallbackRootBook = fallbackPage.getByRole('button', { name: '书籍 1', exact: true });
  await fallbackRootBook.focus();
  const fallbackRootBookFocusable = await fallbackRootBook.evaluate(
    (element) => element === document.activeElement && element.tagName === 'BUTTON',
  );
  if (!fallbackContinueVisible || !fallbackEditableShelfVisible || !fallbackRootBookFocusable) {
    throw new Error('catalog 失败时 continue 或可编辑根书架不可用');
  }

  const buildId = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  console.log(JSON.stringify({
    buildId,
    viewports: { mobile430, narrow320, wide1200 },
    searchDurationMs: searchSnapshot.durationMs,
    typedRequestCount: searchSnapshot.typedRequestCount,
    folderContextVisible: searchSnapshot.folderContextVisible,
    readOnlyItemCount: searchSnapshot.readOnlyItemCount,
    focusIndicatorVisible: searchSnapshot.focusIndicatorVisible,
    readOnlyDragActivated: searchSnapshot.readOnlyDragActivated,
    entryRegression: {
      readerQueryPreserved,
      folderQueryPreserved,
    },
    catalogFailureFallback: {
      errorVisible: await fallbackPage.getByText('搜索目录加载失败', { exact: true }).isVisible(),
      retryVisible: await retry.isVisible(),
      continueVisible: fallbackContinueVisible,
      editableShelfVisible: fallbackEditableShelfVisible,
      rootBookFocusable: fallbackRootBookFocusable,
    },
  }, null, 2));
} catch (error) {
  const diagnostics = environment.diagnostics?.();
  throw new Error(
    diagnostics ? `${error.message}\n${diagnostics}` : error.message,
    { cause: error },
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await environment.cleanup();
  }
}
