export async function getReadingProgress(bookId) {
  const response = await fetch(`/api/reading/${bookId}`);

  if (!response.ok) {
    throw new Error('无法加载阅读进度');
  }

  return response.json();
}

export async function listRecentReading() {
  const response = await fetch('/api/reading/recent');

  if (!response.ok) {
    throw new Error('无法加载最近阅读');
  }

  return response.json();
}

export async function saveReadingProgress(bookId, { cfi, progress, chapterHref, chapterLabel }) {
  const response = await fetch(`/api/reading/${bookId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cfi, progress, chapterHref, chapterLabel }),
  });

  if (!response.ok) {
    throw new Error('无法保存阅读进度');
  }

  return response.json();
}

export async function getReaderSettings() {
  const response = await fetch('/api/reader-settings');

  if (!response.ok) {
    throw new Error('无法加载阅读设置');
  }

  return response.json();
}

export async function saveReaderSettings(settings) {
  const response = await fetch('/api/reader-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    throw new Error('无法保存阅读设置');
  }

  return response.json();
}
