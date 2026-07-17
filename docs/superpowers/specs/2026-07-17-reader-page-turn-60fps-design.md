# Reader Page Turn 60 FPS Optimization Design

## 状态

已批准，等待用户审阅书面规范。

## 背景

`dev20260716` 相比 `main` 已把阅读器翻页从两阶段遮罩动画改为混合翻页：点按和键盘自动平移，触摸拖动真实正文并跟手，松手后按距离或速度落页或回弹，能力异常时降级到一次 `rendition.next()` 或 `rendition.prev()`。

当前增强路径使用 continuous manager 的横向 scroller。触摸和自动动画的每一帧都会更新 `scrollLeft`，同时更新 scroller transform、页缝 CSS 变量和 opacity。仓库的移动端验证夹具在 375px 视口下生成了 4500px 宽的单个 iframe，即移动端每帧需要驱动一个长章节 iframe 的滚动和 epub.js 滚动监听。代码没有 30 FPS 限制，实机约 30 FPS 更符合主线程滚动、iframe 合成或光栅化超过帧预算的表现。

项目已使用 npm 最新稳定版 `epubjs@0.3.93`。`0.5.0-alpha.3` 不作为生产升级目标，因此本设计不依赖升级 epub.js。

## 目标

在以下设备和运行方式中，让翻页的全部可见阶段至少达到 60 FPS 级别的流畅度：

- iPhone 14 Pro Max：移动端 Chrome 预检，桌面图标启动的 PWA 为主要验收方式。
- 联想小新 Pro GT：移动端 Chrome 预检，桌面图标启动的 PWA 为主要验收方式。
- 覆盖触摸跟手拖动、松手落页、松手回弹、左右点按和键盘自动翻页。

保持当前视觉和交互语义不变：

- 手势方向锁定、距离阈值、速度阈值和边界阻尼不变。
- 点按动画 180ms，落页和回弹 120–220ms，不改变现有时长计算。
- 沿用现有 `easeOutCubic` 运动曲线。
- 正文、页缝线、页缝阴影、页边距和控制层观感不变。
- 落页结果、章节边界、CFI、阅读进度、RTL、reduced-motion 和基础降级行为不变。

## 非目标

- 不追求固定输出 120 FPS；120Hz 屏幕可以高于 60 FPS，但验收下限仍是 60 FPS 级别。
- 不改变阅读器 UI、手势规则或设置项。
- 不重写 epub.js 排版器，不实现三页独立渲染器。
- 不把 `0.5.0-alpha.3` 引入生产环境。
- 不顺带重构阅读器之外的模块。

## 性能验收标准

每种动作分别采样，不用整段页面空闲时间稀释结果：

- 平均帧率不低于 58 FPS。
- 95% 的帧间隔不超过 20ms。
- 不出现连续两个超过 33.4ms 的卡顿帧。
- 输入到首次正文位移不超过 33.4ms。
- 动画结束后没有持续的 `will-change`、临时 transform 或不断增长的动画对象。

Chrome 标签页用于开发预检，桌面 PWA 是最终通过条件。两台设备在两种运行方式下，每个场景至少连续执行 20 次。系统通知、应用切换等外部中断产生的样本单独标记，不混入动画路径判断。

## 总体架构

保留 `usePageTurnController` 的状态机和操作代次机制，在 `epubPageTurnAdapter` 内引入两个动画后端：

1. **Compositor backend（默认候选）**：视觉运动由已显示 `.epub-view` 的 transform 完成；只有落页完成时提交一次 scroller 滚动。
2. **Scroll backend（永久降级）**：保留当前逐帧 `scrollLeft` 实现，供能力检测失败或合成会话异常时使用。

控制器只使用现有 `begin()`、`dragBy()`、`animateTo()`、`end()`、`cancel()` 和稳定性查询接口，不感知具体后端。后端选择、epub.js 私有对象访问、视图样式保存和恢复全部限制在 `client/src/utils/epubPageTurnAdapter.js`，继续遵守项目既有模块边界。

