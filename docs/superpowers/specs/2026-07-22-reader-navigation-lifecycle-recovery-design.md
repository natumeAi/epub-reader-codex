# Reader Navigation and Lifecycle Recovery Design

## Goal

在保持 `DEFAULT_PAGE_TURN_BACKEND = 'compositor'` 的前提下，修复以下两个移动端问题：

1. 安装态 PWA 在阅读器中切到桌面再返回时可能只显示空白且无法操作。
2. 阅读器中的系统返回键或边缘返回手势会退出 PWA，而不是逐层返回“面板 → 阅读器 → 书架”。

本文中的“书架层”包含当前仍挂载的书架与文件夹界面；从文件夹内打开书籍时，退出阅读器后仍恢复原来的文件夹界面。

## Constraints

- `compositor` 继续作为能力满足时的默认翻页后端。
- 永久保留现有 compositor → scroll → basic 能力降级路径。
- 不引入 React Router，不增加新的 URL 路由，不注册 Service Worker。
- 不改变 EPUB、阅读进度和阅读设置的服务端数据结构。
- 不把文件夹、搜索或书架筛选纳入浏览器历史；本次历史层级只覆盖阅读器和阅读器面板。
- 不以每次前台恢复都重建 EPUB 作为正常路径；只有健康检查或刷新失败时才重建。

## Root Causes Addressed

### Navigation

打开书籍当前只更新 React state 和 localStorage，没有创建 session-history entry。Standalone PWA 从根页面启动后，系统返回到达历史栈底便退出应用。目录和设置面板同样只是 ReaderView 的本地 state，不参与 History。

### Lifecycle Recovery

现有恢复逻辑只用 `container.querySelector('iframe')` 判断健康。移动浏览器可能保留 iframe DOM 壳和 epub.js view 对象，却已经丢失内容文档、绘制表面或有效几何。此时 epub.js 对同尺寸 `resize()` 和同章节 `display()` 可以直接返回而不重建 iframe。

恢复进入 loading 或 error 后，状态层又会被后绘制且不透明的 EPUB 容器遮住；输入控制器同时被禁用，最终表现为无提示的不可操作空白页。

## Chosen Architecture

采用两个彼此独立的小边界：

1. 轻量 History 协调器：只把现有 UI 层级映射到 `history.state`，不改变 URL，也不引入路由库。
2. rendition 健康检查与恢复状态机：先执行便宜刷新并复检，失败时才从当前 CFI 重建 epub.js 实例。

二者只通过 ReaderView 的关闭流程相交：History 请求退出阅读器时，ReaderView 仍负责取消翻页、保存进度并卸载 rendition。

## History Model

### State Shape

应用拥有的 history state 使用版本化标记，避免误解释外部页面或将来的其他状态：

```js
{
  app: 'epub-reader',
  version: 1,
  layer: 'library' | 'reader' | 'panel',
  bookId: number | null,
  panel: 'toc' | 'settings' | null,
}
```

URL 始终保持当前应用 URL；只使用 `pushState`、`replaceState` 和 `popstate`。

### Layer Transitions

```text
library
  -> open book: push reader(bookId)
reader
  -> open toc/settings: push panel(bookId, panel)
panel
  -> switch toc <-> settings: replace current panel entry
panel
  -> system Back / close panel: pop to reader
reader
  -> system Back / top-bar close: pop to library
library
  -> another system Back: browser/PWA default behavior, including leaving the app
```

设置中的字体二级页仍属于同一个 `settings` panel entry。系统返回关闭整个设置面板，不再为字体页增加第三层历史。

### Bootstrap and Cold Restore

- 首次进入应用且当前 entry 不是本应用 state 时，用 `replaceState` 将当前 entry 标记为 `library`，保留它之前的浏览器历史。
- 普通打开书籍时，从 `library` push 一个 `reader` entry，再挂载 ReaderView。
- localStorage 冷启动恢复书籍时同样确保 `library` 基线存在，再 push `reader` entry。
- 页面 reload 后若当前 entry 已是相同 bookId 的 `reader` 或 `panel`，不得重复 push。
- state 指向不存在的书籍时，规范化为 `library` 并清理失效的 active-book 记录。

### State Ownership and Close Semantics

- 新的导航协调 hook 在 App 根层调用，并作为 History 的唯一写入者。
- 协调器返回当前 `layer`、`bookId` 和 `panel`；App 根据 `layer` 协调 readingBook，ReaderView 通过 props 消费受控 panel。
- `useReaderSession` 通过注入的导航回调，在普通打开和冷恢复设置 readingBook 前确保 reader entry；删除当前书籍或判定书籍不存在时把 entry 规范化为 library。
- ReaderView 的 `activePanel` 改为由协调器驱动；设置内部的 `settingsView` 仍保留在 ReaderView。
- 面板按钮、遮罩关闭和系统 Back 都调用同一个“关闭面板”入口。
- 顶部返回按钮先执行现有关闭动画和进度 flush，再请求回退到 `library` entry。
- 系统 Back 到 `library` 时不播放第二次关闭动画，但必须取消活动翻页、使用 keepalive flush 最新进度，然后卸载 ReaderView。
- `popstate` 处理必须幂等；重复事件或快速手势不得重复清除会话、重复 push 或形成返回陷阱。
- 不调用 `history.forward()` 阻止用户离开书架。
- panel Back 后、ReaderView 仍挂载期间使用 Forward 可以恢复该 panel；reader 已卸载且 active-book 已清除后再 Forward 到旧 reader/panel entry 时，用 `replaceState` 规范化为 library，不隐式重新打开书籍。

