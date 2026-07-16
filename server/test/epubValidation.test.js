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
