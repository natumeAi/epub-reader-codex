export async function listBooks() {
  const response = await fetch('/api/books');

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
