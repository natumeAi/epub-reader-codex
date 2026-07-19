# Library Error Semantics Design

## Status

Approved in conversation on 2026-07-19 as part of the backlog remediation suite.

## Goal

区分真正的 shelf-load error 与上传、删除、拖动、建文件夹、移入文件夹或保存顺序产生的 operation error，确保只有加载失败显示“重试加载书架”。

## Dependency

本设计在三个首波批次全部完成并合并后实施。它与 Shelf Loader Request Ownership 共用 `useShelfData`，与 Reader Close Progress Refresh 共用 `App.jsx`，并与 Bookshelf Acceptance Reliability 共用 `bookshelf.css`；串行执行可避免 subagent 工作树之间产生交叉合并冲突。

## Constraints

- 保留现有操作失败文案和各操作开始时清除旧操作错误的行为。
- 不增加自动重试、toast 系统、关闭按钮或错误历史。
- 不修改 folder overlay 自己的 `folderError`。
- shelf、catalog 与 operation 三类错误保持独立，互不清除。

## Root Cause

`useShelfData` 只有一个通用 `error` state，并把 setter 传给上传、删除和拖动 hooks。`LibraryHome` 对任何该 state 的非空值都渲染“重试加载书架”，所以操作失败会得到错误的恢复动作。

## Chosen Design

`useShelfData` 使用两个独立 state：

- `shelfError` / `setShelfError`：只由 `loadShelf` 与 reader restore 的加载路径写入。
- `operationError` / `setOperationError`：供上传、删除与拖动相关 hook 写入。

`useUploadBooks` 仍可保持内部通用 setter 接口，但由 `useShelfData` 注入 `setOperationError`。`useShelfData` 对 App 返回 `shelfError`、`operationError` 和 `setOperationError`；不继续暴露含义模糊的通用 `error/setError`。

`App` 将 `setOperationError` 传给 `useBookDeletion` 与 `useLibraryDrag`，并把两个错误分别传给 `LibraryHome`。

`LibraryHome` 渲染：

- `shelfError`：现有 alert、错误文本和“重试加载书架”按钮。
- `operationError`：独立 alert，只显示原错误文本，不显示 shelf retry。

两类 alert 可以同时存在，因为它们代表独立失败；不新增优先级覆盖规则。

## Error Clearing Semantics

- 新 shelf load 开始只清除 `shelfError`。
- 新 upload/delete/drag operation 开始只清除 `operationError`。
- catalog error 继续由 `catalogError` 独立管理。
- 成功刷新 shelf 不隐式清除一次未被新操作取代的 operation error。

## Testing Strategy

1. `useShelfData.test.jsx` 证明 shelf 失败只设置 `shelfError`，operation setter 只设置 `operationError`，两者互不清除。
2. `LibraryHome.test.jsx` 证明 shelf error 显示 retry 并调用 `onRetryShelf`；operation error 显示原文但没有该 retry。
3. 现有上传、删除与拖动定向测试继续验证原错误文本通过 setter 传递，不扩大到完整 App 测试。

每项按 RED/GREEN 执行，并仅修改让原断言通过所需的 wiring。

## Success Criteria

- 操作失败不再显示“重试加载书架”。
- 真实 shelf 读取失败仍显示且只能显示该 retry。
- catalog retry 和 folder error 行为不变。
- 操作 hooks 的失败文案与清除时机不变。

## Out of Scope

- 新 toast、dismiss、错误队列、遥测或统一错误框架。
- 重写 upload/delete/drag 流程或 folder overlay 错误。
- loader request ownership、reader progress 和验收脚本。
