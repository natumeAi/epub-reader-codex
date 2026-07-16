# Reader Page Turn Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为阅读器建立可测试的翻页手感规则、唯一的 epub.js 私有接口适配层，并把 rendition 切换到 continuous + Snap，同时保证只有稳定对齐后的 relocated 能进入既有进度链。

**Architecture:** 纯函数模块集中定义手势阈值和一页限制；无 React 的 epubPageTurnAdapter 封装 continuous manager、scroller、layout、RTL 和 rAF 对齐。useEpubRendition 只负责创建/销毁适配层和过滤未对齐位置，useReaderSettings 改用 epub.js 公共 resize/display 接口，避免第二处私有接口边界。

**Tech Stack:** React 19、epub.js 0.3.93、Pointer Events、requestAnimationFrame、Vitest 3、jsdom 26、Testing Library

---

## Execution Order and Preconditions

本计划是 Phase A；完成后再执行 docs/superpowers/plans/2026-07-16-reader-page-turn-integration.md。

执行前必须先完成 docs/superpowers/plans/2026-07-16-review-remediation-index.md，至少要使其 Quality Foundation、Reader Progress Reliability 和 reduced-motion 改动进入当前执行分支。当前 main 尚不满足以下条件，而独立 worktree review-remediation 中的实现不能被当作当前分支已有代码：

~~~powershell
npm pkg get scripts.test --prefix client
Test-Path client/vitest.config.js
Test-Path client/src/hooks/useReducedMotion.js
Test-Path client/src/hooks/useReadingProgressPersistence.js
~~~

Expected:

~~~text
"vitest run"
True
True
True
~~~

若任一条件不满足，属于执行 Blocker：停止本计划并先完成既有 remediation 计划，不在本计划内复制测试基建或进度持久化实现。

仓库规范读取结果：递归检查普通与隐藏目录均未发现 AGENTS.md；本计划已采用 README.md 的部署边界和 PROJECT.md 的编码/验证约定。README.md 与部署配置不需要修改。

## Code Mapping

1. 当前功能主要入口

   - client/src/components/reader/ReaderView.jsx 的 ReaderView。
   - ReaderView 当前直接处理左右点按、中心点按、方向键和横向 pointerup，并以 turnPage 调用 rendition.next()/prev()。

2. 当前调用链和数据流

   - ReaderView 输入 → turnPage → 两阶段 out/in 动画或触摸纯色 sheet → rendition.next()/prev()。
   - useEpubRendition 创建 rendition → relocated → currentCfiRef、章节、usePageProgress、百分比和 useReadingProgressPersistence。
   - useReaderSettings 在内容 hook、rendered 回调和设置重排时更新当前 iframe；相邻 continuous view 必须继续走同一 content hook。

3. 与本次优化相关的核心文件

   - client/src/components/reader/ReaderView.jsx：现有输入和动画组合层。
   - client/src/hooks/useEpubRendition.js：rendition 配置、relocated 和生命周期恢复。
   - client/src/hooks/useReaderSettings.js：排版应用与当前私有 manager 访问。
   - client/src/hooks/usePageProgress.js：分页 label 消费稳定 relocated。
   - client/src/styles/reader.css：当前正文滑动、触摸 sheet 和手势层。
   - client/node_modules/epubjs/src/managers/continuous/index.js：continuous manager 的填充、滚动和 SCROLLED 时序，仅作依赖参考。
   - client/node_modules/epubjs/src/managers/helpers/snap.js：Snap 的 pageWidth、needsSnap 和触摸监听，仅作依赖参考。

4. 已有测试覆盖

   - 当前 main 没有可执行客户端单元测试命令。
   - 前置 remediation 基线提供 client/src/hooks/useEpubRendition.test.jsx、client/src/components/reader/ReaderView.test.jsx、Vitest/jsdom/Testing Library 和隔离 Playwright 环境。
   - 现有 client/scripts/verify-reader-mobile.mjs 覆盖 Aa 设置和移动视口，不覆盖真实正文拖动、回弹或一页限制。

5. 设计方案将影响的文件

   - Create: client/src/utils/pageTurnGesture.js
   - Create: client/src/utils/pageTurnGesture.test.js
   - Create: client/src/utils/epubPageTurnAdapter.js
   - Create: client/src/utils/epubPageTurnAdapter.test.js
   - Modify: client/src/hooks/useEpubRendition.js
   - Modify: client/src/hooks/useEpubRendition.test.jsx
   - Modify: client/src/hooks/useReaderSettings.js

6. 明确不应修改的模块

   - server/ 下的 API、数据库、EPUB 入库和文件服务。
   - client/src/api/readingApi.js 与 client/src/hooks/useReadingProgressPersistence.js 的接口和持久化语义。
   - 书架、文件夹、PWA manifest、Dockerfile 和 docker-compose.yml。
   - epub.js 包源码和 node_modules；只能由适配层读取其既有运行时对象。

7. 兼容与回归风险

   - continuous manager 会让桌面 rAF 滚动产生中间 relocated；必须由稳定对齐检查挡住，避免 CFI、页码和保存进度跳动。
   - RTL 的物理 scrollLeft 与阅读顺序不同；LTR、RTL default、RTL negative 必须统一到“next 为正”的逻辑坐标。
   - 相邻 view 尚未填充、页宽无效、方向不支持或原点未对齐时必须降级，不能把增强移动与 next/prev 混在同一次未恢复操作中。
   - useReaderSettings 当前读取 rendition.manager 和 rendition._layout；若保留，会违反“适配层是唯一私有接口边界”的已确认设计。
   - 前置 progress-reliability 改动与本计划共同修改 ReaderView/useEpubRendition；必须先落定前置基线，不能并行编辑后再盲目覆盖。

## Behavior Classification

- 保留：左/中/右点按语义、桌面方向键、编辑控件和面板打开时不翻页、目录跳转、主题与排版重套、稳定 relocated 驱动的 CFI/页码/章节/百分比/保存链、reduced motion 基础导航。
- 修改：rendition 从默认 manager 改为 continuous manager + paginated flow + snap；进度处理只接受稳定对齐位置；边距重排不再直接读取 manager/_layout。
- 新增：集中手感规则、LTR/RTL 归一化适配层、基于稳定原点的拖动和一页 rAF 对齐能力。
- 明确废弃：本 Phase 不删除 UI sheet，但其内部时序不再是后续实现的导航基础；Phase B 会删除旧 out/in sheet、SWIPE_THRESHOLD 和 ReaderView 内的翻页状态机。

## Conflicts, Blockers, Existing Issues, and Backlog

### Conflicts

- PROJECT.md 仍规定所有真实翻页只能调用 next/prev；设计文档明确在 continuous 增强路径内取代该约定。影响是 Phase B 必须同步修正文档，且增强落页后严禁再次调用 next/prev。
- useReaderSettings 现有私有 manager/_layout 读取与单一适配层边界冲突。影响是 Task 4 必须改用公共 resize/display，原有零 gap 和 CFI 重排结果必须保留。

### Blockers

