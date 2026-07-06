import { useEffect, useRef, useState } from 'react';
import { listBooks, uploadBook } from './api/books.js';

function BookCover({ book }) {
  if (book.coverUrl) {
    return (
      <img
        className="book-cover-image"
        src={book.coverUrl}
        alt={book.title || '书籍封面'}
        loading="lazy"
      />
    );
  }

  return (
    <div className="book-cover-placeholder">
      <span>{book.title || '未命名书籍'}</span>
    </div>
  );
}

function App() {
  const fileInputRef = useRef(null);
  const [books, setBooks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');

  async function loadShelf() {
    setIsLoading(true);
    setError('');

    try {
      const data = await listBooks();
      setBooks(data.books || []);
    } catch (err) {
      setError(err.message || '无法加载书架');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadShelf();
  }, []);

  async function handleFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setIsUploading(true);
    setError('');

    try {
      await uploadBook(file);
      await loadShelf();
    } catch (err) {
      setError(err.message || '上传失败');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  }

  return (
    <main className="app-shell" aria-label="EPUB Reader">
      <section className="library-home">
        <div className="library-header">
          <div>
            <p className="eyebrow">Library</p>
            <h1>我的书架</h1>
          </div>

          <button
            className="upload-button"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            aria-label="上传 EPUB"
          >
            <span aria-hidden="true">+</span>
          </button>
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept=".epub,application/epub+zip"
            onChange={handleFileChange}
          />
        </div>

        {error ? (
          <p className="status-message error-message" role="alert">
            {error}
          </p>
        ) : null}

        {isUploading ? (
          <p className="status-message" role="status">
            正在上传
          </p>
        ) : null}

        {isLoading ? (
          <div className="shelf-grid" aria-label="书架加载中">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="book-shell" key={index}>
                <div className="book-cover skeleton-cover" />
              </div>
            ))}
          </div>
        ) : books.length ? (
          <div className="shelf-grid" aria-label="书籍列表">
            {books.map((book) => (
              <button
                className="book-shell"
                type="button"
                key={book.id}
                aria-label={book.title || '未命名书籍'}
              >
                <span className="book-cover">
                  <BookCover book={book} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state" role="status">
            <div className="empty-cover" aria-hidden="true" />
            <p>书架是空的</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
