import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(currentDir, '..', '..');

export const dataDir = process.env.EPUB_DATA_DIR
  ? path.resolve(process.env.EPUB_DATA_DIR)
  : path.join(serverRoot, 'data');
export const booksDir = path.join(dataDir, 'books');
export const coversDir = path.join(dataDir, 'covers');

export function ensureBookDirectory() {
  mkdirSync(booksDir, { recursive: true });
}

export function ensureCoverDirectory() {
  mkdirSync(coversDir, { recursive: true });
}

function safeStorageFileName(fileName) {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim();

  if (!baseName || baseName === '.epub') {
    return 'Untitled Book.epub';
  }

  return isEpubFileName(baseName) ? baseName : `${baseName}.epub`;
}

function availableBookFileName(fileName) {
  const safeName = safeStorageFileName(fileName);
  const parsedName = path.parse(safeName);
  let candidateName = safeName;
  let index = 1;

  while (existsSync(path.join(booksDir, candidateName))) {
    candidateName = `${parsedName.name} (${index})${parsedName.ext || '.epub'}`;
    index += 1;
  }

  return candidateName;
}

export function createEpubUploadStorage() {
  return multer.diskStorage({
    destination(req, file, callback) {
      ensureBookDirectory();
      callback(null, booksDir);
    },
    filename(req, file, callback) {
      callback(null, availableBookFileName(fileNameFromUpload(file)));
    },
  });
}

export function isEpubFileName(fileName) {
  return path.extname(fileName).toLowerCase() === '.epub';
}

export function isEpubUpload(file) {
  return isEpubFileName(file.originalname);
}

export function fileNameFromUpload(file) {
  const decodedName = Buffer.from(file.originalname, 'latin1').toString('utf8');

  if (!decodedName || decodedName.includes('\uFFFD')) {
    return file.originalname;
  }

  return decodedName;
}

export function titleFromFileName(fileName) {
  return path.basename(fileName, path.extname(fileName)).trim() || 'Untitled Book';
}

export function titleFromUpload(file) {
  return titleFromFileName(fileNameFromUpload(file));
}

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
