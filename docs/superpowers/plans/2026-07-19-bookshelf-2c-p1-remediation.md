# Bookshelf 2C P1 Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2C 审查确认的三个 P1，并将验证通过的 `codex/2c-components` fast-forward 合并到 `dev0718`。

**Architecture:** 修复保持在两个现有展示组件内：`ReadOnlyShelfItem` 增加可见文件夹上下文；`ContinueReadingSection` 通过纯函数规范化 SQLite UTC 时间，并用 `aria-describedby` 暴露元数据。服务端 API、CSS 和 backlog 中的 P2/P3 均不修改。

**Tech Stack:** React 19、Testing Library、Vitest 3、Git worktree

---

## Execution Guardrails

- 仅修复设计文档列出的三个 P1。
- 每个 P1 使用独立 RED/GREEN 循环；生产代码之前必须看到对应测试按预期失败。
- 不调用 `requesting-code-review`，不进行第二轮规范或质量审查。
- 不处理 `backlog.md` 中的 P2/P3。
- 定向验证失败时只修复当前 P1；同一 GREEN 验证连续失败两次则停止。
- 合并前和合并后各运行一次完整客户端测试。
- 任一验证或 fast-forward merge 阻塞时立即停止，不清理工作树或删除分支。

## File Map

- Modify：`backlog.md`，保存并提交已完成审查的 P2 记录。
- Modify：`client/src/components/bookshelf/ReadOnlyShelfItem.jsx`，显示文件夹上下文。
- Modify：`client/src/components/bookshelf/LibraryGrid.test.jsx`，验证上下文真实可见。
- Modify：`client/src/components/bookshelf/ContinueReadingSection.jsx`，规范化时间并关联 accessible description。
- Modify：`client/src/components/bookshelf/ContinueReadingSection.test.jsx`，验证 UTC 解析、机器可读时间和 accessible description。
- Reference：`docs/superpowers/specs/2026-07-19-bookshelf-2c-p1-remediation-design.md`。

## Task 1：提交已记录的 2C review backlog

**Files:**

- Modify：`backlog.md`

- [ ] **Step 1：确认只有 backlog 文档处于未提交状态**

```powershell
git status --short
git diff -- backlog.md
```

预期：仅 `backlog.md` 包含上一轮审查写入的六个 P2；没有组件或测试改动。

- [ ] **Step 2：单独提交 backlog**

```powershell
git add backlog.md
git commit -m "docs: record 2C review backlog"
```

预期：创建只包含 `backlog.md` 的文档提交。

## Task 2：显示文件夹内书籍的可见上下文

**Files:**

- Modify：`client/src/components/bookshelf/LibraryGrid.test.jsx`
- Modify：`client/src/components/bookshelf/ReadOnlyShelfItem.jsx`
- Test：`client/src/components/bookshelf/LibraryGrid.test.jsx`

- [ ] **Step 1：在现有 read-only 分支测试中加入可见文本断言**

将 `mounts sortable items only for editable mode` 的只读断言改为：

```jsx
const readOnlyBook = screen.getByRole('button', { name: '万历十五年，位于“历史”' });
expect(readOnlyBook).toBeInTheDocument();
expect(readOnlyBook).toHaveTextContent('位于“历史”');
```

- [ ] **Step 2：运行定向测试并确认 RED**

```powershell
npm --prefix client test -- LibraryGrid.test.jsx
```

预期：`toHaveTextContent('位于“历史”')` 失败；当前 button 的真实文本只有书名。

- [ ] **Step 3：增加最小可见上下文**

在 `ReadOnlyShelfItem` 的现有 `.shelf-item-label` 后增加：

```jsx
{item.type === 'book' && item.folderName ? (
  <span className="shelf-item-context">位于“{item.folderName}”</span>
) : null}
```

不修改 `aria-label`、click handler、封面或 DnD import。

- [ ] **Step 4：重新运行同一定向测试并确认 GREEN**

```powershell
npm --prefix client test -- LibraryGrid.test.jsx
```

预期：该文件 3 项测试全部通过。

## Task 3：向辅助技术暴露继续阅读元数据

**Files:**

- Modify：`client/src/components/bookshelf/ContinueReadingSection.test.jsx`
- Modify：`client/src/components/bookshelf/ContinueReadingSection.jsx`
- Test：`client/src/components/bookshelf/ContinueReadingSection.test.jsx`

