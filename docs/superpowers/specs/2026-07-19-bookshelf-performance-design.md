# Bookshelf Performance Design

## Status

Approved in conversation on 2026-07-19.

## Goal

在不删减现有书架能力、不降低静止视觉质量的前提下，让 300–500 本个人书库在 3–4 年前的中端 Android 手机上保持流畅，并让低功耗 NAS 或迷你主机通过家庭 Wi-Fi 提供稳定、低写放大、低重复传输的书架服务。

本设计同时覆盖：

- 书架首次加载与从阅读器返回书架。
- 根书架滚动、搜索、筛选和自动排序。
- 根书架排序、创建文件夹、拖入文件夹、从文件夹移回根层和删除投放。
- 文件夹内排序。
- 服务端书架快照、增量写入、SQLite 排序和封面传输。
- 性能基线、视觉回归、错误恢复和渐进交付。

## Current Context

当前实现已经具备适合继续优化的基础：

- `ReaderView` 已通过 `React.lazy` 从书架首包拆出。
- 封面使用固定尺寸、`loading="lazy"` 和 `decoding="async"`。
- 拖拽意图发布已经使用 `requestAnimationFrame` 合并重复状态。
- 搜索和排序使用 memoized 派生数据，不发送逐字网络请求。
- SQLite 使用 WAL、外键、busy timeout，并已有根书架和文件夹排序索引。
- `listFolders` 使用批量窗口查询生成文件夹预览，不存在逐文件夹 N+1 查询。
- shelf、catalog、recent 已有独立错误语义与请求版本保护。

代码审计同时发现以下主要性能风险。

### Client hot paths

- `useLibraryDrag` 在文件夹书籍移回书架时，会在全局 pointer/mouse/touch move 事件中持续调用 `setFixedDragPreviewPoint`。该状态位于 `App` 组合链上，会让无关书架区域参与高频 React 渲染。
- 碰撞检测在移动期间遍历 droppable，并反复执行 `document.querySelector` 与 `getBoundingClientRect`。在 300–500 个项目时，主线程成本随项目数增长，布局读取还可能强制刷新 style/layout。
- `sortTargetKeyFromPoint` 每次调用都会重新构造 key 数组和候选数组，再线性扫描项目矩形。
- `DndContext` 位于 App 顶层；拖拽相关状态变化可能影响标题、搜索、继续阅读、文件夹和其他无关子树。
- 排序位移动画固定为 460ms。动画主要使用 transform，但长持续时间会放大拖动“跟手性差”的主观感受。
- 活动封面和目标封面叠加多层动态阴影；移动层若未稳定提升为合成层，可能反复栅格化。
- 只读视图虽不挂载 sortable hooks，但仍会一次性创建完整卡片 DOM。
- 搜索词变化时会重新规范化书籍字段、解析时间戳并重建文件夹统计；500 项仍可用，但没有为低端设备建立明确预算。

### Server and transport hot paths

- 首次加载并行请求 shelf、catalog、recent。shelf 与 catalog 重复传输书籍元数据和封面 URL。
- 创建文件夹、拖入文件夹、从文件夹移回根层和文件夹内排序成功后，mutation 已返回书架数据，客户端仍调用 `loadShelf()`，再次触发 shelf、catalog、recent。
- `updateShelfItemOrder` 使用完整 `listShelfItems` 校验当前成员，逐项更新整个书架，再使用完整 `listShelfItems` 构造响应。
- 现有排序协议发送完整顺序数组；一次相邻移动也会更新所有项目的 `sort_order` 与 `updated_at`。
- bootstrap 所需数据分散在多个响应中，缺少跨资源的一致 revision 和原子 client commit。
- 封面 URL 没有内容版本语义，无法在“绝不显示陈旧封面”的同时安全长期复用静态资源。

## Confirmed Constraints

- 目标规模为 300–500 本书；不为数千本或公共多租户书库提前设计。
- 主要客户端基线为 3–4 年前的中端 Android 手机，60Hz 屏幕。
- 现有 430 × 932 iPhone 14 Pro Max 逻辑视口继续作为布局基准；320px 窄屏和 760px 最大内容宽度继续回归。
- 服务端基线为低功耗 NAS 或迷你主机，通过家庭 Wi-Fi 提供单用户或家庭级访问。
- 允许增加向后兼容的 API、响应字段和 SQLite migration。
- 不增加 Service Worker 离线书架、离线 EPUB 或离线封面能力。
- 根书架手动顺序、单层文件夹和现有拖拽意图仍是产品权威规则。
- 用户确认采用“分层优化”方案，并确认安全的版本化封面 HTTP 缓存。