## Rendition Health Contract

健康检查放在单独的纯函数边界，输入 DOM/rendition 引用并返回 `{ healthy, reason }`。健康状态至少要求：

- container、rendition、manager 和 rendition ref 指向当前实例；
- container 已连接且拥有正的可见宽高；
- 至少存在一个已连接、正宽高的 displayed `.epub-view`；
- displayed view 的 iframe 已连接且正宽高；
- epub.js contents/document 的 documentElement 与 body 已创建；访问内容文档时的异常转换成不健康结果，不向外抛出；
- 当前实例没有遗留的活动 page-turn session、WAAPI Animation 或业务临时 transform；恢复入口会先调用 adapter cancel，再执行此项检查。

检查不依赖正文文本长度，因为合法 EPUB 页面可能只有图片或空白章节。

## Foreground Recovery State Machine

状态机使用单实例 generation/ref 防止 `pageshow` 和 `visibilitychange` 同时触发重复恢复：

```text
ready
  -> hidden/pagehide:
       save current CFI
       cancel page-turn session and temporary compositor styles
       flush settings/progress

visible/pageshow
  -> mark one recovery pending
  -> cancel adapter again (idempotent)
  -> preflight health check
       healthy:
         rendition.resize()
         display(current CFI) with bounded timeout
         wait for paint boundary
         postflight health check
           healthy -> ready
           unhealthy/rejected/timed out -> rebuild
       unhealthy -> rebuild

rebuild
  -> preserve in-memory current CFI ahead of server progress
  -> destroy adapter, rendition and book exactly once
  -> fetch and construct a new epub.js book/rendition
  -> display preserved CFI
  -> postflight health check
       healthy -> ready
       failed -> recoverable error UI
```

### Loading and Concurrent Events

- 如果应用在初次打开 EPUB 时进入后台，visible 事件只设置 pending flag，不启动第二次初始化。
- 当前初始化完成后若 pending flag 仍在，立即执行一次 postflight 检查。
- 初始化、便宜刷新和重建均使用 generation 校验，旧 promise 不得覆盖新实例状态。
- fetch、初次 display、前台 refresh display 都必须有 AbortSignal 或有界 timeout；超时按恢复失败处理，不能永久停留在 loading。
- 默认 timeout 固定为：EPUB fetch/arrayBuffer 30 秒、初次或重建 display 10 秒、前台便宜 refresh 2 秒；测试通过依赖注入使用更短时间，不修改生产默认值。
- 自动恢复每次前台周期最多触发一次完整重建，避免网络失败造成重建循环。
- 用户点击“重试”开启新的前台恢复周期并重置一次自动重建预算。

### CFI Preservation

- `currentCfiRef` 是温恢复的首选位置。
- 开始重建前复制到独立的 resume-CFI ref，旧 rendition cleanup 不得清除该副本。
- 重建时优先使用 resume CFI；只有它不存在时才使用服务端保存进度。
- 成功 relocated 后清除一次性 resume CFI，并继续走现有进度持久化。

## Recovery UI

- loading、recovering 和 error 层必须绘制在不透明 EPUB container 与手势层之上。
- loading/recovering 显示明确文案和“返回书架”；不得只显示被遮盖的 spinner。
- 可恢复错误显示“重试”和“返回书架”。重试只递增一次 reload generation，并保留当前 CFI。
- 书籍 404 继续显示“书籍不存在”，通知书架刷新，并允许返回书架；不得无限重试。
- 状态层接管指针事件，但关闭/重试按钮保持可操作。
- ready 后状态层卸载，现有手势、目录、设置和页码行为不变。

## Compositor Requirements

- `DEFAULT_PAGE_TURN_BACKEND` 保持 `compositor`。
- hidden、pagehide、resize、orientationchange、设置重排和显式关闭都必须取消当前 compositor session。
- cancel 后恢复 `.epub-view`、scroller 和 page-edge 的原始 transform/will-change，并取消未完成的 WAAPI Animation 与 commit rAF。
- 前台健康检查在 adapter cancel 完成后执行；健康检查不得因为 compositor 可用而降级到 scroll。
- 只有现有能力检测或运行时失败才沿用 compositor → scroll → basic 降级。
- 当前 main 中因只切换默认常量而失配的 adapter 单测必须同步到 compositor-default 语义；scroll 专项测试使用显式 forced-scroll 配置。

## Components and File Responsibilities

计划中的文件边界如下，具体行号在实施计划中确定：

