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

  const watcher = startBookDirectoryWatcher(environment.db, {
    addBookFileToLibrary: async (...args) => { addCalls.push(args); },
    syncBookDirectory: async (...args) => { syncCalls.push(args); },
    watch: () => fakeWatcher,
  });
  t.after(() => watcher.close());

  assert.equal(syncCalls.length, 0);
  await fakeWatcher.emit('ready');
  await fakeWatcher.emit('ready');
  assert.equal(syncCalls.length, 1);

  const changedPath = path.join(environment.booksDir, 'changed.epub');
  await fakeWatcher.emit('change', changedPath);
  assert.equal(addCalls.length, 1);
  assert.deepEqual(addCalls[0][2], { forceRefresh: true });
});
