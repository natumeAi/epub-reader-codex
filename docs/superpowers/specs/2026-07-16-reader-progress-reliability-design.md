# Reader Progress Reliability Design

## Goal

防止 locations 尚未生成时把有效阅读百分比覆盖成 0%，并确保 PWA 后台切换、短暂断网或请求乱序时，最后阅读位置最终能够同步到服务端。

## Scope

- 修复已保存非零进度在重新打开后回退到 0%。
- 将阅读进度保存从 ReaderView 中拆到专用 hook。
- 使用 localStorage 保存每本书的最新待同步进度。
- 串行提交、前台恢复重试，并在 pagehide 使用 keepalive。
- 保持 reading_progress 数据表和现有 API JSON 结构不变。

## Non-goals

- 不增加多用户或跨设备冲突合并。
- 不改变 epub.js 的翻页动画、分页方式或 CFI 格式。
- 不把阅读设置重新改回数据库同步。

## Components

### client/src/utils/readingProgress.js

提供无 React 依赖的纯函数：

- sanitizeProgressRecord：校验 bookId、CFI、百分比和章节字段。
- selectProgressForRelocation：locations 未就绪时返回最后一个有效百分比；就绪后使用 percentageFromCfi 的有限数值并限制到 0 至 1。
- readProgressOutbox、writeProgressOutbox：读写版本化 localStorage 数据。
- isSameProgressSnapshot：判断请求成功后队列中的记录是否仍是当时发送的快照。

存储键固定为 epub-reader:pending-reading-progress:v1。数据按 bookId 建索引，每本书只保留最新记录。

### client/src/hooks/useReadingProgressPersistence.js

接收 bookId 和保存 API 函数，返回 enqueueProgress、flushProgress、retryPendingProgress。

行为规则：

1. enqueueProgress 先写 localStorage，再触发队列执行。
2. 同一时刻最多存在一个网络请求。
3. 请求成功后，只有队列内容仍等于已发送快照时才删除；否则立即发送更新后的值。
4. 请求失败时保留队列，不抛出未处理 Promise。
5. pagehide 调用 keepalive 模式的 flushProgress。
6. pageshow 和 visibilitychange 到 visible 时调用 retryPendingProgress。
7. hook 卸载时不清除失败队列。

### client/src/hooks/useEpubRendition.js

加载进度和 settings 后立即用服务端保存的百分比初始化 UI。locations.generate(1024) 异步执行，但维护 locationsReady 状态。

relocated 事件处理规则：

- locationsReady 为 false：更新 CFI、章节和页码，但百分比沿用最后有效值。
- locationsReady 为 true：从当前 CFI 计算百分比。
- locations 生成完成：读取 rendition.currentLocation，重新计算当前 CFI 的百分比并入队一次。
- locations 生成失败：继续保存 CFI，百分比保持最后有效值，不写入 0 作为降级值。

### client/src/api/readingApi.js

saveReadingProgress 增加可选 options 参数，支持 signal 和 keepalive。默认调用方式保持兼容。非成功响应抛出的 Error 必须携带 response.status，供持久化 hook 区分可重试和不可重试错误。

### client/src/components/reader/ReaderView.jsx

删除 saveTimerRef、pendingProgressRef、flushSave 和 scheduleSave 的本地实现，改用 useReadingProgressPersistence。ReaderView 仍负责组合 hook 和 UI，不直接管理网络重试。

## Data flow

打开书籍时：

1. 获取服务端 progress。
2. 将服务端百分比设为 lastValidProgress。
3. display 保存的 CFI。
4. relocated 在 locations 未就绪时以 lastValidProgress 入队。
5. locations 完成后重新计算，并以最新 CFI 和准确百分比替换队列。

保存时：

1. 最新记录同步写入 localStorage。
2. 单一 worker 读取快照并发送 PUT。
3. 成功后比较快照；无更新则删除，有更新则继续。
4. 失败则停止 worker，保留待同步值等待恢复事件。

## Error handling

- localStorage 不可用时仍允许阅读，退化为内存中的最新值。
- 400 或 404 属于不可重试错误：移除对应待同步记录，避免永久重试。
- 网络错误和 5xx 属于可重试错误：保留记录。
- keepalive 请求失败不会覆盖队列，也不会阻止页面隐藏。

## Testing

- 纯函数测试 locations 未就绪时保留 2.27%，不得返回 0。
- hook 测试连续入队 A、B 时网络请求严格串行，最终保存 B。
- hook 测试第一次请求失败后队列仍存在，visibilitychange 后重试成功。
- hook 测试旧快照成功时不得删除其后写入的新值。
- Playwright 预置 2.27% 和 CFI，重新打开 3.5 秒后，UI 与 API 仍为非零。
- Playwright 翻页后等待 locations 完成，UI 与 API 更新为准确的新百分比。

## Acceptance criteria

- 原 Review 中 2.27% 回退到 0% 的复现测试先失败，修复后通过。
- 页面关闭或切后台前的最后 CFI 最终可在恢复前台后同步。
- 不产生并行 PUT，也不存在旧请求覆盖新位置。
- 现有移动端翻页、目录、页码和设置验证继续通过。
