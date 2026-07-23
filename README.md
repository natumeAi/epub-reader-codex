<div align="center">
  <img src="./client/public/icon-192.png" width="96" height="96" alt="EPUB Reader 图标">

  # EPUB Reader

  **一座住在你 NAS 里的私人 EPUB 书架。**

  上传、整理并沉浸阅读自己的 EPUB 收藏，专为手机竖屏和自托管场景打造。

  <p>
    <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker Ready">
    <img src="https://img.shields.io/badge/EPUB-Reader-8B5CF6" alt="EPUB Reader">
    <img src="https://img.shields.io/badge/Mobile-First-111827?logo=pwa&logoColor=white" alt="Mobile First">
    <img src="https://img.shields.io/badge/Data-Self--Hosted-16A34A" alt="Self-hosted">
  </p>

  [快速部署](#-快速部署) · [功能亮点](#-功能亮点) · [数据与备份](#-数据与备份) · [常见问题](#-常见问题)
</div>

> [!IMPORTANT]
> EPUB Reader 是面向个人局域网使用的自托管应用，目前不包含账号和访问控制。请不要在没有反向代理鉴权或其他安全措施的情况下直接暴露到公网。

## ✨ 应用预览

<p align="center">
  <img src="./docs/superpowers/evidence/bookshelf-performance/phase-1-static-shelf.png" width="360" alt="EPUB Reader 移动端书架界面">
  &nbsp;&nbsp;
  <img src="./docs/superpowers/evidence/bookshelf-performance/phase-1-folder-open.png" width="360" alt="EPUB Reader 文件夹界面">
</p>

## 🌟 功能亮点

| | 能力 | 说明 |
|---|---|---|
| 📚 | **私人书库** | 上传 EPUB，自动解析书名、作者和封面；也可以把文件复制到数据目录自动入库。 |
| 🗂️ | **自由整理** | 支持搜索、排序、拖动换位、拖动创建文件夹，以及书籍在书架和文件夹之间移动。 |
| 📖 | **沉浸阅读** | 基于 epub.js，支持目录跳转、阅读进度保存、继续阅读和分页页码。 |
| 🎨 | **阅读外观** | 可调整字体、字号、页边距、行距、字距，并提供白色、暖色、护眼和夜间主题。 |
| 👆 | **自然翻页** | 支持左右点按、触摸横向拖动、键盘方向键，以及性能不足时的可靠降级。 |
| 📱 | **移动优先** | 重点适配手机和平板竖屏，可作为 PWA 添加到主屏幕并以独立窗口启动。 |
| 💾 | **数据自持有** | SQLite 数据库、EPUB 原文件和封面全部保存在你挂载的本地目录中。 |
| 🐳 | **容器部署** | 提供 Docker Hub 镜像、健康检查和持久化目录，一份 Compose 文件即可启动。 |

## 🚀 快速部署

### 准备条件

- 一台安装了 Docker 与 Docker Compose 的 NAS、Linux 主机或其他设备
- 可用端口 `4080`
- 用于保存书库数据的磁盘空间

### 1. 创建目录

```bash
mkdir -p epub-reader
cd epub-reader
```

### 2. 创建 Compose 文件

新建 `compose.yaml`，写入以下内容：

```yaml
name: epub-reader

services:
  epub-reader:
    image: lshym123/epub-reader:latest
    container_name: epub-reader
    restart: unless-stopped
    environment:
      NODE_ENV: production
      HOST: 0.0.0.0
      PORT: 3000
    ports:
      - "4080:3000"
    volumes:
      - ./data:/app/server/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

> [!TIP]
> `4080:3000` 中，`4080` 是浏览器访问使用的宿主机端口。若端口被占用，只需把左侧数字改为其他可用端口，例如 `8080:3000`。

### 3. 启动应用

```bash
docker compose up -d
```

查看运行状态：

```bash
docker compose ps
```

容器显示为 `running` 或 `healthy` 后，在浏览器打开：

```text
http://你的设备IP:4080
```

例如 NAS 地址是 `192.168.1.20`：

```text
http://192.168.1.20:4080
```

## 📘 开始使用

1. 点击书架右上角的 **＋**，选择一本或多本 EPUB。
2. 等待封面和元数据解析完成，书籍会出现在“我的书架”。
3. 点击封面开始阅读；阅读位置会自动保存，并显示在“继续阅读”中。
4. 长按并拖动书籍可调整顺序；拖到另一册书的中央可创建文件夹。
5. 阅读时点击页面中间呼出控制栏，通过“目录”和“Aa 设置”调整阅读体验。

也可以把 `.epub` 文件直接复制到宿主机的 `data/books/`。应用会监控该目录并同步新增或删除的书籍。

## 💾 数据与备份

Compose 文件旁的 `data/` 是整个书库的持久化目录：

```text
data/
├── library.sqlite    # 书架、文件夹与阅读进度
├── books/            # EPUB 原文件
└── covers/           # 提取或生成的封面
```

只要保留完整的 `data/`，重建或更新容器不会丢失书库。

### 备份

为获得一致的数据库备份，先停止容器写入，再打包整个数据目录：

```bash
docker compose stop
tar -czf ../epub-reader-data-$(date +%Y%m%d).tar.gz data
docker compose start
```

### 恢复

停止并移除容器，把现有 `data/` 改名保留，再将备份中的 `data/` 放回 Compose 文件旁：

```bash
docker compose down
mv data data.before-restore
tar -xzf ../epub-reader-data-20260722.tar.gz
docker compose up -d
```

请把示例备份文件名替换为你的实际文件名。确认恢复正常后，再自行处理 `data.before-restore/`。

### 更新镜像

更新前建议先备份，然后执行：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

Compose 会拉取 `latest` 镜像并重新创建容器，挂载在 `./data` 中的书库不会被删除。

## 📱 添加到手机主屏幕

EPUB Reader 提供 PWA 启动外壳：

- **iPhone / iPad：** 使用 Safari 打开应用，点击“分享” → “添加到主屏幕”。
- **Android：** 使用 Chrome 打开应用，在菜单中选择“安装应用”或“添加到主屏幕”。

> [!NOTE]
> PWA 用于改善主屏幕入口和独立窗口体验，不提供离线阅读。手机仍需能够访问运行中的 EPUB Reader 服务。

## 🩺 健康检查与日志

浏览器或命令行访问：

```text
http://你的设备IP:4080/api/health
```

正常响应包含 `"status":"ok"`。查看容器日志：

```bash
docker compose logs -f --tail=100
```

按 `Ctrl+C` 退出日志查看，不会停止容器。

## ❓ 常见问题

<details>
<summary><strong>浏览器打不开页面</strong></summary>

先运行 `docker compose ps` 确认容器已启动，再检查 NAS 防火墙是否放行 `4080`。如果修改过端口映射，请使用冒号左侧的端口访问。

</details>

<details>
<summary><strong>容器显示 unhealthy</strong></summary>

运行 `docker compose logs --tail=100` 查看启动错误，并访问 `http://设备IP:4080/api/health`。重点检查 `data/` 是否可写，以及宿主机磁盘是否已满。

</details>

<details>
<summary><strong>重建容器后书籍不见了</strong></summary>

确认 Compose 中仍有 `./data:/app/server/data`，并且命令是在原来的 Compose 目录执行。使用相对路径时，从不同目录启动会挂载另一个 `data/`。

</details>

<details>
<summary><strong>复制 EPUB 后没有立即出现</strong></summary>

确认文件扩展名为 `.epub`，文件已经完整复制到 `data/books/`，然后稍等片刻并刷新书架。若仍未出现，请检查容器日志中的解析或文件权限错误。

</details>

<details>
<summary><strong>可以直接暴露到公网吗？</strong></summary>

不建议。当前应用没有内置登录或多用户隔离。若确需远程访问，请在可信的 VPN、零信任网络或带身份验证的反向代理之后使用，并启用 HTTPS。

</details>

## 🧩 技术组成

| 层级 | 技术 |
|---|---|
| Web 客户端 | React 19、Vite、epub.js、dnd-kit |
| 服务端 | Node.js 22、Express |
| 数据存储 | SQLite、宿主机文件目录 |
| 部署 | Docker、Docker Compose |

<details>
<summary><strong>从源码构建</strong></summary>

适合希望自行修改代码或验证最新提交的用户：

```bash
git clone https://github.com/natumeAi/epub-reader-codex.git
cd epub-reader-codex
docker compose up -d --build
```

源码版默认映射到 `3000` 端口：

```text
http://你的设备IP:3000
```

</details>

## ℹ️ 项目说明

- 主要定位：个人使用、移动优先、自托管 EPUB 阅读
- 主要场景：手机或平板竖屏、NAS 局域网部署
- 当前格式：EPUB
- 数据位置：完全由部署者挂载并管理

---

<div align="center">
  如果这个项目让你的私人书库更好读，欢迎收藏仓库并分享使用体验。
</div>
