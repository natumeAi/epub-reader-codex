# Reader Page Turn P1 Remediation Design

## 目标

修复混合翻页实现中的三个 P1：生命周期取消后异步收尾继续执行、触摸拖动已经精确到达目标页时仍等待并超时、恢复稳定 CFI 失败时异常向 UI 冒泡。修复后，取消操作不再产生导航或永久降级，完整一页拖动能够立即提交，恢复失败会确定地进入可继续阅读的基础模式。

## 范围

本次只修改翻页控制器、epub.js 适配层及其直接测试和浏览器验收脚本：

- `client/src/hooks/usePageTurnController.js`
- `client/src/hooks/usePageTurnController.test.jsx`
- `client/src/utils/epubPageTurnAdapter.js`
- `client/src/utils/epubPageTurnAdapter.test.js`
- `client/scripts/verify-reader-page-turn.mjs`

不改变手势阈值、RTL 坐标规则、阅读进度 API、ReaderView 结构、CSS 视觉、服务端或数据库。

## 根因

### 生命周期取消竞态

`cancelPageTurn()` 会清理当前 waiter、pointer 和 adapter session，但已经运行的异步 `turnPage()` 或触摸 `settle()` 没有取消标识。它们在 `await` 返回后仍会继续执行恢复、永久切换 basic、`runBasicNavigation()` 或最终阶段重置，因此取消后的旧操作能够影响后续状态。

### 已到目标页仍超时

触摸路径到 `pointerup` 才创建 relocated waiter。若用户先拖动恰好一个页宽并停留，scroller 已经到达目标，先前滚动事件也已结束。随后 `animateTo()` 从目标移动到同一目标，不会产生新的 scroll/relocated，控制器等待 1200ms 后错误恢复到原页。

### 恢复异常未封装

适配层 `recover()` 直接等待 `rendition.display(stableCfi)`。display 拒绝时 Promise 向上传播；控制器没有统一的恢复包装，因而可能产生未处理 rejection，并跳过进入 basic 的步骤。

## 设计

### 1. 取消代次

控制器新增单调递增的取消代次 ref。每个自动导航或增强触摸收尾在开始时捕获当前代次；`cancelPageTurn()` 先递增代次，再清理 waiter、pointer、adapter 和视觉状态。

所有可能让控制权离开当前调用栈的 `await` 之后，以及调用 `recover()`、`runBasicNavigation()`、`adapter.end()` 或重置阶段之前，都检查捕获代次是否仍是当前值。代次不一致时立即返回 `ignored` 或结束触摸收尾，不执行任何导航、恢复、降级或旧操作的 finally 状态覆盖。

代次只表达“这个异步操作是否已被取消”，不替代现有 `phaseRef` 的并发门禁。现有 `idle/basic/settling` 语义和重复输入过滤保持不变。

### 2. 精确目标位置报告

适配层在 `animateTo(pageDelta)` 开始时记录 scroller 是否已经位于目标页。若 `pageDelta` 为 `-1` 或 `1`、起点已在目标且动画正常完成，适配层调用 rendition 的 `reportLocation()`，主动要求 epub.js 从当前稳定 scroller 位置产生一次 relocated。

控制器仍在调用 `animateTo()` 前注册 waiter，因此该报告不会丢失。普通自动翻页和部分拖动仍依赖真实 scroll 产生 relocated，不额外报告，避免重复位置事件。若目标位置报告能力缺失或调用失败，动画返回 `unavailable`，控制器走现有恢复并降级路径，不等待无意义的 1200ms。

`reportLocation()` 的使用被限制在 `epubPageTurnAdapter.js`，继续维持单一 epub.js 集成边界。

### 3. 安全恢复到 basic

适配层 `recover()` 捕获 `rendition.display()` 失败并返回 `false`，不向调用方抛出。控制器增加统一的 `recoverToBasic()`：调用 adapter 恢复时再做一次异常防护，并在操作仍未取消时进入 basic。

超时或真实对齐失败使用 `recoverToBasic()`；生命周期取消不调用它，因为取消只应恢复当前原点并保持下一次能力检测，不应永久降级。自动导航返回 `failed`，触摸路径回到可输入阶段，不产生未处理 Promise rejection。

## 数据流

正常增强翻页：输入 → 捕获取消代次 → 注册 relocated waiter → `animateTo()` → relocated → 校验代次与稳定目标 → `adapter.end()` → ready。

完整一页拖动：拖动已到目标 → pointerup 注册 waiter → `animateTo()` 识别起点等于目标 → `reportLocation()` → relocated → 完成。

生命周期取消：递增取消代次 → 清理 waiter/session/pointer → ready；旧异步调用恢复后发现代次失效并停止。

恢复失败：relocated 超时或对齐失败 → `recoverToBasic()` → display 成功或失败均被封装 → basic。

## 测试设计

严格按 TDD 增加以下回归测试，并逐项确认修改生产代码前测试因原缺陷失败：

1. 增强触摸 settling 期间 resize，取消后不调用 recover、不进入 basic。
2. 相邻页未就绪的回弹 settling 期间 resize，取消后不调用 `next/prev`。
3. 自动增强导航等待 relocated 时取消，旧 finally 不覆盖取消后的 ready 状态。
4. `animateTo(1)` 从目标位置开始时只调用一次 `rendition.reportLocation()`。
5. 目标位置报告缺失或失败时返回确定的 unavailable 状态。
6. `rendition.display(stableCfi)` 拒绝时 `recover()` 返回 false。
7. 控制器恢复失败时不 reject，并进入 basic。
8. Playwright 增加“拖动一个真实 scroller 页宽、停留后松手”的场景，验证只前进一页且不进入 basic。

## 验收标准

- 任何 resize、orientationchange、hidden、pointercancel、设置重排或卸载取消后，旧操作不再导航、恢复、永久降级或覆盖新阶段。
- 拖动恰好一个页宽并停留后松手，在正常收尾时长内前进一页，不等待 1200ms，不进入 basic。
- 稳定 CFI 恢复失败不产生未处理 rejection，控制器保持基础翻页可用。
- 既有 58 项客户端测试、生产构建、常规/回弹/快扫/reduced-motion Playwright 验收继续通过。
- epub.js manager、scroller、layout、Snap 和位置报告仍集中在适配层边界内。

## 非目标

- 不重写整个 controller 为 reducer 或状态机库。
- 不引入 AbortController 到 epub.js 适配层。
- 不改变阅读进度持久化、手势参数、主题视觉或设备验收范围。
- 不顺带处理 P2/P3、未跟踪计划文档或其他工作树文件。