- 当前执行分支缺少 Vitest、进度可靠性和 reduced-motion 前置基线时，Task 1 不得开始。
- Phase B 最终验收需要 iPhone 14 Pro Max 与联想小新 Pro GT；设备不可用不阻止 Phase A，但会阻止整个功能最终验收。

### Existing Issues

- 本次仅做只读检查，没有运行测试，因此未产生新的测试失败记录。
- 工作树已有未跟踪 .superpowers/ 和 client/reader-settings-narrow.png；执行时不得删除、覆盖或顺带提交。

### Backlog

- epub.js 报告 rtlScrollType=reverse 时本轮按能力失败进入 basic；若未来目标浏览器实际需要该模式，再以独立兼容任务补充。
- 正式帧时间遥测和未知低端设备性能分级不在本轮；目标设备只做设计指定的有限实机验收。

## Global Constraints

Execution and Review Guardrails

严格按照设计文档和本计划执行，不扩大范围。

不得因为发现新的优化点而增加当前计划内容。

新发现的非阻塞问题统一记录到 Backlog。

每个 Task 只允许一次实现检查。

不得在每个 Task 中调用 requesting-code-review。

不得执行开放式全面质量审查。

不得形成“审查—修复—重新审查”的循环。

修复后只能重新运行原计划指定的验证。

同一验证连续失败两次时必须停止并报告。

满足 Done Criteria 后必须立即结束当前 Task。

不以零警告、零技术债、穷尽边界或生产级完美作为完成标准。

与当前设计目标无关的问题不得阻塞计划完成。

### Task 1：集中定义翻页手感与一页决策规则

Estimated effort: 45–60 minutes

#### Goal

产生一个无 React、无 DOM 依赖的规则模块；方向锁定、距离/速度阈值、边界阻尼、单页结果、收尾时长和点按分区都有确定且可单测的结果。

#### Existing Behavior

ReaderView 只用固定 45px 的 pointerup 位移判断 swipe；没有方向锁定、横纵比例、速度、平板阈值上限或边界阻尼。左/中/右三区点按语义必须保留。

#### Required Change

按设计集中定义 10px、1.2、28%、72–160px、0.45px/ms、28px、180ms、120–220ms 和 1200ms；任何手势决策只能返回 -1、0 或 1 页。

#### Files

- Create: client/src/utils/pageTurnGesture.js
- Create: client/src/utils/pageTurnGesture.test.js
- Reference: docs/superpowers/specs/2026-07-16-reader-page-turn-interaction-design.md

#### Interfaces

- Consumes: 数值 dx、dy、pageWidth、最近 pointer samples。
- Produces:
  - PAGE_TURN_RULES: 冻结的阈值对象。
  - classifyDirection(dx, dy): pending | horizontal | vertical。
  - getDistanceThreshold(pageWidth): number。
  - getRecentVelocity(samples): number，正值向右、负值向左。
  - decidePageDelta({ distanceX, velocityX, pageWidth }): -1 | 0 | 1；-1=prev，1=next。
  - clampDragDistance(distanceX, pageWidth): number。
  - dampBoundaryDistance(distanceX): number。
  - getSettleDuration(remainingDistance, pageWidth): number。
  - getTapZone(clientX, left, width): prev | center | next。
- 后续 Task 2 和 Phase B controller 直接消费这些名称，不再复制数值。

#### Implementation Steps

- [ ] Step 1: Write the failing pure-logic tests

Create client/src/utils/pageTurnGesture.test.js:

~~~js
import { describe, expect, it } from 'vitest';
import {
  PAGE_TURN_RULES,
  clampDragDistance,
  classifyDirection,
  dampBoundaryDistance,
  decidePageDelta,
  getDistanceThreshold,
  getRecentVelocity,
  getSettleDuration,
  getTapZone,
} from './pageTurnGesture.js';

describe('page-turn gesture rules', () => {
  it('locks only after 10px and requires a 1.2 horizontal advantage', () => {
    expect(classifyDirection(9, 0)).toBe('pending');
    expect(classifyDirection(10, 8)).toBe('horizontal');
    expect(classifyDirection(10, 9)).toBe('vertical');
  });

  it('clamps the 28 percent distance threshold for phone and tablet widths', () => {
    expect(getDistanceThreshold(200)).toBe(72);
    expect(getDistanceThreshold(375)).toBe(105);
    expect(getDistanceThreshold(1000)).toBe(160);
  });

  it('calculates signed velocity from the latest 100ms sample window', () => {
    expect(getRecentVelocity([
      { x: 300, time: 0 },
      { x: 260, time: 50 },
      { x: 220, time: 100 },
    ])).toBeCloseTo(-0.8);
    expect(getRecentVelocity([
      { x: 100, time: 0 },
      { x: 145, time: 100 },
    ])).toBeCloseTo(0.45);
  });

  it('completes by distance or speed and otherwise returns zero pages', () => {
    expect(decidePageDelta({ distanceX: -110, velocityX: -0.1, pageWidth: 375 })).toBe(1);
    expect(decidePageDelta({ distanceX: 50, velocityX: 0.6, pageWidth: 375 })).toBe(-1);
    expect(decidePageDelta({ distanceX: -50, velocityX: -0.2, pageWidth: 375 })).toBe(0);

    const results = [
      decidePageDelta({ distanceX: -500, velocityX: -4, pageWidth: 375 }),
      decidePageDelta({ distanceX: 0, velocityX: 0, pageWidth: 375 }),
      decidePageDelta({ distanceX: 500, velocityX: 4, pageWidth: 375 }),
    ];
    expect(new Set(results)).toEqual(new Set([-1, 0, 1]));
  });

  it('limits drag, edge damping, settle duration, and tap zones', () => {
    expect(clampDragDistance(-800, 375)).toBe(-375);
    expect(dampBoundaryDistance(200)).toBe(PAGE_TURN_RULES.edgeDampingMaxPx);
    expect(dampBoundaryDistance(-40)).toBe(-10);
    expect(getSettleDuration(0, 375)).toBe(120);
    expect(getSettleDuration(375, 375)).toBe(220);
    expect(getTapZone(20, 0, 300)).toBe('prev');
    expect(getTapZone(150, 0, 300)).toBe('center');
    expect(getTapZone(280, 0, 300)).toBe('next');
  });
});
~~~

- [ ] Step 2: Run the directed test and confirm the module is missing

Run: npm test --prefix client -- pageTurnGesture.test.js

Expected: exit code 1 with a failed import for ./pageTurnGesture.js.

- [ ] Step 3: Implement the minimal pure-logic module

Create client/src/utils/pageTurnGesture.js:

~~~js
export const PAGE_TURN_RULES = Object.freeze({
  directionLockPx: 10,
  horizontalRatio: 1.2,
  distanceRatio: 0.28,
  distanceMinPx: 72,
  distanceMaxPx: 160,
  velocityThresholdPxPerMs: 0.45,
  velocityWindowMs: 100,
  edgeDampingMaxPx: 28,
  edgeDampingFactor: 0.25,
  tapDurationMs: 180,
  settleDurationMinMs: 120,
  settleDurationMaxMs: 220,
  relocatedTimeoutMs: 1200,
});

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function classifyDirection(dx, dy) {
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  if (Math.max(horizontal, vertical) < PAGE_TURN_RULES.directionLockPx) {
    return 'pending';
  }
  return horizontal >= vertical * PAGE_TURN_RULES.horizontalRatio
    ? 'horizontal'
    : 'vertical';
}