## Experience Compatibility Contract

性能优化不得通过可感知的视觉降级或交互删减达标。

以下行为属于硬性兼容约束：

- Mouse 激活距离保持 8px。
- Touch 长按激活保持 500ms，移动容差保持 8px。
- 排序意图停留时间保持 450ms；本设计只缩短落位动画，不改变意图锁定语义。
- 书籍中心区创建文件夹、文件夹中心区吸收书籍、真实间隙排序和删除投放规则保持不变。
- 根书架手动顺序仍是唯一可编辑权威顺序；搜索和自动排序继续只读。
- 固定封面尺寸、约三列手机布局、两行名称、木质背景和静止阴影层级保持不变。
- 文件夹打开、重命名、文件夹内排序、移入移出和空文件夹清理行为保持不变。
- `prefers-reduced-motion` 继续禁用非必要 transition/animation。
- 目录或最近阅读失败不得阻止根书架打开书籍和整理顺序。

允许用户感知到的变化只有：滚动更稳定、拖拽更跟手、松手更快落位，以及保存过程中更少出现整页加载或闪动。

## Non-goals

- 不增加多层文件夹、标签、智能书单或全文检索。
- 不增加服务端逐字搜索或 500 本规模下的分页。
- 不替换 EPUB 阅读器或翻页动画。
- 不在第一阶段重写完整 DnD 状态机。
- 不默认虚拟化可编辑书架；只有可验证的性能门槛失败才进入混合窗口化阶段。
- 不将 SQLite 移到网络文件系统，也不引入 Redis、外部搜索服务或独立 worker 服务。
- 不以长期 `will-change`、大量永久合成层或无限内存换取短时帧率。

## Considered Approaches

### A. Hot-path patches only

仅合并 pointer move、缓存部分矩形、memoize 卡片、缩短动画，并停止 mutation 后的重复刷新。

优点是改动较小；缺点是 500 个根层 sortable 节点和全量 SQLite 排序仍然没有结构性解决，无法为目标设备给出稳定上限。

### B. Layered optimization

隔离客户端每帧交互、建立空间索引、规范化快照、增加 revision/patch 协议、使用稀疏 rank，并以测量门槛决定是否启用混合窗口化。

该方案同时控制主线程、网络和 SQLite 写放大，且能保留现有交互语义，因此被选中。

### C. Full virtualization and DnD rewrite

统一虚拟化全部视图、替换碰撞引擎并增加服务端分页和搜索。

该方案可扩展到数千本，但实现和回归风险远高于 300–500 本目标，当前不采用。

## Performance Contract

所有指标使用固定的 50、300、500 本数据集。500 本测试必须同时覆盖“全部根层项目”和“书籍分布在多个文件夹”两种形态。

### Client budgets

- 搜索输入、快捷视图切换和自动排序从输入到结果 commit 的 p95 小于 100ms。
- 5 秒连续拖动期间至少采集 300 个 frame sample；frame duration p95 不超过 16.7ms。
- 5 秒连续拖动期间不得出现超过 50ms 的主线程 long task。
- 松手后视觉位置在 250ms 内稳定；默认排序落位 transition 为 240ms。
- 一次 pointer frame 最多触发一次坐标处理；纯坐标变化不得触发 `App`、Header、Search、Continue Reading 或完整 Grid 的 React commit。
- 500 项只读视图快速滚动不得出现空白窗口；窗口 overscan 固定为前后各 3 个 viewport height。
- 首屏固定尺寸 skeleton 或真实书架内容不得产生可感知 layout shift。

### Server and network budgets

- 500 本 bootstrap 服务端处理 p95 小于 150ms。
- 在 30Mbps 下行、10Mbps 上行、20ms RTT 的家庭 Wi-Fi 模拟条件下，bootstrap 端到端 p95 小于 500ms。
- 500 本 bootstrap 压缩响应不超过 200KB；封面不计入 JSON 响应。
- 每个成功的书架 mutation 只有一次网络请求，不跟随 shelf、catalog 或 recent 读取。
- 正常根书架或文件夹移动只更新一个 rank 行；只有 rank 空间耗尽或超过安全范围时允许整体重排。
- 版本未改变的前台恢复检查只读取 revision，并通过 HTTP revalidation 避免完整实体查询与传输。

