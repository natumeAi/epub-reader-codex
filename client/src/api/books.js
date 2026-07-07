export async function listBooks() {
  const response = await fetch('/api/books');

  if (!response.ok) {
    throw new Error('无法加载书架');
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