- [ ] **Step 1：加入 accessible description 失败断言**

在 `shows progress and recent reading time in one clickable card` 中取得 button 后加入：

```jsx
expect(button).toHaveAccessibleDescription(/42%.*(?:前|月|最近阅读)/);
```

- [ ] **Step 2：运行定向测试并确认 RED**

```powershell
npm --prefix client test -- ContinueReadingSection.test.jsx
```

预期：button 没有 accessible description，新增断言失败。

- [ ] **Step 3：用 aria-describedby 关联现有元数据**

在文件顶部导入 `useId`：

```jsx
import { useId } from 'react';
```

在组件的提前返回之前创建稳定前缀：

```jsx
const descriptionIdPrefix = useId();
```

在每个 item render 中创建 id：

```jsx
const metaId = `${descriptionIdPrefix}-book-${book.id}-meta`;
```

将该 id 同时连接到 button 和现有 meta span：

```jsx
<button
  className="continue-book-button"
  key={book.id}
  type="button"
  data-book-id={book.id}
  onClick={(event) => {
    const rect = event.currentTarget.querySelector('.book-cover')?.getBoundingClientRect();
    onOpenBook(book, rect || null);
  }}
  aria-describedby={metaId}
  aria-label={`继续阅读《${book.title || '未命名书籍'}》`}
>
  <span className="book-cover continue-book-cover">
    <BookCover book={book} />
  </span>
  <span className="continue-card-content">
    <span className="continue-book-title">{book.title || '未命名书籍'}</span>
    <span className="continue-book-meta" id={metaId}>
      {progressPercent !== null ? <span>{progressPercent}%</span> : null}
      <time dateTime={item.progress?.updatedAt || undefined}>
        {formatRecentReadingTime(item.progress?.updatedAt)}
      </time>
    </span>
    {progressPercent !== null ? (
      <span className="continue-progress-track" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </span>
    ) : null}
  </span>
</button>
```

不得把百分比或时间拼入 `aria-label`。

- [ ] **Step 4：重新运行同一定向测试并确认 GREEN**

```powershell
npm --prefix client test -- ContinueReadingSection.test.jsx
```

预期：该文件现有 3 项测试全部通过，accessible description 同时包含进度和时间文本。

## Task 4：将 SQLite UTC 时间规范化为 ISO

**Files:**

- Modify：`client/src/components/bookshelf/ContinueReadingSection.test.jsx`
- Modify：`client/src/components/bookshelf/ContinueReadingSection.jsx`
- Test：`client/src/components/bookshelf/ContinueReadingSection.test.jsx`

- [ ] **Step 1：导入规范化函数并加入真实 API 格式测试**

将测试文件导入改为：

```jsx
import {
  ContinueReadingSection,
  formatRecentReadingTime,
  normalizeRecentReadingTimestamp,
} from './ContinueReadingSection.jsx';
```

新增测试：

```jsx
it('treats SQLite timestamps as UTC and exposes ISO datetime', () => {
  const updatedAt = '2026-07-18 01:30:00';
  const normalized = '2026-07-18T01:30:00Z';
  const now = Date.parse('2026-07-18T02:00:00.000Z');
  expect(normalizeRecentReadingTimestamp(updatedAt)).toBe(normalized);
  expect(normalizeRecentReadingTimestamp(item.progress.updatedAt)).toBe(item.progress.updatedAt);
  expect(formatRecentReadingTime(updatedAt, now)).toBe('30 分钟前');

  const sqliteItem = {
    ...item,
    progress: { ...item.progress, updatedAt },
  };
  render(
    <ContinueReadingSection items={[sqliteItem]} onOpenBook={vi.fn()} searchMode={false} />,
  );
  expect(screen.getByRole('button', { name: '继续阅读《活着》' }).querySelector('time'))
    .toHaveAttribute('dateTime', normalized);
});
```

- [ ] **Step 2：运行定向测试并确认 RED**

```powershell
npm --prefix client test -- ContinueReadingSection.test.jsx
```

预期：`normalizeRecentReadingTimestamp` 尚未导出，新增测试失败。

- [ ] **Step 3：实现纯规范化函数**