服务端基准在限制为 2 CPU、512MB memory 的容器中执行；每项在 5 次预热后采集至少 30 次，报告 p50、p95 和最大值。真实低功耗 NAS 的最终端到端结果由用户在交付构建上验证。

## Architecture

设计拆分为四层，每层只有一个主要职责。

### Snapshot layer

服务端提供一个具备双 revision 的规范化书架快照。客户端使用 reducer 原子替换快照或应用 patch，不再让 shelf、catalog 和 recent 分别写入相互依赖的实体副本。

### Derived-view layer

搜索、筛选、文件夹统计和排序只读取快照。每个 library revision 只构建一次索引，query 变化只执行轻量匹配与已解析字段比较。

### Interaction hot-path layer

指针位置、预览 transform、几何快照和碰撞索引存在 ref 或专用视觉层中。React 只接收 drag start、意图目标变化、drop/cancel 等低频语义事件。

### Persistence layer

SQLite transaction 同时校验 base revision、修改实体或 rank、递增 revision 并生成 patch。客户端成功时不再读取完整书架；无法安全应用 patch 时才执行恢复快照。

## Client Design

### Normalized snapshot and selectors

现有 `useShelfData` 演进为单一 library snapshot reducer，内部状态包含：

- `libraryRevision`
- `readingRevision`
- `booksById`
- `foldersById`
- `shelfKeys`
- `recentEntries`
- shelf、catalog/recent fallback 各自的 loading/error 状态

bootstrap 或 fallback 结果通过一个 reducer action 原子提交。结构 patch 必须回显 `baseLibraryRevision`，并且只有 `baseLibraryRevision === currentLibraryRevision`、`incomingLibraryRevision === baseLibraryRevision + 1` 时才能应用。任何缺失实体、未知 key 或 library revision 跳跃都会拒绝整个结构 patch 并触发恢复 bootstrap。

阅读进度响应不要求相邻 revision，因为 Reader 可能连续保存多次。客户端使用现有 latest-request ownership 忽略较旧响应；只有 `incomingReadingRevision > currentReadingRevision` 时才应用 `recentEntry`，相等时视为幂等，较小时直接忽略。阅读 patch 不得修改 library revision 或结构实体。

每个 library revision 只构建一次：

- 书名、作者和文件夹名的 NFKC 小写搜索文本。
- `createdAt` 与 `readingUpdatedAt` 数值时间戳。
- `catalogBooksById`。
- 每个文件夹的最新添加和最新阅读统计。

query 输入保持同步；结果列表通过低优先级 React transition 提交。结果必须满足 100ms p95，不能使用网络逐字搜索。

### DnD component boundary

DnD provider 的影响范围收窄到书架网格、文件夹面板、删除区和拖拽视觉层。标题、搜索、继续阅读和 Reader 不消费每帧 drag context。

`DragVisualLayer` 独立持有活动预览 DOM。pointer frame 通过 ref 和 `translate3d` 更新它，不使用 `setFixedDragPreviewPoint` 驱动 App 状态。

`SortableShelfItem` 分成：

- 轻量 sortable wrapper：只处理 ref、attributes、listeners 和 transform。
- memoized visual subtree：封面、文件夹预览和 label；只有对应实体或意图视觉真正改变时才 commit。

### Pointer pipeline

拖拽事件按以下顺序处理：

1. Drag start 记录 active item、初始 pointer、scroll offset 和当前书架 revision。
2. 下一 animation frame 读取一次 shelf、delete zone 和项目 baseline geometry。
3. pointer/mouse/touch 来源统一为当前 DnD sensor 提供的坐标；不再同时注册三组重复全局 move listener。
4. move event 只覆盖 `latestPointerRef`。如果没有待处理 frame，则安排一个 rAF。
5. rAF 更新预览 transform，查询空间索引并计算 merge、absorb、sort 或 delete 意图。
6. 只有意图 type 或 target key 改变时才发布 React 语义状态；前一目标和当前目标以稳定 boolean prop 更新。
7. drop/cancel 清理 rAF、临时合成层、pointer capture、几何缓存和 drag session class。

文件夹书籍离开 `FolderOverlay`、关闭面板并插入临时根层项目后，几何缓存标记为 dirty；React commit 后的下一 rAF 只重建一次书架索引。

### Geometry and collision index

拖拽开始时将卡片 baseline rect 按视觉行分桶。每个 row 记录纵向范围、项目横向中心和 key。移动时先二分或常数扫描定位 row，再只检查当前 row 与相邻 row 的候选项目。

