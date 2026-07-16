# Quality Foundation Design

## Goal

建立可重复、隔离、适合 CI 的测试基础，使后续四个修复子项目都能先写失败测试，再实现最小修复。此设计不改变现有产品行为、API 返回结构或视觉样式。

## Scope

- 服务端使用 Node.js 内置 node:test。
- 客户端使用 Vitest、jsdom 和 Testing Library。
- 移动端 Playwright 验证自动创建临时书库、生成最小 EPUB、启动临时服务并清理资源。
- 新增独立质量工作流，不修改现有 Docker 发布工作流。
- 为测试隔离增加 EPUB_DATA_DIR 配置；生产环境未设置时仍使用 server/data。

## Non-goals

- 不在本子项目修复阅读进度、EPUB 校验、watcher 或无障碍问题。
- 不改变 Dockerfile、docker-compose.yml 或 NAS 部署方式。
- 不引入覆盖率硬门槛；先建立稳定行为测试。

## Architecture

### Server tests

server/package.json 增加 test 脚本，执行 node --test --test-concurrency=1。测试文件放在 server/test/，每个测试文件使用 mkdtemp 创建独立的数据目录和数据库，结束后只清理自己创建的临时目录。

server/src/services/fileStorage.js 支持 EPUB_DATA_DIR。booksDir 和 coversDir 都从该目录派生；未配置时保持现有 server/data 路径。

server/test/helpers/createTestEnvironment.js 负责：

- 创建临时 data、books、covers 和 SQLite 路径。
- 在导入应用模块前设置 EPUB_DATA_DIR 和 DATABASE_PATH。
- 返回关闭数据库和清理临时目录的统一函数。

server/test/helpers/createEpubFixture.js 使用 adm-zip 生成最小合法 EPUB。adm-zip 在本阶段先作为 devDependency，EPUB 入库安全子项目再将其移动到 dependencies。

### Client tests

client/package.json 增加 test 和 test:watch 脚本。client/vitest.config.js 使用 jsdom，client/src/test/setup.js 在每个测试后清理 DOM、localStorage、mock 和 fake timers。

组件与 hook 测试使用 @testing-library/react；纯函数直接使用 Vitest。测试文件与被测文件相邻，命名为 *.test.js 或 *.test.jsx。

### Isolated mobile verification

client/scripts/verify-reader-mobile.mjs 在未提供 APP_URL 时执行以下流程：

1. 创建系统临时目录。
2. 调用服务端 EPUB fixture helper 生成一本最小书。
3. 以独立 EPUB_DATA_DIR、DATABASE_PATH 和固定测试端口启动 server/src/index.js。
4. 轮询 /api/health 和 /api/folders/shelf，直到书籍可用。
5. 优先使用本机 Chrome 或 Edge；不存在时使用 Playwright bundled Chromium。
6. 执行现有 375x667 触摸视口断言。
7. finally 中终止自己启动的进程并清理临时目录。

提供 APP_URL 时仍保留当前外部服务模式，方便人工验证已部署环境。

### Continuous integration

.github/workflows/quality.yml 使用 Node 22，包含 server 和 client 两个 job：

- server：npm ci、npm test、npm audit --omit=dev。
- client：npm ci、npm test、npm run build。
- mobile：安装 Chromium，执行 npm run verify:reader-mobile。

客户端 audit 暂不在本子项目设为门禁，因为已知 xmldom 公告将在 EPUB 入库安全子项目修复；该子项目完成时再加入。

## Error handling

- 临时服务在超时前未健康时，脚本输出 stdout、stderr 和最后一次 HTTP 错误。
- 清理逻辑不得删除用户目录，只允许删除由 mkdtemp 返回的路径。
- 子进程退出码、测试失败和浏览器断言失败都向上传播为非零退出码。

## Acceptance criteria

- server 目录执行 npm test，在空白临时目录中通过。
- client 目录执行 npm test 和 npm run build 均通过。
- 不设置 APP_URL 时，npm run verify:reader-mobile 能自行启动隔离服务并通过。
- 运行测试前后，server/data 和 client/reader-settings-narrow.png 均不发生变化。
- quality workflow 不依赖 Docker Hub secrets。

## Dependency order

本设计必须先完成。其余四个子项目依赖这里建立的测试命令、临时书库和 CI 基础。
