# Shelf Loader Request Ownership Design

## Status

Approved in conversation on 2026-07-19 as part of the backlog remediation suite.

## Goal

消除 `useShelfData` 中 shelf、catalog 与 recent loader 的乱序提交：同一资源发生重叠请求时，只有最新请求可以写入数据、错误、loaded 与 loading 状态。

## Constraints

- 保留 shelf、catalog、recent 三种资源彼此独立加载的现有架构。
- shelf 主请求完成后仍不等待 catalog 或 recent 才结束主 loading。
- 不修改服务端 API、响应结构、重试入口或上传流程。
- 不引入通用请求库、全局 store、AbortController 或缓存层。
- 旧请求仍可自然完成；只阻止它提交过期状态。

## Root Cause

`loadShelf`、`loadCatalog` 与 `loadRecentReading` 都允许被首次加载、重试、关闭 reader、上传或书籍不可用刷新重复调用。当前每次调用都无条件执行 state setter 和 `finally`，因此旧请求可以在新请求之后覆盖数据或错误，也可以在新请求仍运行时提前把 loading 设为 false。

## Chosen Design

`useShelfData` 为三种资源分别持有单调递增的 request version ref：

- `shelfRequestVersionRef`
- `catalogRequestVersionRef`
- `recentRequestVersionRef`

每个 loader 开始时递增对应 version 并捕获本次值。任何数据、错误、loaded、loading setter 执行前都必须确认捕获值仍等于 ref 当前值。

`loadShelf` 还使用 shelf version 保护 `restoreReaderBook` 回调，防止旧 shelf/recent 组合恢复过期 reader。`loadRecentReading` 无论是否仍为最新请求，都保持现有返回 `{ items }` 的调用契约；version 只控制 React 状态提交。`loadCatalog` 在旧请求失败时不得覆盖新请求的成功数据或错误状态。

不跨资源比较 version：一次较新的 catalog refresh 不会阻止 shelf 请求提交，反之亦然。

## Error and Loading Semantics

- 最新请求开始时清空自身错误并设置自身 loading。
- 旧请求成功或失败都不修改当前错误。
- 旧请求的 `finally` 不清除最新请求的 loading。
- 最新请求完成后保持现有错误文案与 last-good catalog 数据策略。
- `hasLoadedShelf` 与 `hasLoadedCatalog` 只由对应资源的最新请求完成路径设置。

## Testing Strategy

在 `useShelfData.test.jsx` 使用 deferred promises 按反序完成重叠请求：

1. 两次 catalog 请求中旧请求先结束时，loading 保持 true；新请求结束后只显示新数据/错误。
2. 两次 shelf 请求中新请求先成功、旧请求后失败时，保留新 shelf、无旧错误，且 `restoreReaderBook` 只接收最新组合。
3. 两次 recent 请求反序成功时，只提交最新 recent 数据。

每个行为先确认现有实现 RED，再添加最小 version gate 并运行同一定向测试。

## Success Criteria

- 任何旧请求都不能覆盖同资源的新数据或错误。
- 任何旧请求都不能提前结束新请求的 loading。
- 资源之间仍可独立完成和独立报错。
- 现有 last-good catalog、reader restore 与返回值契约保持不变。

## Out of Scope

- 取消网络请求、请求去重、缓存、超时、重试退避和离线支持。
- 拆分 shelf-load error 与 operation error；该问题由独立规格处理。
- reader 进度刷新时序、UI、CSS 与浏览器验收脚本。