基础路径仍只调用一次 `rendition.next()` 或 `rendition.prev()`。同一次操作不会混用增强滚动提交和基础导航。

## 合成会话

### 能力检查

只有同时满足以下条件，`begin()` 才选择 compositor backend：

- continuous manager、paginated、horizontal、Snap 能力和 RTL scroll type 仍满足现有检查。
- scroller 精确对齐到页宽，页宽、滚动范围和目标位置有效。
- `manager.views.displayed()` 返回至少一个已连接的 `.epub-view`。
- 会话使用的 view 没有活动中的 transform 动画，也没有非空的业务 transform；不能安全叠加时使用 scroll backend。
- `Element.prototype.animate`、`Animation.finished` 和取消能力可用。
- 当前没有 reduced-motion、设置重排、尺寸变化或其他活动翻页。

能力检查不修改 epub.js 包源码。若未来确实需要补丁，仍只能通过 adapter 封装，并必须保留同样的运行时检测和降级。

若 compositor 能力在任何视觉位移发生前不满足，adapter 可以在同一次操作直接创建 scroll backend 会话；此时不存在需要恢复的半完成合成状态。

### 会话快照

合成会话记录：

- 稳定 CFI、逻辑 origin、物理 scrollLeft、pageWidth、maxScroll 和方向映射。
- `canPrevious`、`canNext`。
- 所有已显示 view 的元素身份及原始 inline `transform`、`will-change` 和相关临时样式。
- 当前视觉位移、边界状态、活动 Animation 列表和操作代次。

会话期间若 view 被移除、替换、断开连接或几何发生变化，本次操作取消并恢复稳定页，不尝试在新旧视图集合之间继续动画。

### 合成层准备与释放

- pointerdown 后、方向尚未锁定时即可给候选 view 设置临时 `will-change: transform`，利用现有 10px 方向锁定距离准备合成层。
- 点按和键盘路径在第一个动画帧前完成同样的准备，不额外增加一整帧等待。
- 只给当前已显示 view 加临时样式，不给整个 reader overlay 或 scroller 建立永久图层。
- `end()`、`cancel()`、异常恢复和组件销毁都恢复会话前的原始 inline 样式。
- 长章节风险由短生命周期图层、实机 GPU 内存观察和能力降级控制；不得把 `will-change` 常驻在宽 iframe 上。

## 动画数据流

### 跟手拖动

控制器继续把 pointermove 合并到一个 rAF。每个 rAF：

1. 使用现有 `clampDragDistance()` 或 `dampBoundaryDistance()` 计算视觉位移。
2. 对会话中的所有已显示 view 写入相同的 `translate3d(x, 0, 0)`。
3. 直接更新 14px 页缝元素的 transform。
4. 不更新 scroller `scrollLeft`，不触发 relocation、进度保存或 epub.js 的滚动检查。

每帧不调用 React state setter。方向和 phase 仍只在阶段切换时更新。

### 松手回弹

- 从当前视觉位移动画到 `0`。
- duration 继续由 `getSettleDuration()` 计算。
- 完成后恢复 view 和页缝的原始样式；scroller 始终停在 origin，因此不产生 relocation。

### 松手落页

- 从当前视觉位移动画到 `-pageWidth` 或 `+pageWidth` 的完整视觉目标。
- 动画完成并保持最终 transform 后，在同一绘制周期内把 scroller 一次性提交到目标逻辑页，再移除 Animation 和临时 transform。
- 提交后的无 transform 画面与提交前的最终 transform 画面几何等价，不应出现跳帧、双移或闪白。
- 最终一次滚动交给 continuous manager 正常执行检查、章节预加载和 relocation。
- 控制器继续等待现有 relocated waiter，并用 `isStableAt(delta)` 验证结果；超时或不稳定时执行现有恢复流程。

### 点按和键盘

