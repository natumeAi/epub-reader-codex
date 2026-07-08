# EPUB Reader

自托管 EPUB 阅读网页应用，主要用于手机竖屏阅读，目标部署环境为飞牛 NAS。

## Docker 部署

项目使用 Docker Compose 部署，书库数据持久化在宿主机 `server/data/`：

```bash
docker compose up -d --build
```

默认 Web 地址：

```text
http://NAS-IP:3000/
```

健康检查接口：

```text
http://NAS-IP:3000/api/health
```

如果 Windows 本机没有 WSL 或 Docker，不需要卡在本机验证；建议把项目放到飞牛 NAS 上，直接在 NAS 的 Docker 环境中执行 Docker Compose 验证。

## 飞牛 NAS 最小验证

1. 在项目目录执行 `docker compose up -d --build`，确认容器启动。
2. 打开 `http://NAS-IP:3000/`，确认页面可访问。
3. 打开 `http://NAS-IP:3000/api/health`，确认返回 `ok` 状态。
4. 在页面上传一本 EPUB。
5. 在宿主机项目目录确认存在：
   - `server/data/library.sqlite`
   - `server/data/books/`
   - `server/data/covers/`
6. 执行 `docker compose down` 后再执行 `docker compose up -d --build`。
7. 重新打开页面，确认书籍、封面和阅读进度仍然存在。