中心区、扩展删除区、排序停留计时和 active fallback 均沿用当前算法参数。页面滚动只用 scroll delta 修正 baseline viewport 坐标；resize、列数改变、项目增删或文件夹关闭才执行完整重建。

每帧禁止：

- `document.querySelector('.shelf-grid')`
- `document.querySelector('.folder-panel')`
- 对全部 droppable 执行 `getBoundingClientRect`
- 重建完整 item key/filter 数组

### Rendering and windowing

只读搜索、最近添加、自动排序和文件夹视图使用固定项目尺寸的 grid window：

- 根据容器宽度和固定封面宽度计算列数。
- 使用顶部/底部 spacer 保持完整滚动高度。
- 前后各渲染 3 个 viewport height。
- 每个渲染项目保留全局 `aria-posinset` 与 `aria-setsize`。
- 键盘焦点移动到窗口外项目时，先滚动并挂载目标，再转移焦点。
- 搜索结果变化时，若当前焦点项目消失，将焦点恢复到搜索输入，不落到未挂载节点。

可编辑根书架第一阶段保留完整 sortable DOM，但封面子树 memoized、非首屏图片 lazy、每帧碰撞不再依赖全量 DOM 测量。

完成客户端隔离、bootstrap、patch 和 sparse rank 后，在相同设备连续执行 3 次 500 根层项目拖动测试。如果任意 2 次未满足 frame p95 或 long-task 门槛，才启动混合窗口化：使用完整虚拟几何和 viewport sortable 节点，并必须支持自动滚动、键盘拖动和跨行落位。该阶段不能通过禁用功能绕过预算。

### Paint and image policy

- 默认落位 transition 为 240ms，并保留当前 cubic-bezier 空间连续性。
- 动画只改变 transform 和 opacity；静止阴影、封面高光和木质背景不删除。
- 仅 active preview 和正在让位的少量卡片临时提升为合成层；drag end 后立即移除 `will-change`。
- 活动阴影和目标光圈使用独立伪元素或视觉层做 opacity 交叉过渡，避免在移动元素上持续重算多层阴影。
- 首屏第一排封面优先请求；其余封面 lazy load。所有图片声明固定 width/height 或等价 aspect ratio。
- 文件夹预览继续最多显示 4 本；窗口外文件夹不得提前请求预览图片。
- sticky 搜索、静止封面阴影和默认背景不能为了达标被全局禁用。只有 trace 证明某效果在 drag session 中造成预算失败时，才允许把同等外观栅格化到静态层，并必须通过视觉回归。

## Server Data Contract

### Bootstrap endpoint

新增 `GET /api/library/bootstrap`。响应使用数组传输、client reducer 规范化：

```json
{
  "libraryRevision": 42,
  "readingRevision": 98,
  "books": [
    {
      "id": 1,
      "folderId": null,
      "title": "示例",
      "author": "作者",
      "coverUrl": "/covers/book-1-sha256-contenthash.webp",
      "createdAt": "2026-07-19 00:00:00",
      "readingProgress": 0.42,
      "readingUpdatedAt": "2026-07-19 01:00:00"
    }
  ],
  "folders": [
    {
      "id": 3,
      "name": "历史",
      "bookCount": 4,
      "previewBookIds": [8, 9, 10, 11]
    }
  ],
  "shelfKeys": ["book:1", "folder:3"],
  "recent": [
    {
      "bookId": 1,
      "progress": 0.42,
      "updatedAt": "2026-07-19 01:00:00"
    }
  ]
}
```

bootstrap 不返回 description、publisher、language、identifier、file path、file size 或 EPUB 内容。Reader 如需额外信息继续通过现有单书接口取得。

服务端先读取 revision。请求携带匹配的 `If-None-Match` 时直接 revalidate，不执行完整实体查询。完整响应使用：

- `ETag: "library-42-reading-98"`
- `Cache-Control: private, no-cache`
- JSON gzip 压缩

bootstrap 内的实体查询在同一个 SQLite read transaction 中完成，确保两个 revision 与实体快照一致。

### Bootstrap fallback

bootstrap 网络失败、非 2xx 或响应 schema 无效时，客户端回退现有加载流程：

1. shelf 作为关键请求独立完成。
2. catalog 和 recent 并行加载并保持独立错误。
3. fallback 成功后同样规范化为 snapshot。

