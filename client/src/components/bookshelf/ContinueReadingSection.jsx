import { BookCover } from './BookCover.jsx';

export function ContinueReadingSection({ items, onOpenBook }) {
  if (!items.length) {
    return null;
  }

  return (
    <section className="continue-reading" aria-labelledby="continue-reading-title">
      <div className="continue-reading-header">
        <h2 id="continue-reading-title">继续阅读</h2>
      </div>
      <div className="continue-reading-list">
        {items.map((item) => {
          const book = item.book;
          const progressValue = Number(item.progress?.progress);
          const hasProgressValue = Number.isFinite(progressValue);
          const progressPercent = hasProgressValue
            ? Math.max(0, Math.min(100, Math.round(progressValue * 100)))
            : null;

          return (
            <button
              className="continue-book-button"
              key={book.id}
              type="button"
              data-book-id={book.id}
              onClick={(event) => {
                const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
                onOpenBook(book, rect || null);
              }}
              aria-label={`继续阅读《${book.title || '未命名书籍'}》`}
            >
              <span className="book-cover continue-book-cover">
                <BookCover book={book} />
              </span>
              <span className="continue-book-title">{book.title || '未命名书籍'}</span>
              {progressPercent !== null ? (
                <span className="continue-book-progress">{progressPercent}%</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
