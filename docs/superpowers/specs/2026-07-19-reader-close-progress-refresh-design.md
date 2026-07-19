# Reader Close Progress Refresh Design

## Status

Approved in conversation on 2026-07-19 as part of the backlog remediation suite.

## Goal

关闭 reader 时保持现有关闭动画和即时 UI 响应，同时保证首页 recent/catalog 刷新只在本次进度 flush settle 后触发。

## Constraints

- 不让 reader 关闭动画等待网络请求。
- 保留 `flushProgress({ keepalive: true })`、outbox 与失败后重试语义。
- 不修改进度 API、数据库或 reader 翻页行为。
- flush 成功或失败后都允许刷新；网络失败时 pending outbox 仍由现有机制后续重试。

## Root Cause

`ReaderView.handleCloseClick` fire-and-forget 调用 `flushProgress`，随后按 reduced-motion 或关闭动画调用 `onClose`。`App.handleCloseReader` 在关闭 session 后立即请求 recent/catalog，所以两个 GET 可能早于进度 PUT 完成并把旧进度写回首页。

## Chosen Design

把 UI 关闭与数据刷新拆成两个明确 callback：

- `onClose` 只负责按现有时机关闭 reader session。
- 新增可选 `onProgressSettled`，只在关闭触发的 progress flush promise fulfilled 或 rejected 后调用一次。

`ReaderView` 在第一次关闭动作中保存 `flushProgress({ keepalive: true })` 的返回 promise，并通过 `Promise.resolve(...).then(onProgressSettled, onProgressSettled)` 安排 settle callback。现有 reduced-motion、目标封面动画、fallback 动画和 `onClose` 时机不变；重复关闭继续由 `isClosingRef` 阻止。

`App` 将现有 recent/catalog refresh 从 `handleCloseReader` 移到 `handleReaderProgressSettled`：

- `onClose={closeReader}` 立即更新 reader session。
- `onProgressSettled={handleReaderProgressSettled}` 执行 `Promise.all([loadRecentReading(), loadCatalog()])`。

这样 UI 不依赖网络完成，而刷新与写入具有明确 happens-after 关系。

## Error Handling

settle callback 在 fulfilled 与 rejected 两条路径都会执行，避免保存失败时永久不刷新。`useReadingProgressPersistence` 继续拥有永久/暂时失败、outbox 清理与重试策略；本改动不显示新的错误 UI，也不吞掉该 hook 之外的错误。

## Testing Strategy

在 `ReaderView.test.jsx` 使用 deferred flush promise：

1. 点击关闭后断言 keepalive flush 已发起且 `onClose` 保持当前即时行为。
2. promise 未 settle 前，`onProgressSettled` 未调用。
3. resolve 后只调用一次；另以 rejection 代表路径证明失败也触发一次。

在现有 App 相关定向测试边界验证 recent/catalog refresh 只由 `onProgressSettled` callback 触发；如果 App 没有现成可控测试入口，则以最小组件集成测试覆盖 ReaderView callback wiring，不创建通用流程抽象。

## Success Criteria

- 关闭 reader 不等待网络且动画行为不变。
- recent/catalog 刷新不会早于关闭时 progress flush settle。
- flush rejection 不阻止刷新，也不产生未处理 rejection。
- 一次关闭最多触发一次 settle callback 与一次首页刷新。

## Out of Scope

- 更改进度保存格式、重试策略、keepalive 实现或 reader 动画。
- 等待服务端最终一致性之外的额外轮询。
- loader 竞态与首页错误状态拆分。