旧 shelf、catalog、recent 路由在本规格范围内始终保持原有响应与错误语义；任何移除都需要单独规格和用户批准。

### Mutation protocol

新增 `/api/library` 下的 compact mutation contract；现有 `/api/folders`、`/api/books` 排序和移动路由保持兼容，直到迁移周期结束。

v2 mutation 路由固定为：

| Operation | Route |
| --- | --- |
| 根书架移动 | `PATCH /api/library/shelf/move` |
| 文件夹内书籍移动 | `PATCH /api/library/folders/:folderId/books/move` |
| 两本根层书籍创建文件夹 | `POST /api/library/folders` |
| 根层书籍移入文件夹 | `PATCH /api/library/folders/:folderId/import-book/:bookId` |
| 文件夹书籍移回根层 | `PATCH /api/library/folders/:folderId/books/:bookId/move-to-shelf` |
| 文件夹重命名 | `PATCH /api/library/folders/:folderId` |
| 书籍删除 | `DELETE /api/library/books/:bookId` |

除根书架移动外，其余请求沿用现有业务字段并增加必填 `baseLibraryRevision`。文件夹内排序使用 `activeBookId`、`beforeBookId`、`afterBookId`；根书架排序使用带 type 的 item key。

每个结构性请求必须携带 `baseLibraryRevision`。移动请求传输 active key 和相邻 key，而不是完整顺序数组。示例：

```json
{
  "baseLibraryRevision": 42,
  "activeKey": "book:18",
  "beforeKey": "folder:3",
  "afterKey": "book:7"
}
```

首项移动时 `beforeKey` 为 null，末项移动时 `afterKey` 为 null；其他情况两个邻居都必须存在并且在 base revision 中相邻。服务端验证 active 与邻居属于同一目标容器。

统一成功响应：

```json
{
  "baseLibraryRevision": 42,
  "libraryRevision": 43,
  "readingRevision": 98,
  "patch": {
    "upsertBooks": [],
    "removeBookIds": [],
    "upsertFolders": [],
    "removeFolderIds": [],
    "shelfKeys": null,
    "recent": null
  }
}
```

响应中的 `baseLibraryRevision` 必须等于请求值。纯排序成功时 `shelfKeys` 为 null，客户端保留已验证的乐观顺序。创建、归属移动和删除返回完整但精简的 `shelfKeys`，并 upsert 受影响书籍、文件夹和 preview IDs。删除影响最近阅读时返回新的最多 10 条 `recent`。

现有 `PUT /api/reading/:bookId` 向后兼容地增加 `readingRevision` 与 `recentEntry`。Reader close 使用最后一次成功响应更新书架快照，不再读取 recent 与 catalog。

### Conflict semantics

如果 `baseLibraryRevision` 不等于当前 revision，服务端不修改任何数据，返回：

```json
{
  "error": "Library revision conflict",
  "code": "LIBRARY_REVISION_CONFLICT",
  "libraryRevision": 44
}
```

HTTP status 为 409。客户端放弃乐观 patch、获取 bootstrap，并显示“书架已在其他位置更新”。

## SQLite Design

### Revision state

增加附加式 migration：

```sql
CREATE TABLE library_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  library_revision INTEGER NOT NULL DEFAULT 0,
  reading_revision INTEGER NOT NULL DEFAULT 0
);

INSERT INTO library_state (id, library_revision, reading_revision)
VALUES (1, 0, 0);
```

revision 更新规则：

- 上传、目录 watcher 新增/更新/删除、书籍删除、文件夹创建/重命名、归属变化和任何顺序变化递增 `library_revision`。
- 阅读进度写入递增 `reading_revision`。
- 删除带 reading progress 的书籍同时递增两个 revision。
- 未改变任何行的幂等操作不得递增 revision。
- 实体更新与 revision 递增必须位于同一 transaction。

### Sparse rank

现有 `sort_order` 继续作为整数 rank，不增加平行排序列。

- 初始或整体重排使用 1024 间隔。
- 插入两个邻居之间且 gap 大于 1 时，新 rank 为两者整数中点。
- 插入末尾时使用 `previous + 1024`。
- 插入开头时优先使用 `floor(next / 2)`；如果结果不小于 next 或不在安全整数范围内，则先重排。
- gap 小于等于 1，或绝对 rank 超过 `10^12` 时，在同一 transaction 内按 1024 间隔重排目标容器，再重试一次移动。
- 重排后仍无法满足邻居约束视为服务端错误并回滚整个 transaction。

