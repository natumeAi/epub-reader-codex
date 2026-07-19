# Bookshelf 2C P1 Remediation Design

## Status

Approved in conversation on 2026-07-19.

## Goal

修复 2C 审查确认的三个 P1：让文件夹内书籍的所属文件夹在只读卡片上可见；正确解释 `/api/reading/recent` 返回的 SQLite UTC 时间；让继续阅读卡片的进度和最近阅读时间可由辅助技术获取。

## Constraints

- 修复限定在 2C 前端组件及其现有定向测试中。
- 不修改服务端 API 或数据库时间戳契约。
- 不处理 `backlog.md` 中记录的 P2/P3。
- 不进行额外功能设计、CSS 重构或重复代码审查。
- 保留现有打开书籍、文件夹、搜索和排序行为。

## Root Causes

### Folder context is not visible

`ReadOnlyShelfItem` 已计算包含 `folderName` 的 accessible label，但可见的 `.shelf-item-label` 只渲染书名。因此辅助技术能获得上下文，而视觉用户无法区分文件夹内的同名书籍。

### SQLite UTC timestamps are parsed as local time

`reading_progress.updated_at` 由 SQLite `CURRENT_TIMESTAMP` 写入，真实格式为 `YYYY-MM-DD HH:mm:ss`，语义为 UTC。API 原样返回该文本；`Date.parse` 对无时区的空格格式按本地时间或实现相关规则解释，在香港时区会产生约八小时偏差。

### Continue-reading metadata is hidden from assistive technology

继续阅读按钮的固定 `aria-label` 覆盖了按钮子文本的 accessible name。可见的进度和最近阅读时间没有通过 accessible description 或独立语义关联暴露。

## Chosen Design

### Visible folder context

`ReadOnlyShelfItem` 保持当前书名和 accessible label，并仅在 `item.type === 'book' && item.folderName` 时增加独立可见文本：

```jsx
<span className="shelf-item-context">位于“{item.folderName}”</span>
```

该文本位于同一 button 内，不改变 click callback、封面或 DnD 边界。根层书籍和文件夹不渲染该元素。

### Frontend timestamp normalization

在 `ContinueReadingSection.jsx` 中增加纯函数 `normalizeRecentReadingTimestamp(updatedAt)`：

- 空值返回空字符串。
- 已带 `T`、`Z` 或显式 offset 的标准 ISO 字符串保持不变。
- 精确匹配 `YYYY-MM-DD HH:mm:ss` 或带小数秒的 SQLite UTC 文本时，将空格替换为 `T` 并追加 `Z`。
- 其他无法识别的值保持原样，由现有无效日期分支返回“最近阅读”。

`formatRecentReadingTime` 只解析规范化后的值；`<time dateTime>` 也使用同一规范化字符串，保证显示计算与机器可读值一致。

### Accessible description for metadata

`ContinueReadingSection` 使用一次 `useId()` 生成区块内前缀，并为每项 `.continue-book-meta` 生成唯一 id。button 保留现有 accessible name：

```jsx
aria-label={`继续阅读《${title}》`}
aria-describedby={metaId}
```

进度存在时，accessible description 包含百分比和最近时间；进度缺失时只包含最近时间。视觉结构和单一点击目标不变。

## Testing Strategy

按独立 RED/GREEN 循环处理三个根因：

1. 在 `LibraryGrid.test.jsx` 断言只读书籍 button 的真实文本包含 `位于“历史”`，先确认现有实现失败，再增加可见上下文并运行同一定向测试。
2. 在 `ContinueReadingSection.test.jsx` 断言 button 的 accessible description 包含进度和最近时间，先确认失败，再加入 `aria-describedby` 关联并运行同一定向测试。
3. 在同一测试文件覆盖 SQLite UTC 文本到 ISO `Z` 文本的规范化，并断言 `<time dateTime>` 使用规范化值；先确认失败，再实现纯函数并运行同一定向测试。

实现完成后运行完整客户端测试。合并到 `dev0718` 后再次运行相同完整客户端测试，确认合并结果。

## Commit and Merge

- 现有 2C review backlog 作为独立文档提交保留。
- 三个 P1 的测试与实现作为一个 remediation commit 提交。
- 通过验证后将 `codex/2c-components` fast-forward 合并到 `dev0718`。
- 合并验证通过后移除 2C 工作树并删除已合并分支。

## Success Criteria

- 文件夹内只读书籍同时具有可见文件夹上下文和现有 accessible label。
- SQLite UTC 时间在任意本地时区均按 UTC 计算，标准 ISO 输入行为不变。
- 继续阅读按钮的 accessible name 保持稳定，进度和最近时间成为 accessible description。
- 两个定向测试文件和完整客户端测试通过。
- 服务端、CSS、P2/P3 和其他 2C 行为未改变。
