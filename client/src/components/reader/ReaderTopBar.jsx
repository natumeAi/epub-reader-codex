export function ReaderTopBar({ onClose, progress, title }) {
  const progressPercent = Math.round(progress * 100);

  return (
    <header className="reader-header">
      <button
        className="reader-close-button"
        type="button"
        aria-label="返回书架"
        onClick={onClose}
      >
        <span aria-hidden="true" />
      </button>
      <span className="reader-title">{title || ''}</span>
      <span className="reader-progress-label" aria-label={`进度 ${progressPercent}%`}>
        {progress > 0 ? `${progressPercent}%` : ''}
      </span>
    </header>
  );
}