根书架跨 books/folders 两张表，但在同一 transaction 中按统一 key 序列读取邻居和更新对应表。文件夹内排序只更新 books。

### Query changes

- 结构性并发校验使用 `library_state` 和轻量 key/rank 查询，不调用包含封面预览的 `listShelfItems`。
- bootstrap 使用明确字段投影，不使用 `SELECT *`。
- 增加 `reading_progress(updated_at DESC, book_id DESC)` 索引。
- 继续使用现有 `idx_books_shelf_sort_order` 和 `idx_folders_sort_order`。
- 文件夹预览继续使用单个窗口查询，并只投影 preview 所需字段。
- 常用 statement 按 database instance 缓存在 `WeakMap` repository 中；测试注入的不同 database 不共享 prepared statement。

不默认修改 SQLite durability pragma。只有基准证明 fsync 是剩余瓶颈且用户明确接受耐久性取舍时，才单独评估 `synchronous` 设置。

## Cover Delivery

封面采用内容寻址文件名：`book-<bookId>-<sha256>.<ext>`。SHA-256 基于最终发送给浏览器的封面字节计算；同一路径永不被不同内容覆盖，mtime 不参与版本计算。

- 内容寻址 URL 响应使用 `Cache-Control: private, max-age=31536000, immutable`。
- 封面内容变化必须先写入新的内容寻址文件，再在同一 library transaction 中发布新 URL。
- 无版本的旧封面 URL 保持 `no-cache`，用于迁移兼容。
- 不将封面加入 Service Worker precache，不提供离线书架保证。
- EPUB 文件继续 `private, no-cache`。

Phase 5 启用 immutable header 前，对现有封面执行有界批次 backfill：计算最终字节 SHA-256、写入新路径、更新 book row 并递增 library revision。未 backfill 的行继续使用旧 URL 与 `no-cache`。数据库提交后，只有确认旧路径未被其他 book row 引用时才 best-effort 删除；删除失败由启动时的孤儿封面清理处理，不能回滚已经成功的 library transaction。

该策略允许浏览器安全复用已验证内容，不会因为长期缓存显示旧封面。

## Error Handling and Recovery

### Client mutation failure

- 普通网络或 5xx：保留最后可信 snapshot，回滚本次乐观顺序，显示 operation error，不显示 shelf retry。
- 409：放弃本次 patch，重新 bootstrap；新快照到达前保持当前内容可见但禁止下一次结构写入。
- patch revision 跳跃、未知 key 或缺失实体：不部分应用，直接恢复 bootstrap。
- 恢复 bootstrap 也失败：恢复到最后可信内存 snapshot，保持只读打开能力，并显示重新连接操作。

### Partial read failure

- bootstrap 失败进入 legacy fallback。
- fallback shelf 失败显示书架重试。
- fallback catalog 失败保留最后一次成功目录，禁用搜索/自动排序重试入口，但根书架可用。
- recent 失败隐藏或保留最后可信继续阅读，不影响 shelf。

### Cover failure

图片错误切换到固定尺寸占位，不删除卡片、不改变 grid 几何、不触发排序测量。版本化 URL 返回 404 时允许单次 bootstrap revalidation；不得无限重试。

### Foreground and external changes

应用回到前台时使用 bootstrap HTTP revalidation。revision 未改变时不提交 React snapshot；改变时原子替换。目录 watcher、其他标签页或其他客户端造成的变化通过 revision 被发现。

## Observability

性能采集只在测试/诊断构建开启，不持续记录用户书名或阅读内容。

客户端记录：

- bootstrap fetch、parse、normalize 和 first shelf commit。
- search/filter/sort 输入到 commit。
- drag activation、每帧 JS、style/layout、paint、drop-to-settle。
- React commit 次数和耗时。
- long task、frame p50/p95/max 和 dropped-frame ratio。

服务端通过 `Server-Timing` 或测试注入记录：

- revision read。
- snapshot SQL。
- serialization。
- compression。
- mutation SQL read count、write count 和 transaction duration。

生产日志不输出完整 payload、书名、文件路径、CFI 或搜索词。

## Testing Strategy

### Fixtures

提供确定性 50、300、500 本 fixture：

- 全部根层书籍。
- 根层书籍与至少 50 个文件夹混合。
- 文件夹各含 1、2、4 和多于 4 本书。
- 有/无封面、有/无作者、有/无阅读进度。
- 相同标题、中文/英文混合和缺失排序字段。
- rank 有充足 gap、单个耗尽 gap 和需要安全范围重排。

