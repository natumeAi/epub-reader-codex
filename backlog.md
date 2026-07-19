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
