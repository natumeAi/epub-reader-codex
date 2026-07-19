# Backlog

## 2026-07-19 — 2A 质量审查

### P2：并发 loader 存在旧请求覆盖新请求的竞态

- 位置：`client/src/hooks/useShelfData.js:34`
- 状态：未处理
- 场景：首次加载、关闭阅读器、目录重试或书籍不可用刷新发生重叠时，较旧请求可能在较新请求之后写回数据、错误及 loading 状态，造成旧结果覆盖新结果或提前清除 loading。
- 后续建议：为各资源增加请求代次或取消机制，只允许最新请求提交状态，并增加乱序完成测试。

### P2：关闭阅读器时刷新可能早于阅读进度持久化

- 位置：`client/src/components/reader/ReaderView.jsx:218`、`client/src/App.jsx:132`
- 状态：未处理
- 场景：`flushProgress()` 被 fire-and-forget 调用，而 App 随即刷新 recent/catalog；在 reduced-motion 或进度 PUT 较慢时，两个 GET 可能读取旧进度，之后也不会再次刷新。
- 后续建议：在进度写入 promise settle 后触发首页数据刷新，并以 deferred promise 测试调用顺序。

## 2026-07-19 — 2B 规范与质量审查

### P2：快捷视图默认排序测试未覆盖返回“全部”视图

- 位置：`client/src/hooks/useLibraryView.test.jsx:60`
- 状态：未处理
- 场景：现有“applies each view default”用例只验证 `recent-added → recent-added` 与 `folders → manual`，没有从其他视图切回 `all` 并断言 `manual`，因此计划要求的 `all → manual` 转换缺少回归保护。
- 后续建议：在原定向 hook 测试中加入从非 `all` 视图选择 `LIBRARY_VIEW.ALL` 的代表性断言。

### P2：搜索聚焦时切换标题排序缺少直接测试

- 位置：`client/src/hooks/useLibraryView.test.jsx:25`
- 状态：未处理
- 场景：现有测试覆盖搜索快照与恢复，但没有直接断言从 `manual` 或 `folders` 聚焦搜索时，显示排序切换为 `title`；该计划要求缺少回归保护。
- 后续建议：在原定向 hook 测试中加入一次 `focusSearch()` 后的 `sort === LIBRARY_SORT.TITLE` 代表性断言。
