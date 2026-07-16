# Library Sync and API Correctness Design

## Goal

消除启动时重复解析，避免未变化 EPUB 被反复处理，并修复文件缓存、阅读进度 404、文件夹名称边界和文件夹预览 N+1 查询。

## Scope

- watcher 启动只触发一次全量同步。
- 数据库记录文件 mtime，启动扫描跳过未变化文件。
- change 事件仍强制刷新。
- EPUB 文件响应每次重验证。
- 不存在书籍的进度写入返回 404。
- 文件夹名称服务端限制为 80 字。
- 文件夹预览查询数量固定为两次。

## Non-goals

- 不引入内容哈希或后台任务队列。
- 不改变书架排序算法、文件夹嵌套规则或 API JSON 字段。
- 不删除 002_reader_settings 历史迁移。

## Database

新增 server/src/db/migrations/003_add_book_file_mtime.sql：

- books 增加可空 INTEGER 列 file_mtime_ms。
- 现有记录保持 null，第一次升级后扫描会解析并补齐。
- 时间值使用 Math.trunc(stat.mtimeMs)，处于 JavaScript 安全整数范围。

该迁移只增加列，不重建表，兼容现有 library.sqlite。

## Sync architecture

### server/src/services/bookDirectoryWatcher.js

删除函数入口处的立即 syncBookDirectory 调用。保留 ready 事件，并保证 ready 只调用一次全量同步。

add 事件处理新文件；change 事件调用 addBookFileToLibrary 时传入 forceRefresh: true；unlink 保持现有删除逻辑。

### server/src/services/bookLibrary.js

addBookFileToLibrary 在解析前读取 file size 和 mtime：

- 新文件：验证、解析、插入并保存 file_mtime_ms。
- 已有文件且 forceRefresh 为 false：size 与 mtime 都相同时直接返回现有格式化记录，不解析、不重写封面、不更新 updated_at。
- 已有文件且任一值变化，或 forceRefresh 为 true：重新验证、解析、更新元数据、封面、size、mtime 和 updated_at。

syncBookDirectory 逐本调用默认非强制模式，因此升级后的第二次启动开始可跳过未变化书籍。实时 change 强制刷新，覆盖同大小或 NAS 低精度时间戳场景。

## HTTP correctness

### Book file cache

server/src/routes/books.js 将 EPUB 文件响应改为 Cache-Control: private, no-cache。Express sendFile 继续提供 ETag 和 Last-Modified，浏览器每次打开时重验证，文件未变化可收到 304。

### Missing reading book

server/src/routes/reading.js 在 INSERT 前查询 books。不存在时抛出 status 404 的 Book not found；不得依靠外键错误转成 500。

### Folder name limit

server/src/services/folderLibrary.js 定义 MAX_FOLDER_NAME_LENGTH = 80。normalizeFolderName 保留当前 trim 和默认名称行为，但规范化结果超过 80 时抛出 status 400、code INVALID_FOLDER_NAME。

创建文件夹和重命名共用该规则，避免 UI 与直接 API 行为不同。

## Folder preview query

listFolders 使用两次查询：

1. 查询所有 folders 及 COUNT(b.id)，保持 sort_order、id 排序。
2. 使用 ROW_NUMBER() OVER (PARTITION BY folder_id ORDER BY sort_order, id) 查询每个文件夹前四本书。

第二次结果在 JavaScript 中按 folder_id 建 Map，再传给 formatFolder。无论文件夹数量多少，查询次数固定为两次。

getFolder 仍只查询一个文件夹和其四本预览，不强制复用列表查询。

## Error handling

- 首次同步中单本书失败必须记录并继续；由 EPUB 入库安全设计提供 InvalidEpubError。
- 全量同步的意外数据库错误仍使该轮同步失败并记录，避免静默部分成功。
- 404 和 400 返回现有 JSON error，并附稳定 code；500 由全局中间件记录。

## Testing

- watcher ready 一次只调用一次 syncBookDirectory。
- 迁移后的首次扫描解析旧记录并填充 mtime；第二次扫描不调用 parseEpubDetails。
- change 事件即使 size 与 mtime 相同也强制解析。
- 文件 HEAD/GET 响应包含 private, no-cache、ETag 和 Last-Modified。
- PUT 不存在 bookId 返回 404；存在书籍仍可 upsert。
- 81 字文件夹名返回 400，80 字成功，空名称继续使用默认名。
- 创建至少五个文件夹和各六本书，listFolders 返回正确 count 和每组前四本预览。

## Acceptance criteria

- 六本未变化书籍重启后产生零次元数据 UPDATE 和零次封面重写。
- 手动替换 EPUB 后下一次打开不会使用一小时内的旧缓存。
- API 不再把缺失书籍误报为 500。
- 文件夹列表的数据库查询往返固定为两次，不随文件夹数量增加。