在 `formatRecentReadingTime` 之前增加：

```js
const sqliteUtcTimestampPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export function normalizeRecentReadingTimestamp(updatedAt) {
  const value = String(updatedAt ?? '');
  return sqliteUtcTimestampPattern.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
}
```

让 formatter 只解析规范化值：

```js
export function formatRecentReadingTime(updatedAt, now = Date.now()) {
  const normalizedUpdatedAt = normalizeRecentReadingTimestamp(updatedAt);
  const timestamp = Date.parse(normalizedUpdatedAt);
  if (!Number.isFinite(timestamp)) return '最近阅读';
  const elapsedMinutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (elapsedMinutes < 60) return `${Math.max(1, elapsedMinutes)} 分钟前`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} 小时前`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} 天前`;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}
```

在每个 item render 中复用同一值：

```jsx
const normalizedUpdatedAt = normalizeRecentReadingTimestamp(item.progress?.updatedAt);

<time dateTime={normalizedUpdatedAt || undefined}>
  {formatRecentReadingTime(normalizedUpdatedAt)}
</time>
```

- [ ] **Step 4：重新运行同一定向测试并确认 GREEN**

```powershell
npm --prefix client test -- ContinueReadingSection.test.jsx
```

预期：该文件 4 项测试全部通过；SQLite 文本按 UTC 得到 30 分钟，并输出 ISO `dateTime`。

## Task 5：完整验证并提交 remediation

**Files:**

- Modify：`client/src/components/bookshelf/ReadOnlyShelfItem.jsx`
- Modify：`client/src/components/bookshelf/LibraryGrid.test.jsx`
- Modify：`client/src/components/bookshelf/ContinueReadingSection.jsx`
- Modify：`client/src/components/bookshelf/ContinueReadingSection.test.jsx`

- [ ] **Step 1：运行完整客户端测试**

```powershell
npm --prefix client test
```

预期：160 项测试通过，0 项失败。

- [ ] **Step 2：确认实现范围**

```powershell
git status --short
git diff -- client/src/components/bookshelf/ReadOnlyShelfItem.jsx client/src/components/bookshelf/LibraryGrid.test.jsx client/src/components/bookshelf/ContinueReadingSection.jsx client/src/components/bookshelf/ContinueReadingSection.test.jsx
```

预期：只有上述四个 remediation 文件未提交；没有服务端、CSS 或其他组件改动。

- [ ] **Step 3：提交三个 P1 修复**

```powershell
git add client/src/components/bookshelf/ReadOnlyShelfItem.jsx client/src/components/bookshelf/LibraryGrid.test.jsx client/src/components/bookshelf/ContinueReadingSection.jsx client/src/components/bookshelf/ContinueReadingSection.test.jsx
git commit -m "fix: resolve 2C review blockers"
```

## Task 6：fast-forward 合并到 dev0718 并验证

**Files:**

- Merge source：`codex/2c-components`
- Merge target：`dev0718`

- [ ] **Step 1：确认 feature worktree 干净且分支关系正确**

```powershell
git status --short --branch
git merge-base HEAD dev0718
```

预期：feature worktree 干净；merge base 为 `26900956f27248e9afb83a8157949df4ea6c9f6a`。

- [ ] **Step 2：在主工作树 fast-forward 合并**

从 `G:\AI\codex\epub-reader` 运行：

```powershell
git branch --show-current
git merge --ff-only codex/2c-components
```

预期：当前分支为 `dev0718`；merge fast-forward 成功，原有未跟踪 2A–2D 计划文件保持不变。

- [ ] **Step 3：在合并结果上运行完整客户端测试**

```powershell
npm --prefix client test
```

预期：160 项测试通过，0 项失败。

- [ ] **Step 4：确认合并结果并安全清理工作树**

```powershell
git status --short --branch
Resolve-Path -LiteralPath '.worktrees/2c-components'
git worktree remove 'G:/AI/codex/epub-reader/.worktrees/2c-components'
git worktree prune
git branch -d codex/2c-components
```

仅当 resolved path 为 `G:\AI\codex\epub-reader\.worktrees\2c-components`、合并成功且合并后测试通过时执行 remove/delete。预期：`dev0718` 指向 remediation HEAD，工作树和已合并分支被清理；原有未跟踪计划文件仍保留。