fixture 生成必须用于测试数据库或内存数据库，不修改用户书库。

### Client unit and component tests

- pointer event 在一个 frame 内多次发生只处理最后坐标一次。
- 坐标变化不触发 App 和无关首页组件 commit。
- 空间索引与当前中心区、吸收、排序、删除算法在边缘/跨行场景结果一致。
- scroll delta、resize、列数变化和文件夹关闭只按规则失效几何缓存。
- drag cancel/unmount 清理 rAF、listener、pointer capture、临时 class 和 layer promotion。
- normalized reducer 原子替换 snapshot，拒绝 revision 跳跃与不完整 patch。
- 搜索索引在 revision 不变时不重建。
- window overscan、spacer 高度、焦点转移、ARIA 总数/位置和搜索结果变化正确。
- reduced motion、键盘拖动和 screen-reader label 不回归。

### Server tests

- bootstrap 返回一致 revision 与规范化实体，字段不包含 EPUB 路径和非必要大字段。
- 匹配 ETag 时不运行完整实体查询。
- bootstrap failure fallback 的旧接口仍保持现有语义。
- 每种 mutation 校验 base revision 并在冲突时零写入。
- 正常移动只更新一个 rank；gap 耗尽时只重排目标容器。
- revision 与实体更新原子提交；transaction 失败两者都回滚。
- watcher add/change/unlink、上传、删除和 reading save 按规则递增 revision。
- reading progress save 返回 recent entry，关闭 reader 不需要 catalog/recent follow-up。
- 版本化封面缓存头正确，内容变化产生新 URL。

### Browser verification

在 430 × 932、360 × 800、320px 宽和 760px max content viewport 验证：

- 首次加载、前台 revalidation 和 bootstrap fallback。
- 500 项滚动、搜索、视图切换和排序。
- 5 秒连续拖动、跨行、页面自动滚动、首尾落位和取消。
- 创建文件夹、拖入、拖出、文件夹内排序和删除。
- mutation 网络失败、409 和 patch recovery。
- 每个成功 mutation 只有一次请求且没有后续 shelf/catalog/recent。
- reduced motion、触摸 activation、键盘拖动和焦点恢复。

浏览器脚本输出 trace 和机器可读指标；受运行环境波动影响的帧率使用同一受控环境连续 3 次判定，不使用单次 CI 数值做结论。

### Visual regression

使用同一 fixture 和稳定状态截图比较优化前后：

- 静止书架、sticky 搜索和继续阅读。
- active preview。
- sort 让位。
- merge/absorb/delete 目标。
- 文件夹打开和跨文件夹拖动。
- 失败回滚与占位封面。

静止状态不接受阴影、尺寸、间距、背景或文字层级的非设计变化。动画录屏逐帧检查项目路径连续、无闪白、无瞬移和 250ms 内稳定。

### Real-device ownership

自动化和桌面模拟不能替代真实低端 Android 的触摸、GPU 和图片解码表现。实现方提供带构建标识的测试步骤和性能报告；用户在代表性 3–4 年前中端 Android 与实际低功耗 NAS 上完成最终验收。在用户确认前不得声称实机验收通过。

## Delivery Sequence and Gates

### Phase 0: Baseline

建立 fixture、trace、Server-Timing 和现有行为/视觉基线。没有基线数据不得开始声称优化收益。

### Phase 1: Client hot-path isolation

实现 DragVisualLayer、rAF pointer pipeline、memoized visual subtree 和 geometry index，继续使用旧 API。必须先通过现有拖拽语义和视觉回归。

### Phase 2: Bootstrap and normalized reducer

增加 additive migration、bootstrap、ETag、client snapshot reducer 和 legacy fallback。此阶段不删除旧 loader。

### Phase 3: Revision and compact structural mutations

增加 base revision、结构 patch response、reader recent entry 和前台 revalidation。创建文件夹、归属移动、重命名和删除成功后停止 `loadShelf()`；根书架和文件夹内排序在本阶段仍使用旧全量排序路由，但成功后不追加读取。

### Phase 4: Sparse rank

接入根书架和文件夹内 active/neighbor move 路由，并切换为单 rank 更新。完成后新客户端不再调用旧全量排序路由；旧路由继续保留兼容。

### Phase 5: Read-only windowing and cover delivery

启用只读 grid window、焦点/ARIA 支持、首屏图片优先级和版本化封面缓存。

