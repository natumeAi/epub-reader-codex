export async function listBooks() {
  const response = await fetch('/api/books');

  if (!response.ok) {
    throw new Error('无法加载书架');
  }

  return response.json();
}

export async function getBook(bookId) {
  const response = await fetch(`/api/books/${bookId}`);

  if (!response.ok) {
    throw new Error(response.status === 404 ? '书籍不存在' : '无法加载书籍');
  }

  return response.json();
}

export async function listShelfItems() {
  const response = await fetch('/api/folders/shelf');

  if (!response.ok) {
    throw new Error('无法加载书架');
  }

  return response.json();
}

export async function uploadBook(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/api/books', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error('上传失败');
  }

  return response.json();
}

export async function deleteBook(bookId) {
  const response = await fetch(`/api/books/${bookId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(response.status === 404 ? '书籍不存在' : '无法删除书籍');
  }

  return response.json();
}

export async function createFolderFromBooks(sourceBookId, targetBookId) {
  const response = await fetch('/api/folders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sourceBookId, targetBookId }),
  });

  if (!response.ok) {
    throw new Error(response.status === 409 ? '只能用书架上的两本书创建文件夹' : '无法创建文件夹');
  }

  return response.json();
}

export async function listFolderBooks(folderId) {
  const response = await fetch(`/api/folders/${folderId}/books`);

  if (!response.ok) {
    throw new Error(response.status === 404 ? '文件夹不存在' : '无法加载文件夹');
  }

  return response.json();
}

export async function renameFolder(folderId, name) {
  const response = await fetch(`/api/folders/${folderId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  });

  if (!response.ok) {
    throw new Error(response.status === 404 ? '文件夹不存在' : '无法重命名文件夹');
  }

  return response.json();
}

export async function moveShelfBookToFolder(folderId, bookId) {
  const response = await fetch(`/api/folders/${folderId}/import-book/${bookId}`, {
    method: 'PATCH',
  });

  if (!response.ok) {
    throw new Error(response.status === 409 ? '只能移动书架上的书籍' : '无法移入文件夹');
  }

  return response.json();
}

export async function moveFolderBookToShelf(folderId, bookId, items) {
  const options = {
    method: 'PATCH',
  };

  if (items) {
    options.headers = {
      'Content-Type': 'application/json',
    };
    options.body = JSON.stringify({ items });
  }

  const response = await fetch(`/api/folders/${folderId}/books/${bookId}/move-to-shelf`, {
    ...options,
  });

  if (!response.ok) {
    throw new Error(response.status === 409 ? '文件夹已变化，请刷新后重试' : '无法移出书籍');
  }

  return response.json();
}

export async function updateBookOrder(bookIds) {
  const response = await fetch('/api/books/order', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookIds }),
  });

  if (!response.ok) {
    throw new Error(response.status === 409 ? '书架已变化，请刷新后重试' : '无法保存书架顺序');
  }

  return response.json();
}

export async function updateShelfItemOrder(items) {
  const response = await fetch('/api/folders/shelf/order', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    throw new Error(response.status === 409 ? '书架已变化，请刷新后重试' : '无法保存书架顺序');
  }

  return response.json();
}

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

export async function updateFolderBookOrder(folderId, bookIds) {
  const response = await fetch(`/api/folders/${folderId}/books/order`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bookIds }),
  });

  if (!response.ok) {
    throw new Error(response.status === 409 ? '文件夹已变化，请刷新后重试' : '无法保存文件夹顺序');
  }

  return response.json();
}
