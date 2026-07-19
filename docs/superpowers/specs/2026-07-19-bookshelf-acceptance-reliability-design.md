# Bookshelf Acceptance Reliability Design

## Status

Approved in conversation on 2026-07-19 as part of the backlog remediation suite.

## Goal

补上搜索框键盘焦点可见性，并收紧书架浏览器规格检查，防止单列首屏、延迟 API 请求或只读结果实际可拖时产生假通过。

## Constraints

- 不重新设计书架布局、颜色系统、搜索行为或 DnD 实现。
- 焦点样式复用现有 accent 色和圆角语言。
- 浏览器脚本继续只使用本地 fixture，不写入用户数据。
- 保留现有 430×932、320px、1200px 与 350 本代表场景，不增加 viewport 或性能循环。

## Root Causes

1. `.library-search-input` 清除原生 outline，但没有替代 focus ring。
2. `inspectBookshelfLayout` 只要求 `firstShelfRow.length > 0`，单列也被当作“一整排”。
3. 搜索请求计数在 DOM 更新完成后立即停止，可能漏掉 timer/debounce 请求。
4. 只读 DnD 只以 `aria-describedby` 数量做代理，不能证明 pointer drag 不会激活。

## Chosen Design

### Focus visibility

为 `.library-search-control:focus-within` 增加与现有 inset border 并存的 accent focus ring。input、clear 或 cancel 获得键盘焦点时容器都有清晰轮廓；不改变尺寸和布局。浏览器规格采集未聚焦与聚焦后的 computed box-shadow，要求两者不同且聚焦值包含额外外环。

### Complete first row

430×932 的 `firstRowFits` 同时要求：

- `firstShelfRow.length >= 3`
- 每项 top 属于同一首行采集结果
- 每项完整位于 viewport 内

采集逻辑继续只选择与第一项 top 相同的元素；断言模块新增单项首行失败测试。

### Delayed request observation

搜索 DOM 更新后保持 API request 计数开启，等待固定 500ms 观察窗口，再等待 Playwright `networkidle`，之后才停止计数并构造 snapshot。这样覆盖常见 debounce/timer 请求，同时不引入循环压测或不确定的长期监听。

### Real read-only drag probe

浏览器脚本对一个 `.read-only-shelf-item` 执行真实 pointer down/move，临时在 capture 阶段抑制 click 以避免打开 reader，并检查：

- 该项未出现 `.is-dragging`
- drag preview 未出现可见内容
- delete drop zone 未激活

随后 pointer up 并移除临时 click handler。纯断言 snapshot 用 `readOnlyDragActivated: false` 替换 `dragHandleCount === 0`；JSON 输出同步使用新字段。

## Testing Strategy

1. `bookshelf-verification-assertions.test.js` 先加入只有一项首行应失败、三项应通过，以及 `readOnlyDragActivated=true` 应失败的 RED 用例。
2. 修改纯断言模块并确认同一定向测试 GREEN。
3. 更新 CSS 与浏览器采集脚本，构建客户端。
4. 只运行一次 `verify:bookshelf-home`，确认 focus、三列、延迟请求和真实 drag probe 均通过。

## Parallelization Boundary

本批次只修改 bookshelf CSS 和验证脚本，可与 loader request ownership 及 reader progress 两个批次并行。它不修改 `useShelfData`、`App` 或 reader。

## Success Criteria

- 搜索控件获得焦点时存在可见 focus ring。
- 430×932 少于三项同排时规格检查失败。
- DOM 更新后的延迟 API 请求仍会被计数并导致失败。
- 只读结果只有在真实 pointer drag 未激活时才通过。
- 既有 viewport、100ms、folder context 与 read-only 数量检查保持不变。

## Out of Scope

- 视觉重做、额外断点、WebKit 自动化、截图 diff 或真机结论。
- 修改生产搜索网络策略或 DnD 注册实现。
- 其他测试覆盖 backlog、reader 动画与错误状态模型。

## Backlog Reconciliation

四个实现批次全部合并并验证后，由主执行方一次性更新 `backlog.md`：标记本轮六项已处理，并把旧的 toolbar `controlsDisabled` 测试建议改为当前契约——“全部”可用，其他目录视图与排序禁用。并行实现分支不各自编辑 backlog，避免冲突。
