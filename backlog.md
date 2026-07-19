# Backlog

## 2026-07-19 — 2A 质量审查

### P2：并发 loader 存在旧请求覆盖新请求的竞态

- 位置：`client/src/hooks/useShelfData.js:34`
- 状态：已处理（2026-07-19）
- 场景：首次加载、关闭阅读器、目录重试或书籍不可用刷新发生重叠时，较旧请求可能在较新请求之后写回数据、错误及 loading 状态，造成旧结果覆盖新结果或提前清除 loading。
- 后续建议：为各资源增加请求代次或取消机制，只允许最新请求提交状态，并增加乱序完成测试。

### P2：关闭阅读器时刷新可能早于阅读进度持久化

- 位置：`client/src/components/reader/ReaderView.jsx:218`、`client/src/App.jsx:132`
- 状态：已处理（2026-07-19）
- 场景：`flushProgress()` 被 fire-and-forget 调用，而 App 随即刷新 recent/catalog；在 reduced-motion 或进度 PUT 较慢时，两个 GET 可能读取旧进度，之后也不会再次刷新。
- 后续建议：在进度写入 promise settle 后触发首页数据刷新，并以 deferred promise 测试调用顺序。

## 2026-07-19 — 2B 规范与质量审查

### P2：快捷视图默认排序测试未覆盖返回“全部”视图

- 位置：`client/src/hooks/useLibraryView.test.jsx:60`
- 状态：已处理（2026-07-19）
- 场景：现有“applies each view default”用例只验证 `recent-added → recent-added` 与 `folders → manual`，没有从其他视图切回 `all` 并断言 `manual`，因此计划要求的 `all → manual` 转换缺少回归保护。
- 后续建议：在原定向 hook 测试中加入从非 `all` 视图选择 `LIBRARY_VIEW.ALL` 的代表性断言。

### P2：搜索聚焦时切换标题排序缺少直接测试

- 位置：`client/src/hooks/useLibraryView.test.jsx:25`
- 状态：已处理（2026-07-19）
- 场景：现有测试覆盖搜索快照与恢复，但没有直接断言从 `manual` 或 `folders` 聚焦搜索时，显示排序切换为 `title`；该计划要求缺少回归保护。
- 后续建议：在原定向 hook 测试中加入一次 `focusSearch()` 后的 `sort === LIBRARY_SORT.TITLE` 代表性断言。

## 2026-07-19 — 2C 规范与质量审查

### P2：搜索组件的显示条件与错误禁用态缺少直接测试

- 位置：`client/src/components/bookshelf/LibrarySearchBar.test.jsx:31`
- 状态：已处理（2026-07-19）
- 场景：测试验证了 clear/cancel 的点击回调，却未断言它们在不匹配状态下隐藏；catalog error 分支也未直接断言 input 被禁用，相关验收条件可能在重构后悄然回归。
- 后续建议：在原定向测试中补充 clear/cancel 的反向显示断言，并在 error rerender 后断言 searchbox disabled。

### P2：工具栏 catalog 故障契约缺少组件级隔离测试

- 位置：`client/src/components/bookshelf/LibraryViewToolbar.test.jsx:22`
- 状态：已处理（2026-07-19）
- 场景：P1 修复已通过 `LibraryHome.test.jsx` 集成覆盖 catalog 不可用时“全部”保持可用、其他目录视图与排序禁用，但 `LibraryViewToolbar` 自身仍没有 `controlsDisabled=true` 的隔离测试，组件级契约在重构时缺少直接保护。
- 后续建议：在 toolbar 定向测试中断言“全部”enabled、“最近添加”“文件夹”和排序 select disabled。

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
- 状态：已处理（2026-07-19）
- 场景：`ReaderView` 通过 `[data-book-id] .book-cover` 定位关闭动画目标；只读搜索/派生视图卡片没有 `data-book-id`，从这些卡片打开书籍后会固定退化为 fallback 关闭动画。
- 后续建议：只为只读书籍卡片补充 `data-book-id`，并增加打开后关闭时能找到原卡片的集成验证。

### P2：继续阅读相对时间不会随页面停留更新

- 位置：`client/src/components/bookshelf/ContinueReadingSection.jsx:58`
- 状态：未处理
- 场景：相对时间只在 React 重新渲染时计算；页面长时间保持打开且无其他状态变化时，分钟/小时文案会持续陈旧。
- 后续建议：由区块级定时器或父组件传入周期更新的 `now`，并用假时钟覆盖跨分钟和跨小时边界。

## 2026-07-19 — 2A–2D 整体规格与质量审查

### P2：catalog 加载状态没有通过 live status 播报

- 位置：`client/src/components/bookshelf/LibrarySearchBar.jsx:23`、`client/src/components/bookshelf/LibraryHome.jsx:108`
- 状态：已处理（2026-07-19）
- 场景：首次加载 catalog 或用户点击目录重试时，搜索框只通过 disabled placeholder 显示“正在加载搜索目录”，现有 `aria-live` 节点没有对应文本。
- 后续建议：把 catalog loading 文本接入现有 live region，或为目录加载增加明确的 `role="status"`。

### P2：操作失败被误呈现为书架加载错误

- 位置：`client/src/components/bookshelf/LibraryHome.jsx:95`、`client/src/hooks/useShelfData.js:16`
- 状态：已处理（2026-07-19）
- 场景：上传部分失败、删除失败、创建/移入文件夹失败或保存顺序失败都写入共享 `error`；首页随后统一显示“重试加载书架”。
- 后续建议：拆分 shelf-load error 与 operation error，只有真正的书架读取失败显示书架重试按钮。

### P2：搜索输入框缺少可见键盘焦点

- 位置：`client/src/styles/bookshelf.css:160`
- 状态：已处理（2026-07-19）
- 场景：键盘 Tab 聚焦搜索输入框时，CSS 清除了原生 outline，搜索容器也没有 `:focus-visible` 或 `:focus-within` 替代样式。
- 后续建议：为输入框或搜索容器增加明确且不依赖颜色变化的焦点环，并补充键盘焦点验证。

### P2：浏览器规格检查可能漏报延迟请求或非 ARIA 拖动注册

- 位置：`client/scripts/verify-bookshelf-home.mjs:195`、`client/scripts/verify-bookshelf-home.mjs:235`
- 状态：已处理（2026-07-19）
- 场景：请求计数在本地 DOM 更新完成后立即关闭，可能漏掉 timer/debounce 后发出的 API 请求；拖动能力仅以 `aria-describedby` 数量作为代理，不能覆盖其他 listener 注册方式。
- 后续建议：把请求观察窗口保持到一次网络静默，并用实际指针/键盘拖动尝试或更直接的 DnD 注册证据验证只读状态。

### P2：430px 首屏断言没有要求完整三列书架

- 位置：`client/scripts/bookshelf-verification-assertions.mjs:22`
- 状态：已处理（2026-07-19）
- 场景：只要首行存在一项且位于首屏内，断言就把它视为“一整排”；布局退化为单列时仍可能通过。
- 后续建议：在 430px 场景明确要求首行至少三项及同排几何关系，并增加单列失败用例。

### P3：手动排序文案与规格不一致

- 位置：`client/src/utils/libraryView.js:188`
- 状态：已处理（2026-07-19）
- 场景：“全部”视图排序入口显示“手动排序”，而设计和计划统一使用“手动顺序”。
- 后续建议：将 label 统一为“手动顺序”，并更新对应展示断言。