- `client/src/utils/readerNavigation.js`
  - history state 校验、构造、基线规范化和纯 transition helper。
- `client/src/hooks/useReaderNavigation.js`
  - 在 App 根层监听 popstate，暴露当前层级以及打开阅读器、打开/切换/关闭面板、返回书架和规范化失效 entry 的动作。
- `client/src/utils/renditionHealth.js`
  - 无 React 依赖的 rendition/iframe/view 健康检查。
- `client/src/hooks/useReaderSession.js`
  - 通过注入的导航回调将书籍业务会话与 navigation entry 对齐，处理冷恢复和失效 bookId。
- `client/src/hooks/useReadingProgressPersistence.js`
  - ReaderView 因系统 Back 卸载时，以 keepalive flush outbox 中的最新进度。
- `client/src/components/reader/ReaderView.jsx`
  - 消费受控 panel state，统一显式关闭和 History 关闭，渲染恢复状态动作。
- `client/src/hooks/useEpubRendition.js`
  - 实现单飞恢复、timeout、resume CFI 与按需重建。
- `client/src/styles/reader.css`
  - 保证恢复 UI 的 stacking 和交互可达性。
- 对应 Vitest 与 Playwright 文件
  - 固化 History 层级、renderer 假存活、超时、CFI 保留和 compositor 默认行为。

## Error Handling

- History API 不可用或调用抛错时，显式 UI 仍直接关闭面板/阅读器；应用功能不得因导航增强失效而锁死。
- popstate 中的业务回调不得抛出未处理异常。
- 健康检查捕获所有跨 iframe/私有 epub.js 对象访问异常，并返回稳定 reason。
- refresh/rebuild 的 rejection 只影响当前 generation；旧 generation 静默结束。
- 网络错误和 timeout 进入可重试状态；404 进入永久错误状态。
- 任意错误状态都保留返回书架的逃生路径。

## Test Strategy

### Unit and Hook Tests

1. History helper：首次基线、打开 reader、打开/切换 panel、逐层 Back、reload 去重和无 History fallback。
2. Reader integration：panel 打开时第一次 popstate 只关面板，第二次关闭阅读器；显式按钮与系统 Back 不重复 entry。
3. Cold restore：active book 恢复后 history 中仍有 library 基线，Back 留在应用书架。
4. Rendition health：
   - iframe DOM 存在但 contents/document 失效时返回不健康；
   - view/iframe 断连、零尺寸或遗留动画时返回具体 reason；
   - 图片型/无正文页面不被误判。
5. Lifecycle recovery：
   - 健康实例只 refresh，不 refetch；
   - 假存活 iframe、refresh reject 或 timeout 触发一次 rebuild；
   - pageshow + visibilitychange 只启动一个恢复；
   - loading 期间 visible 事件在初始化后补做检查；
   - rebuild 使用内存 CFI 而非较旧的服务端 CFI；
   - rebuild 失败显示可重试状态。
6. Compositor：默认 capable session 仍选择 compositor；forced scroll 与 basic fallback 保持通过；生命周期 cancel 清理动画和临时样式。

### Browser Verification

在移动视口自动化中验证：

1. 打开书籍后 URL 不变，但 `history.state.layer === 'reader'`。
2. 打开设置或目录后 Back 只关闭面板；再次 Back 回到书架，文档没有离开应用。
3. 人为使 displayed iframe/view 失效后触发前台事件，阅读器重建并回到原 CFI。
4. 阻断或延迟 EPUB 请求时，恢复 UI 可见且“返回书架”可用。
5. 默认会话诊断仍报告 compositor，恢复后没有持久 Animation/transform/will-change。

Installed-PWA 的 Lenovo 与 iPhone 实机检查仍是最终生命周期证据，自动化浏览器不冒充真实系统的 renderer/GPU 回收。

## Acceptance Criteria

- Lenovo 安装态 PWA 在稳定页、翻页中和初次加载中切后台再恢复时，不再出现永久空白或不可操作状态。
- 健康恢复不重新下载 EPUB；失效 renderer 能自动重建并回到切后台前 CFI。
- 任意恢复失败都有可见错误、重试和返回书架路径。
- iPhone 与 Android 的系统 Back/边缘返回按 `panel → reader → library` 顺序工作。
- 在 library 层继续 Back 仍交给系统，不创建无法退出的 History trap。
- compositor 保持默认；forced scroll、basic 和 reduced-motion 行为不回归。
- 新增测试、现有客户端测试、生产构建和相关 Playwright 验证全部通过。

## Non-goals

- URL 深链接或可分享的书籍/章节路由。
- 浏览器 Forward 重新打开已经卸载的书籍；旧 reader/panel entry 会被明确规范化为 library。ReaderView 仍挂载时的 panel Forward 保留。
- 文件夹、搜索、排序和书架滚动位置的 History 管理。
- 离线阅读、Service Worker 缓存或后台预加载。
- epub.js 升级、翻页动画重设计或 compositor 性能参数调整。