### Phase 6: Conditional editable windowing

只有 Phase 1–5 后，500 根层项目在同一设备 3 次测试中至少 2 次违反 frame p95 或 long-task 门槛时才执行。完成后必须重新验证自动滚动、键盘拖动和全部归属操作。

每个 phase 必须满足：

- 定向测试通过。
- 全量 client/server 测试通过。
- 行为回归通过。
- 静止视觉回归通过。
- 当前 phase 对应性能指标达到门槛。

## Implementation Decomposition

该设计是一个顺序性能计划，不作为单个超大 implementation batch 执行：

1. Baseline + Client Hot Path：Phase 0–1，先证明拖拽隔离的独立收益。
2. Snapshot Loading：Phase 2，独立交付 bootstrap、normalized reducer 和 fallback。
3. Revision + Persistence：Phase 3–4，交付 compact mutation 与 sparse rank。
4. Read-only Rendering + Covers：Phase 5，交付 windowing、可访问性和内容寻址封面。
5. Editable Windowing：Phase 6 仅在量化 gate 触发后重新进入 design/spec/plan 流程，不在前四个 implementation plan 中预先实现。

每个实施单元都有独立计划、测试 checkpoint 和提交边界；前一单元未通过验收时不得开始下一单元。规格获最终批准后，下一步只为第一个实施单元编写 implementation plan。

## Migration and Rollback

- migration 只新增 `library_state` 和 reading recent index；现有表和 `sort_order` 含义保持兼容。
- 旧客户端忽略 revision table，仍可读取现有接口。
- 新客户端可通过配置关闭 bootstrap/compact mutation，回退旧 loader 和旧写接口。
- sparse rank 仍是普通整数，旧接口读取顺序不受影响；旧全量排序会重新生成固定间隔。
- 版本化封面 URL 与旧静态路由并存。
- 本规格不移除旧接口；移除需单独设计和用户批准。

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 缩短动画显得生硬 | 保留 easing 和空间连续性，固定 240ms，并通过录屏比较而非删除动画。 |
| window 快速滚动短暂空白 | 前后各 3 viewport overscan、固定 spacer 和 500 项浏览器测试。 |
| window 破坏键盘/读屏 | 全局 ARIA 位置、焦点驱动挂载和独立可访问性回归。 |
| 乐观写失败导致跳回 | 受控回滚、operation error、冲突 bootstrap；失败时不清空书架。 |
| bootstrap 把局部失败耦合 | 保留 legacy fallback 和独立 shelf/catalog/recent 错误语义。 |
| patch 造成客户端不一致 | 原子 reducer、连续 revision、未知实体即恢复完整 snapshot。 |
| sparse rank 边界错误 | 邻居校验、目标容器 transaction、耗尽时重排并覆盖首尾/溢出测试。 |
| 长期封面缓存显示旧图 | 内容版本 URL；先写新资源，再发布新 URL。 |
| 合成层过多增加内存 | 只提升 active 和少量让位卡片，drag end 立即清理。 |
| 基准对设备不代表 | 受控实验用于回归，最终由真实 Android + NAS 验收。 |

## Acceptance Criteria

- 50、300、500 本数据集均通过功能、错误、可访问性和视觉回归。
- 500 本搜索/视图/排序 p95 小于 100ms。
- 代表性中端 Android 的 5 秒拖动 frame p95 不超过 16.7ms，且无超过 50ms long task。
- drop 后 250ms 内视觉稳定，现有 drag activation 和意图规则不变。
- 坐标更新不再触发 App 和无关书架区域 React commit。
- 500 项只读快速滚动无空白窗口，焦点和 ARIA 位置正确。
- 低功耗服务端 bootstrap p95 小于 150ms，模拟家庭 Wi-Fi 端到端 p95 小于 500ms。
- 500 本压缩 bootstrap 不超过 200KB。
- 每个成功书架 mutation 仅一次请求，无 shelf/catalog/recent follow-up。
- 正常移动仅更新一个 rank；重排只发生在明确的 gap/安全范围条件下。
- revision 冲突、patch 不连续、bootstrap 失败和封面失败均能恢复，不清空最后可信书架。
- 静止视觉没有封面尺寸、阴影、背景、间距或文字层级降级。
- 版本化封面能够复用且内容变化不会显示旧图。
- 用户在代表性 Android 与实际 NAS 上完成最终实机确认后，才视为整体性能优化验收完成。
