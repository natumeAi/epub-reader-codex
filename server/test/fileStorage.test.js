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
