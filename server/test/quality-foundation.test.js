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
