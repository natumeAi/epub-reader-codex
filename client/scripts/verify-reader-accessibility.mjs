import { chromium } from 'playwright';
import { prepareReaderVerification } from './reader-verification-environment.mjs';

const environment = await prepareReaderVerification({ fixtureCount: 2 });
const browser = await chromium.launch(environment.browserOptions);
const page = await browser.newPage({ viewport: { width: 375, height: 667 } });

async function readJson(response, label) {
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}失败: ${response.status} ${body}`);
  if (!body) throw new Error(`${label}返回空响应`);

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${label}返回无效 JSON: ${body}`, { cause: error });
  }
}

try {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(environment.appUrl, { waitUntil: 'networkidle', timeout: 30000 });

  const firstBook = page.locator('button.book-shell[data-book-id]').first();
  await firstBook.focus();
  await page.keyboard.press('Enter');
  const reader = page.locator('.reader-overlay');
  await reader.waitFor({ timeout: 15000 });
  const readerHasFocus = await reader.evaluate((element) => element === document.activeElement);
  if (!readerHasFocus) throw new Error('阅读器打开后焦点未进入 dialog');

  const readerCloseStarted = Date.now();
  await page.keyboard.press('Escape');
  await reader.waitFor({ state: 'detached', timeout: 500 });
  if (Date.now() - readerCloseStarted >= 500) throw new Error('减少动画时阅读器关闭仍在等待动画');
  if (!(await firstBook.evaluate((element) => element === document.activeElement))) {
    throw new Error('阅读器关闭后焦点未恢复到书籍按钮');
  }

  const shelfResponse = await fetch(new URL('/api/folders/shelf', environment.appUrl));
  const shelf = await readJson(shelfResponse, '读取书架');
  const rootBookIds = shelf.items
    .filter((item) => item.type === 'book')
    .map((item) => item.id);
  if (rootBookIds.length < 2) throw new Error('无障碍 fixture 少于两本书');
  const folderResponse = await fetch(new URL('/api/folders', environment.appUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceBookId: rootBookIds[0], targetBookId: rootBookIds[1] }),
  });
  if (!folderResponse.ok) throw new Error(`创建文件夹失败: ${folderResponse.status}`);

  await page.reload({ waitUntil: 'networkidle' });
  const folderButton = page.locator('button.book-shell').filter({ has: page.locator('.folder-cover') }).first();
  await folderButton.focus();
  await page.keyboard.press('Enter');
  const folderDialog = page.locator('.folder-overlay');
  await folderDialog.waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await folderDialog.waitFor({ state: 'detached', timeout: 500 });
  if (!(await folderButton.evaluate((element) => element === document.activeElement))) {
    throw new Error('文件夹关闭后焦点未恢复');
  }

  console.log(JSON.stringify({
    folderFocusRestored: true,
    readerFocusRestored: true,
    reducedMotion: true,
  }, null, 2));
} catch (error) {
  const diagnostics = environment.diagnostics?.();
  throw new Error(
    diagnostics ? `${error.message}\n${diagnostics}` : error.message,
    { cause: error },
  );
} finally {
  await browser.close();
  await environment.cleanup();
}