export function getDistanceThreshold(pageWidth) {
  const width = Number(pageWidth);
  if (!Number.isFinite(width) || width <= 0) return PAGE_TURN_RULES.distanceMinPx;
  return Math.round(clamp(
    width * PAGE_TURN_RULES.distanceRatio,
    PAGE_TURN_RULES.distanceMinPx,
    PAGE_TURN_RULES.distanceMaxPx,
  ));
}

export function getRecentVelocity(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  const cutoff = last.time - PAGE_TURN_RULES.velocityWindowMs;
  const first = samples.find((sample) => sample.time >= cutoff) || samples[0];
  const elapsed = last.time - first.time;
  return elapsed > 0 ? (last.x - first.x) / elapsed : 0;
}

export function decidePageDelta({ distanceX, velocityX, pageWidth }) {
  const distanceReached = Math.abs(distanceX) >= getDistanceThreshold(pageWidth);
  const velocityReached =
    Math.abs(velocityX) >= PAGE_TURN_RULES.velocityThresholdPxPerMs;
  if (!distanceReached && !velocityReached) return 0;

  const decidingMotion = distanceReached ? distanceX : velocityX;
  if (decidingMotion < 0) return 1;
  if (decidingMotion > 0) return -1;
  return 0;
}

export function clampDragDistance(distanceX, pageWidth) {
  const width = Number(pageWidth);
  if (!Number.isFinite(width) || width <= 0) return 0;
  return clamp(distanceX, -width, width);
}

export function dampBoundaryDistance(distanceX) {
  const damped = Math.min(
    Math.abs(distanceX) * PAGE_TURN_RULES.edgeDampingFactor,
    PAGE_TURN_RULES.edgeDampingMaxPx,
  );
  return Math.sign(distanceX) * damped;
}

export function getSettleDuration(remainingDistance, pageWidth) {
  const width = Number(pageWidth);
  const ratio = width > 0 ? clamp(Math.abs(remainingDistance) / width, 0, 1) : 1;
  const durationRange =
    PAGE_TURN_RULES.settleDurationMaxMs - PAGE_TURN_RULES.settleDurationMinMs;
  return Math.round(PAGE_TURN_RULES.settleDurationMinMs + durationRange * ratio);
}

export function getTapZone(clientX, left, width) {
  const ratio = width > 0 ? (clientX - left) / width : 0.5;
  if (ratio < 1 / 3) return 'prev';
  if (ratio > 2 / 3) return 'next';
  return 'center';
}

export function easeOutCubic(progress) {
  const value = clamp(progress, 0, 1);
  return 1 - ((1 - value) ** 3);
}
~~~

- [ ] Step 4: Re-run the same directed test

Run: npm test --prefix client -- pageTurnGesture.test.js

Expected: exit code 0 with five passing tests.

- [ ] Step 5: Commit the rule module

~~~powershell
git add client/src/utils/pageTurnGesture.js client/src/utils/pageTurnGesture.test.js
git commit -m "test: define page turn gesture rules"
~~~

#### Done Criteria

- 所有设计数值只在 PAGE_TURN_RULES 中定义一次。
- 手机、平板阈值、正反速度、距离完成、速度完成、回弹和一页限制均有确定结果。
- 定向测试通过。

#### Verification

Run: npm test --prefix client -- pageTurnGesture.test.js

Expected: exit code 0; five tests pass.

#### Regression Scope

- 左/中/右三区边界保持 1/3 与 2/3。
- 左滑映射 next=1，右滑映射 prev=-1。
- 任何输入都不能产生绝对值大于 1 的页增量。

#### Out of Scope

- React 状态、DOM pointer capture、epub.js manager。
- 鼠标拖动、触控板、多页惯性和用户设置项。
- 实机参数微调；本 Task 只落实已确认初始值。

### Task 2：封装 continuous manager 能力检测、RTL 坐标与跟手写入

Estimated effort: 60–90 minutes

#### Goal

产生唯一允许读取 rendition.manager、manager.container/layout/settings/snapper 和 scrollLeft 的模块；同一次拖动始终从稳定原点计算，并在无相邻页时只显示最多 28px 的阻尼。

#### Existing Behavior

应用没有 continuous scroller 适配层；ReaderView 不读取 scrollLeft，但 useReaderSettings 直接读取 manager/_layout。现有触摸交互只在 pointerup 调用 next/prev。

#### Required Change

新增无 React 适配层，检查 continuous、paginated、horizontal、Snap、有效页宽、有效方向和稳定原点；实现 LTR、RTL default、RTL negative 的逻辑/物理坐标换算、相邻可用性和原点式 dragBy。

#### Files

- Create: client/src/utils/epubPageTurnAdapter.js
- Create: client/src/utils/epubPageTurnAdapter.test.js
- Reference: client/node_modules/epubjs/src/managers/continuous/index.js
- Reference: client/node_modules/epubjs/src/managers/helpers/snap.js
- Reference: client/node_modules/epubjs/src/utils/scrolltype.js
- Reference: client/src/utils/pageTurnGesture.js

#### Interfaces

- Consumes: rendition 运行时对象；Task 1 的 clampDragDistance 和 dampBoundaryDistance。
- Produces:
  - toLogicalScroll({ scrollLeft, maxScroll, direction, rtlScrollType }): number。
  - toPhysicalScroll({ logicalScroll, maxScroll, direction, rtlScrollType }): number。
  - createEpubPageTurnAdapter(rendition, environment?): adapter。
  - adapter.inspect(): capability；包含 available、reason、pageWidth、origin、canPrevious、canNext。
  - adapter.begin(stableCfi): capability | null；缓存稳定原点而不是累计当前位置。
  - adapter.dragBy(pointerDistanceX): { effectiveDistanceX, progress, direction, boundary }。
  - adapter.isStableAligned(): boolean。
  - adapter.isStableAt(pageDelta): boolean。
  - adapter.cancel()、adapter.end()、adapter.destroy()。
- Phase B controller 只调用这些高层方法，不读取 manager 或 scroller。

#### Implementation Steps

- [ ] Step 1: Write failing adapter capability and coordinate tests

Create client/src/utils/epubPageTurnAdapter.test.js:

~~~js
import { describe, expect, it, vi } from 'vitest';
import {
  createEpubPageTurnAdapter,
  toLogicalScroll,
  toPhysicalScroll,
} from './epubPageTurnAdapter.js';

function createRendition(overrides = {}) {
  const scroller = {
    clientWidth: 375,
    scrollLeft: 100,
    scrollWidth: 1375,
    style: {},
    addEventListener: vi.fn(),
  };
  const manager = {
    name: 'continuous',
    container: scroller,
    isPaginated: true,
    layout: { divisor: 1, pageWidth: 100 },
    settings: {
      axis: 'horizontal',
      direction: 'ltr',
      rtlScrollType: 'negative',
      snap: true,
    },
    snapper: {},
  };
  return {
    rendition: { manager, display: vi.fn().mockResolvedValue(undefined) },
    manager,
    scroller,
    ...overrides,
  };
}