- 从 `0` 到完整一页视觉位移执行 180ms 动画。
- 使用与松手落页相同的单次滚动提交和稳定性验证。
- 动画前后的方向、页缝和 phase 与当前实现一致。

### 运动曲线

不能用浏览器默认 smooth scroll，因为其 duration 和 easing 不受项目控制。WAAPI transform 动画由现有 `easeOutCubic()` 在归一化时间上采样生成关键帧，关键帧之间线性插值。采样密度必须让最大位置误差低于页面宽度的 0.25%，从而保持当前曲线，同时允许浏览器在合成线程执行 transform 动画。

同一会话的多个 view 和页缝使用同一开始时间、duration 和关键帧进度。任一 Animation 取消或拒绝，整组动画都取消并进入统一恢复。

### 边界和章节切换

- 书籍真正起点或终点继续使用现有边界阻尼和回弹，不提交滚动。
- continuous manager 尚未准备相邻内容时，先回弹并结束合成会话，再按现有规则使用一次基础导航；不能边 transform 边调用 next/prev。
- 相邻章节已经由 continuous manager 显示时，所有已显示 view 同步 transform，章节接缝仍连续移动。

## 帧内写入清理

无论选中哪个增强后端，都执行以下低风险清理：

- 删除未被 CSS 消费的 `--reader-page-turn-progress` 帧内写入。
- opacity 只在动画开始、隐藏和清理时更新，不在每帧重复写 `1`。
- 边界 offset 没有变化时不重复写 scroller transform。
- 页缝直接写 transform，避免每帧通过自定义属性重新解析。
- 不在同一帧交替读取布局和写入样式；pageWidth、origin 和滚动范围只在会话开始读取。

这些清理本身不是 60 FPS 保证，主要用于降低合成路径之外的固定开销，并改善 scroll backend 降级表现。

## 取消、恢复和错误处理

沿用控制器已有的单调递增取消代次。所有异步边界，包括 Animation.finished、relocated waiter 和 recover，都在继续前检查代次。

以下事件统一取消当前会话：

- pointercancel、组件卸载和显式关闭阅读器。
- resize、orientationchange、页面隐藏或 PWA 切后台。
- 字体、字号、页边距、行距、字距或主题引起的 rendition mutation。
- view 集合变化、Animation 异常、稳定位置验证失败。

取消顺序固定为：停止 rAF 和 Animation、取消 waiter、恢复 view 样式、恢复 origin、清理页缝、结束 session、恢复 ready phase。恢复到稳定 CFI 失败时确定地进入基础模式，不向 UI 泄漏 rejection。

不得在已经产生视觉位移后，直接从半完成的 transform 切换到逐帧 scroll。必须先恢复稳定页，后续新操作才可以选择 scroll backend 或基础路径。动画开始前的 compositor 能力检测失败不受此限制，可以在同一次操作直接选择 scroll backend。

## 性能采样

增加仅在显式调试开关启用时运行的帧采样器。正式默认路径不注册持续 rAF，不保留样本，也不输出日志。

每个样本至少记录：

- 动作类型：drag、commit、rollback、tap-prev、tap-next。
- 输入时间、首次视觉更新、动画开始和结束时间。
- 每个 rAF 的 timestamp、帧间隔、backend 和取消原因。
- 平均 FPS、p95 帧间隔、超过 20ms 的帧数、超过 33.4ms 的连续帧。

调试结果通过一个只读的 `window` 诊断对象或控制台摘要读取，不增加用户 UI。诊断开关同时允许强制 compositor 或 scroll backend，方便同一设备 A/B 对比；发布验收后默认关闭强制模式。

## 测试策略

### 纯函数和 adapter 单元测试

- easeOutCubic 采样关键帧的起点、终点、单调性和最大误差。
- LTR、两种已支持 RTL scroll type 的逻辑/物理位置映射。
- 拖动期间 view transform 变化而 scrollLeft 保持 origin。
- 多个 displayed view 使用相同 transform。
- 回弹不提交滚动；落页恰好提交一次目标滚动。
- 动画完成、取消、拒绝、destroy 和 recover 后原始样式完整恢复。
- view 中途断开、几何失效和非空业务 transform 触发安全降级。
- 边界阻尼、相邻内容缺失和 reduced-motion 保持现有行为。

