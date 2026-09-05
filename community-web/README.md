# 肆度网页社区端

`community-web` 是与 `community-app` 并列的网页客户端。它复用同一套 Node API、SQLite 数据和 WebSocket 事件，不复制业务数据，也不改变 App 或管理后台的入口。

## 本地运行

```powershell
pnpm install
pnpm dev
```

开发服务器会把 `/api` 和 `/ws` 代理到生产服务。正式构建：

```powershell
pnpm build
```

构建结果位于 `dist/`，生产版本独立发布到 `/var/www/sidu-community-web/releases/`，由 `current` 软链接原子切换，访问路径为 `/community/`。

## Cloudflare Pages

官网可从同一私有 GitHub 仓库部署到 Cloudflare Pages，不移动服务端或数据库：

- Root directory：`community-web`
- Build command：`pnpm build`
- Build output directory：`dist`
- Node.js：22 或更高版本

Cloudflare Pages 构建时会自动设置 `CF_PAGES`，Vite 因此使用根路径 `/`；腾讯云现有部署仍使用 `/community/`。`your-web.example` 与 `www.your-web.example` 环境会直接连接现有腾讯云 HTTPS API 和 WebSocket。

## 边界

- 网页端使用可撤销的独立会话，不递增 App 的单设备 `token_version`，所以 App 与网页可同时在线。
- 网页端只读取实况照片的静态封面，不请求或播放动态视频。
- 普通视频功能保持隐藏，不在网页端开放。
- 静态资源、Nginx 路由和服务端会话表均独立分区；部署网页端不会覆盖 `/opt/sidu` 的数据库、上传、缓存或管理后台文件。