describe('epub page-turn adapter core', () => {
  it('normalizes LTR, RTL default, and RTL negative coordinates', () => {
    expect(toLogicalScroll({
      scrollLeft: 240, maxScroll: 1000, direction: 'ltr', rtlScrollType: 'negative',
    })).toBe(240);
    expect(toLogicalScroll({
      scrollLeft: 760, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'default',
    })).toBe(240);
    expect(toLogicalScroll({
      scrollLeft: -240, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'negative',
    })).toBe(240);
    expect(toPhysicalScroll({
      logicalScroll: 240, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'default',
    })).toBe(760);
    expect(toPhysicalScroll({
      logicalScroll: 240, maxScroll: 1000, direction: 'rtl', rtlScrollType: 'negative',
    })).toBe(-240);
  });

  it.each([
    ['manager', ({ manager }) => { manager.name = 'default'; }],
    ['paginated', ({ manager }) => { manager.isPaginated = false; }],
    ['axis', ({ manager }) => { manager.settings.axis = 'vertical'; }],
    ['snap', ({ manager }) => { manager.snapper = null; }],
    ['page-width', ({ manager }) => { manager.layout.pageWidth = 0; }],
    ['direction', ({ manager }) => { manager.settings.direction = 'sideways'; }],
    ['rtl-scroll-type', ({ manager }) => {
      manager.settings.direction = 'rtl';
      manager.settings.rtlScrollType = 'reverse';
    }],
    ['alignment', ({ scroller }) => { scroller.scrollLeft = 140; }],
  ])('reports a deterministic %s capability failure', (reason, mutate) => {
    const fixture = createRendition();
    mutate(fixture);
    expect(createEpubPageTurnAdapter(fixture.rendition).inspect()).toMatchObject({
      available: false,
      reason,
    });
  });

  it('derives every drag write from the stable origin without drift', () => {
    const { rendition, scroller } = createRendition();
    const adapter = createEpubPageTurnAdapter(rendition);
    expect(adapter.begin('stable-cfi')).toMatchObject({
      available: true,
      origin: 100,
      pageWidth: 100,
    });

    adapter.dragBy(-40);
    adapter.dragBy(-80);
    expect(scroller.scrollLeft).toBe(180);
    expect(adapter.isStableAt(1)).toBe(false);
    expect(scroller.addEventListener).not.toHaveBeenCalled();
  });

  it('limits a missing-neighbor drag to a 28px transformed boundary offset', () => {
    const { rendition, scroller } = createRendition();
    scroller.scrollLeft = 0;
    const adapter = createEpubPageTurnAdapter(rendition);
    const session = adapter.begin('first-page');
    expect(session.canPrevious).toBe(false);

    const result = adapter.dragBy(200);
    expect(result).toMatchObject({
      boundary: true,
      direction: 'prev',
      effectiveDistanceX: 28,
    });
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.style.transform).toBe('translate3d(28px, 0, 0)');

    adapter.cancel();
    expect(scroller.style.transform).toBe('');
  });
});
~~~

- [ ] Step 2: Run the directed test and confirm the adapter is missing

Run: npm test --prefix client -- epubPageTurnAdapter.test.js

Expected: exit code 1 with a failed import for ./epubPageTurnAdapter.js.

- [ ] Step 3: Implement capability inspection, coordinate conversion, and origin-based drag

Create client/src/utils/epubPageTurnAdapter.js:

~~~js
import {
  clampDragDistance,
  dampBoundaryDistance,
} from './pageTurnGesture.js';

const ALIGNMENT_EPSILON_PX = 1;
const SUPPORTED_RTL_SCROLL_TYPES = new Set(['default', 'negative']);

function unavailable(reason) {
  return { available: false, reason };
}

export function toLogicalScroll({
  scrollLeft,
  maxScroll,
  direction,
  rtlScrollType,
}) {
  if (direction === 'ltr') return scrollLeft;
  if (direction === 'rtl' && rtlScrollType === 'default') {
    return maxScroll - scrollLeft;
  }
  if (direction === 'rtl' && rtlScrollType === 'negative') {
    return -scrollLeft;
  }
  return Number.NaN;
}

export function toPhysicalScroll({
  logicalScroll,
  maxScroll,
  direction,
  rtlScrollType,
}) {
  if (direction === 'ltr') return logicalScroll;
  if (direction === 'rtl' && rtlScrollType === 'default') {
    return maxScroll - logicalScroll;
  }
  if (direction === 'rtl' && rtlScrollType === 'negative') {
    return -logicalScroll;
  }
  return Number.NaN;
}