### 控制器测试

- phase、direction 和操作代次不因后端变化而改变。
- 自动翻页、完整一页拖动、距离落页、速度落页和回弹。
- 动画期间取消后不再提交滚动、导航或永久降级。
- 合成后端失败时先恢复稳定页，新操作才进入 scroll 或 basic。
- 每次成功操作只产生一次有效的页面结果和进度更新。

### Playwright 浏览器验收

扩展 `client/scripts/verify-reader-page-turn.mjs`：

- 中途正文和页缝已移动，但 scroller.scrollLeft 仍等于 origin。
- 成功落页后 scrollLeft 精确变化一个 pageWidth，view transform 和 will-change 已清理。
- 回弹后 scrollLeft、页码和 CFI 不变。
- 页边距、column gap、页缝几何、页码、reduced-motion 和基础降级不回归。
- 覆盖单章节、章节边界、LTR 和测试可构造的 RTL 情况。

Playwright 只验证功能、状态和动画数据，不代替真实移动设备 FPS 结论。

### 实机矩阵

两台目标设备分别在移动端 Chrome 和桌面 PWA 中执行：

- 慢速跟手后落页。
- 慢速跟手后回弹。
- 快速短距离滑动落页。
- 左右点按连续翻页。
- 章节首尾切换。
- 长章节、含图片 EPUB 和四种主题。
- 调整字体、字号、水平页边距、行距和字距后翻页。
- 横竖屏变化、切后台再恢复、关闭再打开阅读器。
- reduced-motion 模式。

每个核心动作连续 20 次，分别记录 compositor 和 scroll backend。只有 compositor 在两台设备的 PWA 中均达到性能标准且所有功能验证通过，才可以成为默认后端。

## 发布顺序

1. 加入帧采样和后端强制开关，建立当前 scroll backend 的实机基线。
2. 完成帧内写入清理，不改变默认后端，验证功能基线不回归。
3. 实现 compositor backend，并在自动化测试中强制启用。
4. 在 Chrome 标签页完成两台设备预检。
5. 在桌面 PWA 完成最终功能和性能矩阵。
6. 达标后把 compositor 设为默认；永久保留运行时能力检测、scroll backend 和 basic navigation。

若合成路径未达到目标，不通过缩短时长、修改缓动、降低页缝效果或改变手势阈值来伪造改善。应根据采样结果判断是宽 iframe 图层光栅化、合成提交还是输入延迟，再决定是否另立三页缓冲渲染设计。

## 预计修改范围

- `client/src/utils/pageTurnGesture.js`
- `client/src/utils/pageTurnGesture.test.js`
- `client/src/utils/epubPageTurnAdapter.js`
- `client/src/utils/epubPageTurnAdapter.test.js`
- `client/src/hooks/usePageTurnController.js`
- `client/src/hooks/usePageTurnController.test.jsx`
- `client/src/components/reader/ReaderView.jsx`，仅在诊断开关接线确有需要时修改。
- `client/src/styles/reader.css`
- `client/scripts/verify-reader-page-turn.mjs`
- 与性能采样器直接对应的新测试文件（如拆成独立工具）。

不修改服务端、数据库、阅读进度 API、书架、文件夹或 PWA 缓存策略。

## 完成条件

- 所有新增和现有翻页测试通过。
- 客户端构建通过。
- Playwright 阅读器翻页验收通过。
- 两台目标设备的 Chrome 预检和桌面 PWA 最终矩阵通过。
- 实机指标满足本设计的 FPS、p95、连续卡顿帧和输入响应标准。
- 当前视觉、交互、进度、章节边界、RTL、reduced-motion 和降级功能没有回归。
