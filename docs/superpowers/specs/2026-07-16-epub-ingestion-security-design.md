# EPUB Ingestion Security Design

## Goal

只允许结构有效且资源规模受限的 EPUB 进入书库，同时消除客户端 xmldom 高危公告，不改变合法书籍的上传和手动导入体验。

## Scope

- 上传先进入 staging，校验成功后再移动到 books。
- 校验 EPUB ZIP 结构、必要文件和资源上限。
- 解析失败不再生成兜底书籍记录。
- 手动放入的坏文件跳过入库，但不阻断其他文件同步。
- 保留 epubjs 0.3.93，通过 npm overrides 固定 @xmldom/xmldom 0.8.13。

## Non-goals

- 不升级到 epubjs 0.4.2。
- 不实现 DRM、病毒扫描或内容审查。
- 不自动删除用户手动放入的无效文件。
- 不改变默认 100MB 上传压缩文件上限。

## Components

### server/src/services/epubValidation.js

新增 InvalidEpubError，包含 status 400 和 code INVALID_EPUB。

validateEpubArchive(filePath, options) 使用直接依赖 adm-zip 读取中央目录并执行：

- 文件扩展名为 .epub。
- 文件头为 ZIP 签名。
- 条目总数不超过 EPUB_MAX_ENTRIES，默认 10000。
- 所有条目声明的未压缩大小之和不超过 EPUB_MAX_UNCOMPRESSED_MB，默认 500MB。
- 单条目未压缩大小不超过 EPUB_MAX_ENTRY_MB，默认 100MB。
- 存在 mimetype，读取后的精确内容为 application/epub+zip。
- 存在 META-INF/container.xml。

校验阶段只解压 mimetype；其余条目只读取中央目录大小。通过后仍由 epub2 完成权威元数据和封面解析。

### server/src/services/fileStorage.js

增加 stagingDir 和 ensureStagingDirectory。multer 使用随机 UUID 文件名写入 staging，原始文件名仅保存在 req.file.originalname。

新增 moveValidatedUploadToBooks(uploadedPath, originalName)，使用现有安全文件名和冲突编号规则确定最终路径，再通过 renameSync 原子移动。

新增 cleanupStaleUploads，启动时删除 staging 中超过 24 小时的普通文件。函数只能遍历 stagingDir 的直接子文件，并使用路径边界检查，不能递归删除目录。

### server/src/services/bookLibrary.js

addBookFileToLibrary 改为严格模式：

- 先执行 validateEpubArchive。
- parseEpubDetails 失败时抛出 InvalidEpubError，不再捕获后继续插入。
- 只有验证和解析均成功后才保存封面并写数据库。
- 接受预先解析的 details，上传路径可避免验证后再次解析。

syncBookDirectory 对每个文件独立捕获 InvalidEpubError，记录文件路径和错误代码后继续下一个文件。无效文件不进入 current valid set；如果数据库曾错误追踪该文件，则移除旧记录和封面，但保留磁盘文件。

### server/src/routes/books.js

上传流程：

1. multer 写入 staging。
2. 校验并解析。
3. 移动到 books。
4. 写数据库并返回 201。

任一步失败都执行补偿清理：

- 移动前失败：删除 staging 文件。
- 移动后、数据库写入前失败：删除刚移动的 books 文件和新封面。
- InvalidEpubError 返回 400 和稳定的 INVALID_EPUB 错误码。
- 其他错误仍返回 500，并由全局错误处理记录。

### server/src/app.js

全局错误响应在 err.code 存在时返回 code 字段。status 500 的错误记录 method、path 和错误堆栈，但响应仍只暴露 Internal Server Error。应用初始化时调用 cleanupStaleUploads。

### Client dependency

client/package.json 增加 overrides，将 @xmldom/xmldom 固定为 0.8.13。重新生成 package-lock.json，不执行强制升级 epubjs。

server/package.json 将 adm-zip 从 devDependencies 移到 dependencies，因为生产校验代码直接导入它。

### Quality workflow

.github/workflows/quality.yml 在客户端 job 中增加 npm audit --omit=dev。该步骤从本子项目开始成为强制门禁。

## Error handling

- 限制超出、必要文件缺失、ZIP 损坏和 epub2 解析失败统一作为 400。
- 上传错误响应保留通用中文文案，并包含机器可读 code。
- 客户端 uploadBook 优先展示服务端 error；批量上传继续逐本处理，不因一本坏书中断。
- watcher 日志不得输出 EPUB 内容，只输出规范化路径和错误码。

## Testing

- 345 字节 JSON 改名 .epub 的上传测试必须返回 400，数据库和 books 目录无新增。
- 缺少 mimetype、错误 mimetype、缺少 container.xml 的 fixture 均返回 400。
- 超过条目数、总解压量和单条目限制的中央目录 fixture 均被拒绝。
- 合法最小 EPUB 返回 201，可读取文件并打开阅读器。
- 手动目录中同时存在合法和非法文件时，合法书入库，非法书跳过，扫描继续。
- 上传失败后 staging、books、covers 和数据库不存在孤儿记录。
- staging 中超过 24 小时的遗留文件会被清理，较新的上传临时文件不会被误删。
- client npm audit --omit=dev 返回 0，生产构建和移动端 Playwright 通过。

## Acceptance criteria

- 任意仅靠扩展名伪装的文件不能进入书库。
- 无效手动文件不会阻塞其后的合法文件。
- npm audit 不再报告 @xmldom/xmldom 公告。
- epubjs 版本保持 0.3.93，现有阅读行为无回归。
