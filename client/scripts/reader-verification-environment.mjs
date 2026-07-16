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
    if (!child.kill('SIGTERM')) {
      clearTimeout(forceTimer);
      resolve();
    }
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

export async function prepareReaderVerification(options = {}) {
  const externalAppUrl = process.env.APP_URL;

  if (externalAppUrl) {
    return {
      appUrl: externalAppUrl,
      browserOptions: browserLaunchOptions(),
      cleanup: async () => {},
      diagnostics: () => '',
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
  const fixtureCount = Number.isInteger(options.fixtureCount)
    ? Math.max(1, options.fixtureCount)
    : 1;

  mkdirSync(booksDir, { recursive: true });
  for (let index = 1; index <= fixtureCount; index += 1) {
    const suffix = index === 1 ? '' : ` ${index}`;
    createEpubFixture(path.join(booksDir, `Mobile Fixture${suffix}.epub`), {
      title: `Mobile Fixture${suffix}`,
      paragraphCount: 80,
    });
  }

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
    await waitFor(
      `${serverUrl}/api/folders/shelf`,
      (body) => body?.items?.length === fixtureCount,
      diagnostics,
    );
    await waitFor(appUrl, () => true, diagnostics);
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    appUrl,
    browserOptions: browserLaunchOptions(),
    cleanup,
    diagnostics,
    screenshotPath,
  };
}