export function createEpubPageTurnAdapter(rendition, environment = {}) {
  let destroyed = false;
  let session = null;

  function inspect() {
    const manager = rendition?.manager;
    if (!manager || manager.name !== 'continuous') return unavailable('manager');
    if (!manager.isPaginated) return unavailable('paginated');
    if (manager.settings?.axis !== 'horizontal') return unavailable('axis');
    if (!manager.settings?.snap || !manager.snapper) return unavailable('snap');

    const scroller = manager.container;
    if (!scroller || !Number.isFinite(Number(scroller.scrollLeft))) {
      return unavailable('scroller');
    }

    const pageWidth = Number(manager.layout?.pageWidth) * Number(manager.layout?.divisor || 1);
    if (!Number.isFinite(pageWidth) || pageWidth <= 0) return unavailable('page-width');

    const direction = manager.settings?.direction || 'ltr';
    if (direction !== 'ltr' && direction !== 'rtl') return unavailable('direction');

    const rtlScrollType = manager.settings?.rtlScrollType;
    if (direction === 'rtl' && !SUPPORTED_RTL_SCROLL_TYPES.has(rtlScrollType)) {
      return unavailable('rtl-scroll-type');
    }

    const viewportWidth = Number(scroller.clientWidth || scroller.offsetWidth);
    const contentWidth = Number(scroller.scrollWidth);
    const maxScroll = Math.max(0, contentWidth - viewportWidth);
    if (!Number.isFinite(maxScroll)) return unavailable('scroller');

    const logicalScroll = toLogicalScroll({
      scrollLeft: Number(scroller.scrollLeft),
      maxScroll,
      direction,
      rtlScrollType,
    });
    if (!Number.isFinite(logicalScroll)) return unavailable('direction');

    const origin = Math.round(logicalScroll / pageWidth) * pageWidth;
    if (Math.abs(logicalScroll - origin) > ALIGNMENT_EPSILON_PX) {
      return unavailable('alignment');
    }

    return {
      available: true,
      reason: null,
      manager,
      scroller,
      pageWidth,
      origin,
      maxScroll,
      direction,
      rtlScrollType,
      canPrevious: origin - pageWidth >= -ALIGNMENT_EPSILON_PX,
      canNext: origin + pageWidth <= maxScroll + ALIGNMENT_EPSILON_PX,
    };
  }

  function readLogical(activeSession = session) {
    if (!activeSession) return Number.NaN;
    return toLogicalScroll({
      scrollLeft: Number(activeSession.scroller.scrollLeft),
      maxScroll: activeSession.maxScroll,
      direction: activeSession.direction,
      rtlScrollType: activeSession.rtlScrollType,
    });
  }

  function writeLogical(logicalScroll, activeSession = session) {
    if (!activeSession) return;
    const clamped = Math.min(activeSession.maxScroll, Math.max(0, logicalScroll));
    activeSession.scroller.scrollLeft = toPhysicalScroll({
      logicalScroll: clamped,
      maxScroll: activeSession.maxScroll,
      direction: activeSession.direction,
      rtlScrollType: activeSession.rtlScrollType,
    });
  }

  function setBoundaryOffset(offset) {
    if (!session) return;
    session.boundaryOffset = offset;
    session.scroller.style.transform = offset
      ? 'translate3d(' + offset + 'px, 0, 0)'
      : session.previousTransform;
  }

  function begin(stableCfi = null) {
    if (destroyed) return null;
    const capability = inspect();
    if (!capability.available) return null;
    session = {
      ...capability,
      stableCfi,
      boundaryOffset: 0,
      previousTransform: capability.scroller.style.transform || '',
    };
    return {
      available: true,
      pageWidth: session.pageWidth,
      origin: session.origin,
      canPrevious: session.canPrevious,
      canNext: session.canNext,
    };
  }

  function dragBy(pointerDistanceX) {
    if (!session) return null;
    let effectiveDistanceX = clampDragDistance(pointerDistanceX, session.pageWidth);
    const direction = effectiveDistanceX < 0 ? 'next' : 'prev';
    const missingNeighbor =
      (effectiveDistanceX < 0 && !session.canNext) ||
      (effectiveDistanceX > 0 && !session.canPrevious);

    if (missingNeighbor) {
      effectiveDistanceX = dampBoundaryDistance(effectiveDistanceX);
      writeLogical(session.origin);
      setBoundaryOffset(effectiveDistanceX);
    } else {
      setBoundaryOffset(0);
      writeLogical(session.origin - effectiveDistanceX);
    }

    return {
      boundary: missingNeighbor,
      direction,
      effectiveDistanceX,
      progress: Math.min(1, Math.abs(effectiveDistanceX) / session.pageWidth),
    };
  }

  function isStableAt(pageDelta) {
    if (!session || ![-1, 0, 1].includes(pageDelta)) return false;
    const target = session.origin + pageDelta * session.pageWidth;
    return Math.abs(readLogical() - target) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function isStableAligned() {
    const capability = session ? null : inspect();
    if (capability) return capability.available;
    if (!session) return false;
    const logical = readLogical();
    const nearest = Math.round(logical / session.pageWidth) * session.pageWidth;
    return Math.abs(logical - nearest) <= ALIGNMENT_EPSILON_PX &&
      Math.abs(session.boundaryOffset) <= ALIGNMENT_EPSILON_PX;
  }

  function end() {
    if (session) {
      session.scroller.style.transform = session.previousTransform;
    }
    session = null;
  }

  function cancel() {
    if (session) {
      writeLogical(session.origin);
      setBoundaryOffset(0);
    }
    end();
  }

  function destroy() {
    cancel();
    destroyed = true;
  }

  return {
    begin,
    cancel,
    destroy,
    dragBy,
    end,
    inspect,
    isStableAligned,
    isStableAt,
  };
}
~~~

- [ ] Step 4: Re-run the same directed test

Run: npm test --prefix client -- epubPageTurnAdapter.test.js

Expected: exit code 0 with eleven parameterized/regular cases passing; no touch listener is registered by application code.

- [ ] Step 5: Commit the adapter core

~~~powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js
git commit -m "feat: isolate epub page turn internals"
~~~

#### Done Criteria

- 适配层外没有新增 manager/scroller/snapper 读取。
- LTR、RTL default、RTL negative 往返换算准确。
- 能力失败返回明确 reason；无效页宽、方向或原点不会写 scroller。
- 重复 dragBy 从原点计算，不累积漂移；边界偏移不超过 28px。
- 定向测试通过。

#### Verification

Run: npm test --prefix client -- epubPageTurnAdapter.test.js

Expected: exit code 0; adapter core cases pass.

#### Regression Scope

- next 的逻辑坐标始终增加，prev 始终减少。
- spread none 下页宽等于 layout.pageWidth × divisor，单次移动不超过一个页宽。
- 适配层不注册另一套 touchstart/touchmove/touchend。

#### Out of Scope

- rAF 收尾、超时恢复和 React controller；由后续 Task 处理。
- 修改 epub.js 源码或锁文件。
- 支持 rtlScrollType=reverse；能力失败时由 basic 路径保底。

### Task 3：为适配层加入精确对齐动画、取消与稳定 CFI 恢复

Estimated effort: 60–90 minutes

#### Goal

适配层能够从当前拖动位置以 120–220ms 或 180ms ease-out 精确落到原点/相邻一页，并在取消、销毁或恢复时清理 rAF、transform 和会话。

#### Existing Behavior

Task 2 只能同步 dragBy 和立即 cancel；没有动画、在途 rAF 清理或 display(stableCfi) 恢复。

#### Required Change

注入可测试的 rAF/clock；animateTo 目标只允许 -1/0/1；每帧最多写一次 scroller 和回调一次视觉进度；cancel/destroy 精确恢复原点；recover 使用会话开始时的稳定 CFI。

#### Files

- Modify: client/src/utils/epubPageTurnAdapter.js
- Modify: client/src/utils/epubPageTurnAdapter.test.js
- Reference: client/src/utils/pageTurnGesture.js

#### Interfaces

- Consumes: Task 2 adapter session；environment.requestAnimationFrame/cancelAnimationFrame/now。
- Produces:
  - adapter.animateTo(pageDelta, { duration, onProgress }): Promise<{ status }>。
  - adapter.recover(): Promise<boolean>。
  - adapter.cancel({ restoreOrigin }): void。
  - status 为 completed | cancelled | unavailable。
- Phase B controller 使用 animateTo 后等待 public relocated；超时则调用 recover 并把会话切换 basic。

#### Implementation Steps

- [ ] Step 1: Extend the adapter tests with exact settle and cleanup cases

Append to client/src/utils/epubPageTurnAdapter.test.js:

~~~js
function createFrameDriver() {
  let callback = null;
  let time = 0;
  return {
    environment: {
      cancelAnimationFrame: vi.fn(() => { callback = null; }),
      now: () => time,
      requestAnimationFrame: vi.fn((next) => {
        callback = next;
        return 1;
      }),
    },
    step(nextTime) {
      time = nextTime;
      const next = callback;
      callback = null;
      next?.(nextTime);
    },
  };
}

it('settles exactly one page and rolls back exactly to the origin', async () => {
  const first = createRendition();
  const firstFrames = createFrameDriver();
  const firstAdapter = createEpubPageTurnAdapter(first.rendition, firstFrames.environment);
  firstAdapter.begin('stable-cfi');
  firstAdapter.dragBy(-40);
  const completed = firstAdapter.animateTo(1, { duration: 180 });
  firstFrames.step(0);
  firstFrames.step(180);
  await expect(completed).resolves.toEqual({ status: 'completed' });
  expect(first.scroller.scrollLeft).toBe(200);
  expect(firstAdapter.isStableAt(1)).toBe(true);

  const second = createRendition();
  const secondFrames = createFrameDriver();
  const secondAdapter = createEpubPageTurnAdapter(second.rendition, secondFrames.environment);
  secondAdapter.begin('stable-cfi');
  secondAdapter.dragBy(-40);
  const reverted = secondAdapter.animateTo(0, { duration: 120 });
  secondFrames.step(0);
  secondFrames.step(120);
  await expect(reverted).resolves.toEqual({ status: 'completed' });
  expect(second.scroller.scrollLeft).toBe(100);
  expect(secondAdapter.isStableAt(0)).toBe(true);
});

it('cancels rAF, restores inline styles, and recovers the stable CFI', async () => {
  const fixture = createRendition();
  fixture.scroller.style.transform = 'scale(1)';
  const frames = createFrameDriver();
  const adapter = createEpubPageTurnAdapter(fixture.rendition, frames.environment);
  adapter.begin('epubcfi(/6/2!/4/2)');
  adapter.dragBy(-40);
  const settling = adapter.animateTo(1, { duration: 180 });

  adapter.cancel({ restoreOrigin: true });
  await expect(settling).resolves.toEqual({ status: 'cancelled' });
  expect(frames.environment.cancelAnimationFrame).toHaveBeenCalledTimes(1);
  expect(fixture.scroller.scrollLeft).toBe(100);
  expect(fixture.scroller.style.transform).toBe('scale(1)');

  adapter.begin('epubcfi(/6/2!/4/2)');
  await expect(adapter.recover()).resolves.toBe(true);
  expect(fixture.rendition.display).toHaveBeenCalledWith('epubcfi(/6/2!/4/2)');

  adapter.destroy();
  expect(adapter.begin('later-cfi')).toBeNull();
});
~~~

- [ ] Step 2: Run the directed test and confirm animation methods are absent

Run: npm test --prefix client -- epubPageTurnAdapter.test.js

Expected: exit code 1 because animateTo and recover are not functions.

- [ ] Step 3: Add the animation environment and methods

In client/src/utils/epubPageTurnAdapter.js, extend the import:

~~~js
import {
  clampDragDistance,
  dampBoundaryDistance,
  easeOutCubic,
} from './pageTurnGesture.js';
~~~

Immediately inside createEpubPageTurnAdapter, add:

~~~js
  const requestFrame =
    environment.requestAnimationFrame || globalThis.requestAnimationFrame.bind(globalThis);
  const cancelFrame =
    environment.cancelAnimationFrame || globalThis.cancelAnimationFrame.bind(globalThis);
  const now = environment.now || (() => globalThis.performance.now());
  let animation = null;

  function stopAnimation() {
    if (!animation) return;
    cancelFrame(animation.frameId);
    const resolve = animation.resolve;
    animation = null;
    resolve({ status: 'cancelled' });
  }
~~~

Replace cancel, destroy, and the returned interface with the following exact implementation, and place animateTo/recover before them:

~~~js
  function animateTo(pageDelta, options = {}) {
    if (!session || ![-1, 0, 1].includes(pageDelta)) {
      return Promise.resolve({ status: 'unavailable' });
    }
    if (
      (pageDelta === 1 && !session.canNext) ||
      (pageDelta === -1 && !session.canPrevious)
    ) {
      return Promise.resolve({ status: 'unavailable' });
    }

    stopAnimation();
    const duration = Math.max(0, Number(options.duration) || 0);
    const startTime = now();
    const startLogical = readLogical();
    const startBoundaryOffset = session.boundaryOffset;
    const destination = session.origin + pageDelta * session.pageWidth;

    return new Promise((resolve) => {
      const tick = () => {
        if (!session || destroyed) {
          animation = null;
          resolve({ status: 'cancelled' });
          return;
        }

        const elapsed = now() - startTime;
        const linearProgress = duration === 0 ? 1 : Math.min(1, elapsed / duration);
        const easedProgress = easeOutCubic(linearProgress);
        const logical =
          startLogical + (destination - startLogical) * easedProgress;
        const boundaryOffset = startBoundaryOffset * (1 - easedProgress);

        writeLogical(logical);
        setBoundaryOffset(boundaryOffset);
        options.onProgress?.({
          pageWidth: session.pageWidth,
          progress: Math.min(
            1,
            Math.abs(logical - session.origin) / session.pageWidth,
          ),
        });

        if (linearProgress < 1) {
          animation.frameId = requestFrame(tick);
          return;
        }

        writeLogical(destination);
        setBoundaryOffset(0);
        options.onProgress?.({
          pageWidth: session.pageWidth,
          progress: Math.abs(pageDelta),
        });
        animation = null;
        resolve({ status: 'completed' });
      };

      animation = {
        frameId: requestFrame(tick),
        resolve,
      };
    });
  }

  async function recover() {
    const stableCfi = session?.stableCfi;
    cancel({ restoreOrigin: true });
    if (!stableCfi || typeof rendition?.display !== 'function') return false;
    await rendition.display(stableCfi);
    return true;
  }

  function cancel(options = {}) {
    stopAnimation();
    if (session && options.restoreOrigin !== false) {
      writeLogical(session.origin);
      setBoundaryOffset(0);
    }
    end();
  }

  function destroy() {
    cancel({ restoreOrigin: true });
    destroyed = true;
  }

  return {
    animateTo,
    begin,
    cancel,
    destroy,
    dragBy,
    end,
    inspect,
    isStableAligned,
    isStableAt,
    recover,
  };
~~~

- [ ] Step 4: Re-run the same directed test

Run: npm test --prefix client -- epubPageTurnAdapter.test.js

Expected: exit code 0; exact next-page, rollback, cancellation, recovery and destruction cases pass.

- [ ] Step 5: Commit adapter settling

~~~powershell
git add client/src/utils/epubPageTurnAdapter.js client/src/utils/epubPageTurnAdapter.test.js
git commit -m "feat: animate epub page alignment"
~~~

#### Done Criteria

- animateTo 只接受 -1、0、1，并精确结束在原点或一页目标。
- 拖动后的收尾从当前视觉位置继续，使用 ease-out，不跳回原点再启动。
- cancel/destroy 清理唯一在途 rAF 并恢复原 inline transform。
- recover 只 display 会话开始时的稳定 CFI。
- 定向测试通过。

#### Verification

Run: npm test --prefix client -- epubPageTurnAdapter.test.js

Expected: exit code 0; all adapter core and animation tests pass.

#### Regression Scope

- rAF 每帧最多执行一次 scroller 写入和一次 onProgress。
- 取消后不留下 rAF、边界 transform 或活动 session。
- 动画目标不从当前滚动位置再次 round，避免额外跨页。

#### Out of Scope

- relocated 的 1200ms 计时和 basic 模式；由 Phase B controller 负责。
- CSS 页缘和 React 每帧状态。
- 复杂弹簧、3D 或惯性多页动画。

### Task 4：接入 continuous + Snap 并只接受稳定 relocated

Estimated effort: 60–90 minutes

#### Goal

useEpubRendition 创建 continuous paginated Snap rendition，向组合层暴露适配器，并确保拖动/动画中间位置不更新 CFI、页码、章节、百分比或持久化；useReaderSettings 不再越过适配边界。

#### Existing Behavior

renderTo 未指定 manager/snap；每个 relocated 都立即进入进度链。useReaderSettings 通过 rendition.manager、rendition._layout、manager.settings.gap 和 manager.updateLayout 调整边距。

#### Required Change

配置 manager: continuous 与 snap: true；完成初始 display/边距后创建适配器；handleRelocated 在适配器存在且未稳定对齐时直接返回；清理和 PWA 恢复取消适配会话；边距重排仅使用公开 resize/display。

#### Files

- Modify: client/src/hooks/useEpubRendition.js
- Modify: client/src/hooks/useEpubRendition.test.jsx
- Modify: client/src/hooks/useReaderSettings.js
- Reference: client/src/utils/epubPageTurnAdapter.js
- Reference: client/src/hooks/useReadingProgressPersistence.js
- Reference: client/src/hooks/usePageProgress.js

#### Interfaces

- Consumes: createEpubPageTurnAdapter(rendition)；前置进度基线的 enqueueProgress。
- Produces:
  - useEpubRendition 返回值新增 pageTurnAdapter。
  - relocated 过滤条件 pageTurnAdapter == null || pageTurnAdapter.isStableAligned()。
  - applyReaderHorizontalMarginToRendition(rendition, margin, cfi) 保持原 Promise 接口，但不再读取私有字段。
- Phase B ReaderView 把 pageTurnAdapter 交给 usePageTurnController。

#### Implementation Steps

- [ ] Step 1: Extend the rendition test with manager options, stability gating, and cleanup

At the top of client/src/hooks/useEpubRendition.test.jsx, extend the hoisted mocks and add the adapter mock:

~~~js
const mocks = vi.hoisted(() => ({
  adapter: {
    cancel: vi.fn(),
    destroy: vi.fn(),
    isStableAligned: vi.fn(() => true),
  },
  createEpubPageTurnAdapter: vi.fn(),
  epubBook: null,
  getReadingProgress: vi.fn(),
}));

vi.mock('../utils/epubPageTurnAdapter.js', () => ({
  createEpubPageTurnAdapter: mocks.createEpubPageTurnAdapter,
}));
~~~

In beforeEach add:

~~~js
mocks.adapter.cancel.mockClear();
mocks.adapter.destroy.mockClear();
mocks.adapter.isStableAligned.mockReset().mockReturnValue(true);
mocks.createEpubPageTurnAdapter.mockReset().mockReturnValue(mocks.adapter);
~~~

Replace the current inline fixture setup with this exact helper, then keep the existing saved-progress assertions in the first test and add the second test:

~~~jsx
function createRenditionFixture({
  savedProgress = {
    cfi: 'epubcfi(/6/2!/4/2)',
    progress: 0.0227,
  },
} = {}) {
  const generated = deferred();
  const handlers = {};
  const location = {
    start: {
      cfi: savedProgress.cfi,
      href: 'chapter.xhtml',
      displayed: { page: 2, total: 10 },
    },
  };
  const locations = {
    generate: vi.fn(() => generated.promise),
    percentageFromCfi: vi.fn(() => 0.43),
  };
  const rendition = {
    currentLocation: vi.fn(() => location),
    destroy: vi.fn(),
    display: vi.fn().mockResolvedValue(undefined),
    getContents: vi.fn(() => []),
    hooks: { content: { register: vi.fn() } },
    off: vi.fn(),
    on: vi.fn((name, handler) => { handlers[name] = handler; }),
  };
  const epubBook = {
    destroy: vi.fn(),
    loaded: { navigation: Promise.resolve({ toc: [] }) },
    locations,
    renderTo: vi.fn(() => rendition),
  };
  mocks.epubBook = epubBook;
  mocks.getReadingProgress.mockResolvedValue({ progress: savedProgress });

  const enqueueProgress = vi.fn();
  const refs = {
    bookRef: { current: null },
    containerRef: { current: document.createElement('div') },
    currentCfiRef: { current: null },
    isClosingRef: { current: false },
    readerSettingsRef: { current: { horizontalMargin: 24 } },
    renditionRef: { current: null },
  };
  const args = {
    ...refs,
    applyReaderHorizontalMargin: vi.fn().mockResolvedValue(undefined),
    applyReaderSettings: vi.fn(),
    applyReaderSettingsToContents: vi.fn(),
    book: { id: 5 },
    enqueueProgress,
    error: '',
    flushPendingReaderSettings: vi.fn(),
    isLoading: true,
    loadReaderSettings: vi.fn().mockResolvedValue({ horizontalMargin: 24 }),
    markReaderSettingsLoaded: vi.fn(),
    resetPageProgress: vi.fn(),
    resetReaderSettingsLoad: vi.fn(),
    setError: vi.fn(),
    setIsLoading: vi.fn(),
    updatePageProgressFromLocation: vi.fn(),
  };
  return {
    args,
    enqueueProgress,
    epubBook,
    generated,
    handlers,
    location,
    rendition,
  };
}

it('keeps saved progress before locations and recomputes after generation', async () => {
  const fixture = createRenditionFixture();
  const { result } = renderHook(() => useEpubRendition(fixture.args));
  await waitFor(() => expect(fixture.rendition.display).toHaveBeenCalled());

  act(() => fixture.handlers.relocated(fixture.location));
  expect(result.current.progress).toBe(0.0227);
  expect(fixture.enqueueProgress).toHaveBeenLastCalledWith(
    expect.objectContaining({ progress: 0.0227 }),
  );

  await act(async () => {
    fixture.generated.resolve();
    await fixture.generated.promise;
  });
  await waitFor(() => expect(result.current.progress).toBe(0.43));
  expect(fixture.enqueueProgress).toHaveBeenLastCalledWith(
    expect.objectContaining({ progress: 0.43 }),
  );
});

it('uses continuous Snap and ignores relocated events until aligned', async () => {
  const fixture = createRenditionFixture({
    savedProgress: { cfi: 'stable-cfi', progress: 0.2 },
  });
  const { result, unmount } = renderHook(() => useEpubRendition(fixture.args));
  await waitFor(() => expect(fixture.epubBook.renderTo).toHaveBeenCalled());
  await waitFor(() => expect(result.current.pageTurnAdapter).toBe(mocks.adapter));

  expect(fixture.epubBook.renderTo).toHaveBeenCalledWith(
    fixture.args.containerRef.current,
    expect.objectContaining({
      flow: 'paginated',
      manager: 'continuous',
      snap: true,
      spread: 'none',
    }),
  );

  mocks.adapter.isStableAligned.mockReturnValue(false);
  act(() => fixture.handlers.relocated(fixture.location));
  expect(fixture.args.enqueueProgress).not.toHaveBeenCalled();

  mocks.adapter.isStableAligned.mockReturnValue(true);
  act(() => fixture.handlers.relocated(fixture.location));
  expect(fixture.args.enqueueProgress).toHaveBeenCalledTimes(1);
  expect(fixture.args.currentCfiRef.current).toBe(fixture.location.start.cfi);

  unmount();
  expect(mocks.adapter.destroy).toHaveBeenCalledTimes(1);
});
~~~

- [ ] Step 2: Run the directed rendition test and confirm the new expectations fail

Run: npm test --prefix client -- useEpubRendition.test.jsx

Expected: exit code 1 because renderTo lacks manager/snap, pageTurnAdapter is absent, or unstable relocated still enqueues progress.

- [ ] Step 3: Configure rendition and gate progress on stable alignment

In client/src/hooks/useEpubRendition.js:

~~~js
import { useCallback, useEffect, useRef, useState } from 'react';
import Epub from 'epubjs';
import { getReadingProgress } from '../api/readingApi.js';
import { createEpubPageTurnAdapter } from '../utils/epubPageTurnAdapter.js';
import { selectProgressForRelocation } from '../utils/readingProgress.js';
~~~

Add state/ref beside the existing state:

~~~js
const [pageTurnAdapter, setPageTurnAdapter] = useState(null);
const pageTurnAdapterRef = useRef(null);
~~~

At the start of the rendition effect reset both values:

~~~js
pageTurnAdapterRef.current?.destroy();
pageTurnAdapterRef.current = null;
setPageTurnAdapter(null);
~~~

Use these render options:

~~~js
rendition = epubBook.renderTo(containerRef.current, {
  width: '100%',
  height: '100%',
  manager: 'continuous',
  flow: 'paginated',
  gap: RENDITION_COLUMN_GAP,
  spread: 'none',
  snap: true,
});
~~~

Declare let adapter = null in the effect scope. At the first line of the existing updateFromLocation callback add:

~~~js
if (adapter && !adapter.isStableAligned()) return;
~~~

Immediately after initial display and applyReaderHorizontalMargin complete, create and expose the adapter:

~~~js
adapter = createEpubPageTurnAdapter(rendition);
pageTurnAdapterRef.current = adapter;
setPageTurnAdapter(adapter);
~~~

In effect cleanup, before destroying rendition, add:

~~~js
adapter?.destroy();
if (pageTurnAdapterRef.current === adapter) {
  pageTurnAdapterRef.current = null;
}
~~~

At the beginning of recoverVisibleReader's requestAnimationFrame callback add:

~~~js
pageTurnAdapterRef.current?.cancel({ restoreOrigin: true });
~~~

Return the adapter:

~~~js
return {
  currentHref,
  pageTurnAdapter,
  progress,
  toc,
};
~~~

- [ ] Step 4: Remove the second private manager boundary from reader settings

Replace applyReaderHorizontalMarginToRendition in client/src/hooks/useReaderSettings.js with:

~~~js
async function applyReaderHorizontalMarginToRendition(rendition, horizontalMargin, cfi) {
  if (!rendition) return;

  rendition.resize?.();
  applyReaderHorizontalMarginStylesToRendition(rendition, horizontalMargin);

  if (cfi) {
    await rendition.display(cfi);
    applyReaderHorizontalMarginStylesToRendition(rendition, horizontalMargin);
  }
}
~~~

The renderTo gap remains zero, so deleting manager.settings.gap does not change the configured column gap. Public rendition.resize() retains layout recalculation.

- [ ] Step 5: Re-run the same directed test and build the affected client

Run:

~~~powershell
npm test --prefix client -- useEpubRendition.test.jsx
npm run build --prefix client
~~~

Expected: both exit 0; the saved-progress test and continuous/stability test pass, and Vite produces client/dist.

- [ ] Step 6: Perform the one allowed implementation check and commit

Run:

~~~powershell
rg -n "rendition\??\.manager|rendition\??\._layout|snapper|scrollLeft" client/src --glob "!utils/epubPageTurnAdapter.js"
~~~

Expected: no output for newly introduced page-turn private access. Existing unrelated matches, if any, are recorded once as Backlog and are not edited unless they are one of the exact Task files.

Commit:

~~~powershell
git add client/src/hooks/useEpubRendition.js client/src/hooks/useEpubRendition.test.jsx client/src/hooks/useReaderSettings.js
git commit -m "feat: enable stable continuous rendition"
~~~

#### Done Criteria

- renderTo 使用 continuous、paginated、spread none、gap 0 和 Snap。
- 初始 display/边距完成后 pageTurnAdapter 可供组合层使用，卸载时销毁。
- 未稳定对齐 relocated 不改变 currentCfiRef、页码、章节、百分比或 outbox；稳定 relocated 保持前置进度语义。
- useReaderSettings 不再读取 rendition.manager、_layout、snapper 或 scrollLeft。
- 定向测试和客户端构建通过。

#### Verification

Run:

~~~powershell
npm test --prefix client -- useEpubRendition.test.jsx
npm run build --prefix client
~~~

Expected: both exit 0.

#### Regression Scope

- 保存的 2.27% 在 locations 未完成时仍不会重置为 0。
- content hook 和 rendered 重套继续覆盖 current 及相邻 views。
- PWA 前台恢复仍 resize/display 最近稳定 CFI。
- 目录跳转和边距改变仍使用公开 display，且最终页码刷新。

#### Out of Scope

- ReaderView pointer 状态机、页缘 CSS、Playwright 和实机验证；由 Phase B 处理。
- 更改进度 API、outbox 格式或服务端数据库。
- 升级、fork 或 patch epub.js。

## Phase A Final Verification

所有四个 Task 完成后只执行一次：

1. Build

   Run: npm run build --prefix client

   Expected: exit code 0。

2. Related tests

   Run:

   ~~~powershell
   npm test --prefix client -- pageTurnGesture.test.js epubPageTurnAdapter.test.js useEpubRendition.test.jsx
   ~~~

   Expected: exit code 0；仅运行本 Phase 新增/直接修改的测试文件。

3. Specification compliance check

   对照设计文档一次确认：常量集中、适配层为唯一私有边界、continuous+Snap 已启用、目标仅为原点或一页、未对齐 relocated 被过滤。

4. Preserved behavior check

   确认现有 useEpubRendition 进度测试仍覆盖保存百分比，content hook、目录和设置接口签名未被移除。

5. Severity gate

   - 只修复 P0：无法编译、无法启动、数据损坏风险。
   - 只修复 P1：明确违反设计或上述 Done Criteria。
   - P2/P3 全部写入 Backlog。
   - 修复 P0/P1 后只重复原 build/test 命令；同一命令连续失败两次即停止报告。
   - 不启动第二轮开放式质量审查；全部通过后立即结束 Phase A。

## Plan Text Self-Check

- [x] 设计中的纯逻辑、适配层、continuous/Snap、稳定 relocated 和唯一私有边界均映射到明确 Task。
- [x] 没有重新设计产品交互，也没有加入服务端、依赖升级或无关重构。
- [x] 四个 Task 均为 45–90 分钟、独立可提交交付。
- [x] 每个 Task 均包含 Goal、Existing Behavior、Required Change、Files、Interfaces、Implementation Steps、Done Criteria、Verification、Regression Scope 和 Out of Scope。
- [x] 当前 main 与 remediation worktree、PROJECT 旧约定、useReaderSettings 私有访问均已明确记录。
- [x] 非阻塞 reverse RTL 和性能遥测已放入 Backlog。
