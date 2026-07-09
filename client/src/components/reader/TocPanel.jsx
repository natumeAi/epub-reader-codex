export function TocPanel({ currentHref, onSelect, toc }) {
  return (
    <div className="reader-panel reader-panel-toc" role="dialog" aria-label="章节目录">
      <div className="reader-panel-handle" aria-hidden="true" />
      <h2 className="reader-panel-title">目录</h2>
      <ul className="reader-toc-list">
        {toc.length === 0 && <li className="reader-toc-empty">无目录信息</li>}
        {toc.map((item) => (
          <TocItem
            key={item.href || item.id || item.label}
            item={item}
            currentHref={currentHref}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function TocItem({ item, currentHref, onSelect }) {
  const href = item.href || '';
  const active = currentHref && href && currentHref.split('#')[0] === href.split('#')[0];

  return (
    <li>
      <button
        type="button"
        className={`reader-toc-entry${active ? ' is-current' : ''}`}
        onClick={() => onSelect(href)}
      >
        {item.label?.trim() || '未命名章节'}
      </button>
      {Array.isArray(item.subitems) && item.subitems.length > 0 && (
        <ul className="reader-toc-sublist">
          {item.subitems.map((sub) => (
            <li key={sub.href || sub.id || sub.label}>
              <button
                type="button"
                className="reader-toc-entry reader-toc-subentry"
                onClick={() => onSelect(sub.href || '')}
              >
                {sub.label?.trim() || '未命名章节'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
