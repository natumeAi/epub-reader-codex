import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, '..', '..');

export const booksDir = path.join(serverRoot, 'data', 'books');

export function ensureBookDirectory() {
  mkdirSync(booksDir, { recursive: true });
}

export function createEpubUploadStorage() {
  return multer.diskStorage({
    destination(req, file, callback) {
      ensureBookDirectory();
      callback(null, booksDir);
    },
    filename(req, file, callback) {
      callback(null, `${Date.now()}-${randomUUID()}.epub`);
    },
  });
}

export function isEpubFileName(fileName) {
  return path.extname(fileName).toLowerCase() === '.epub';
}

export function isEpubUpload(file) {
  return isEpubFileName(file.originalname);
}

export function titleFromFileName(fileName) {
  return path.basename(fileName, path.extname(fileName)).trim() || 'Untitled Book';
}

export function titleFromUpload(file) {
  return titleFromFileName(file.originalname);
}

export function toStoredPath(filePath) {
  return path.relative(serverRoot, filePath).replaceAll(path.sep, '/');
}

export function toAbsoluteStoragePath(storedPath) {
  return path.join(serverRoot, storedPath);
}
