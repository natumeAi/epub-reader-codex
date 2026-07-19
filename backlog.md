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

## 2026-07-19 — 2C 规范与质量审查

### P2：搜索组件的显示条件与错误禁用态缺少直接测试

- 位置：`client/src/components/bookshelf/LibrarySearchBar.test.jsx:31`
- 状态：未处理
- 场景：测试验证了 clear/cancel 的点击回调，却未断言它们在不匹配状态下隐藏；catalog error 分支也未直接断言 input 被禁用，相关验收条件可能在重构后悄然回归。
- 后续建议：在原定向测试中补充 clear/cancel 的反向显示断言，并在 error rerender 后断言 searchbox disabled。

### P2：工具栏 controlsDisabled 契约缺少测试

- 位置：`client/src/components/bookshelf/LibraryViewToolbar.test.jsx:22`
- 状态：未处理
- 场景：现有测试始终传入 `controlsDisabled=false`，未验证 catalog 不可用时三个视图按钮和排序 select 会同时禁用。
- 后续建议：在原定向测试中加入 `controlsDisabled=true` 的代表状态，断言所有视图按钮与排序入口均 disabled。

### P2：LibraryGrid 的非拖动边界与有限状态覆盖不完整

- 位置：`client/src/components/bookshelf/LibraryGrid.test.jsx:36`、`client/src/components/bookshelf/LibraryGrid.test.jsx:56`
- 状态：未处理
- 场景：测试名称声明验证只读项没有 drag props，但没有直接检查 draggable/listener/sortable 属性；同时未覆盖首次 skeleton、空书架导入回调及文件夹预览图片的异步解码提示。
- 后续建议：在原定向测试中增加只读按钮属性、6 个 skeleton、`onImport` 调用和文件夹预览图 `decoding="async"` 的代表性断言。

### P2：继续阅读的有限时间档位与缺失进度分支缺少测试

- 位置：`client/src/components/bookshelf/ContinueReadingSection.test.jsx:27`
- 状态：未处理
- 场景：现有测试只覆盖分钟和天，没有覆盖小时、七天以上日期、无效时间，以及缺失进度时不渲染百分比和进度轨的要求。
- 后续建议：在原定向测试中补充上述四类代表输入，保持格式化函数的有限档位边界可回归。

### P2：只读书籍卡片缺少 reader 关闭动画定位属性

- 位置：`client/src/components/bookshelf/ReadOnlyShelfItem.jsx:26`
- 状态：未处理
- 场景：`ReaderView` 通过 `[data-book-id] .book-cover` 定位关闭动画目标；只读搜索/派生视图卡片没有 `data-book-id`，从这些卡片打开书籍后会固定退化为 fallback 关闭动画。
- 后续建议：只为只读书籍卡片补充 `data-book-id`，并增加打开后关闭时能找到原卡片的集成验证。

### P2：继续阅读相对时间不会随页面停留更新

- 位置：`client/src/components/bookshelf/ContinueReadingSection.jsx:58`
- 状态：未处理
- 场景：相对时间只在 React 重新渲染时计算；页面长时间保持打开且无其他状态变化时，分钟/小时文案会持续陈旧。
- 后续建议：由区块级定时器或父组件传入周期更新的 `now`，并用假时钟覆盖跨分钟和跨小时边界。
