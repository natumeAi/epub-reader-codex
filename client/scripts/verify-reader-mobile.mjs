import { chromium } from 'playwright';

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/';
const SCREENSHOT_PATH = process.env.SCREENSHOT_PATH || 'reader-settings-narrow.png';
const BROWSER_PATHS = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

async function findBrowserPath() {
  const fs = await import('node:fs');

  return BROWSER_PATHS.find((path) => fs.existsSync(path));
}

const executablePath = await findBrowserPath();

if (!executablePath) {
  throw new Error('未找到可用于 Playwright 的 Chrome 或 Edge 浏览器');
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 375, height: 667 },
  isMobile: true,
  hasTouch: true,
});

try {
  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForSelector('.book-shell', { timeout: 10000 });
  await page.locator('.book-shell').first().tap();
  await page.waitForSelector('.reader-overlay', { timeout: 15000 });
  await page.locator('.reader-bottombar-button').filter({ hasText: '设置' }).tap();
  await page.waitForSelector('.reader-panel-settings', { timeout: 10000 });
  await page.waitForTimeout(450);

  const result = await page.evaluate(() => {
    const panel = document.querySelector('.reader-panel-settings');
    const content = panel.querySelector('.reader-settings-content');
    const panelRect = panel.getBoundingClientRect();
    const labels = [...panel.querySelectorAll('.reader-settings-label')].map((label) =>
      label.textContent.trim(),
    );

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: {
        top: Math.round(panelRect.top),
        bottom: Math.round(panelRect.bottom),
        width: Math.round(panelRect.width),
        height: Math.round(panelRect.height),
      },
      sliders: panel.querySelectorAll('input[type="range"]').length,
      labels,
      canScroll: content.scrollHeight > content.clientHeight,
    };
  });

  const requiredLabels = [
    '字体大小',
    '字体',
    '左右边距',
    '上下边距',
    '行距',
    '字距',
    '主题',
  ];
  const missingLabels = requiredLabels.filter((label) => !result.labels.includes(label));

  if (result.sliders < 5 || missingLabels.length > 0) {
    throw new Error(
      `Aa 设置面板缺少控件：sliders=${result.sliders}, missing=${missingLabels.join(',')}`,
    );
  }

  await page.locator('.reader-theme-option').filter({ hasText: '夜间' }).tap();

  const interactionResult = await page.evaluate(() => {
    const overlay = document.querySelector('.reader-overlay');

    return {
      darkTheme: overlay?.classList.contains('reader-theme-dark') || false,
      turnControlsRemoved:
        !document.body.innerText.includes('翻页方式') &&
        !document.body.innerText.includes('动画效果'),
    };
  });

  if (!interactionResult.darkTheme || !interactionResult.turnControlsRemoved) {
    throw new Error(
      `Aa 设置面板外观控件未生效：${JSON.stringify(interactionResult)}`,
    );
  }

  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
  console.log(JSON.stringify({ ...result, ...interactionResult, screenshot: SCREENSHOT_PATH }, null, 2));
} finally {
  await browser.close();
}
