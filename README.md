# 4du-FourCelsius

肆度（Four Celsius）是一个开源社区项目，包含 Expo/React Native App、React 网页端和 Node.js 服务端。项目用于学习、研究和自托管部署。

## APP 端

以下截图展示移动端的主要页面与视觉风格。

<p style="white-space: nowrap;">
  <img src="./docs/screenshots/app-feed.jpg" alt="APP 端浮霜带" width="180">
  <img src="./docs/screenshots/app-reef.jpg" alt="APP 端隐海礁" width="180">
  <img src="./docs/screenshots/app-messages.jpg" alt="APP 端消息页" width="180">
  <img src="./docs/screenshots/app-profile.jpg" alt="APP 端个人主页" width="180">
</p>

## 网页端

以下截图展示浏览器端的首页与社区页面。

<p>
  <img src="./docs/screenshots/web-home.png" alt="网页端首页" width="620">
  <img src="./docs/screenshots/web-community.png" alt="网页端社区" width="620">
</p>

## 目录

- `community-app/`：Android/iOS 客户端（Expo + React Native）
- `community-web/`：浏览器客户端（Vite + React）
- `server/`：REST API、WebSocket、SQLite 数据库和管理接口

## 部署教程

### 方式一：AI 辅助部署

可以把本仓库地址和下面这段话交给你信任的 AI 编程助手：

```text
请阅读本仓库 README.md 和 DEPLOYMENT.md，在当前电脑上按本地部署方式安装依赖、创建 .env、启动 server 和 community-web，并逐项检查 /api/health。不要读取、输出或提交任何密钥；遇到环境差异时先解释原因再继续。
```

AI 可以协助执行命令和排查日志，但不会替你获得云账号、域名、COS 密钥或短信资质。生产部署前仍需人工检查 `.env`、防火墙、HTTPS 和备份策略。

### 方式二：本地部署（学习和局域网测试）

需要 Git、Node.js 22 LTS（推荐 22.13+）和 npm。Node.js 24 可能无法编译 `better-sqlite3`。

```powershell
git clone https://github.com/lvguicheniii/4du-FourCelsius.git
cd 4du-FourCelsius/server
Copy-Item .env.example .env
npm install
npm run dev
```

首次启动会使用账号 `noesis`，密码留空时在终端生成一次性随机密码；登录后立即修改。开发模式固定验证码为 `252616`，只可用于本机或隔离局域网测试。

另开终端启动网页端：

```powershell
cd community-web
Copy-Item .env.example .env
npm install
npm run dev
```

网页地址通常是 `http://localhost:5173/community/`（端口被占用时以终端显示为准）。健康检查：`Invoke-WebRequest http://localhost:3001/api/health`，返回 200 即表示服务端正常。

手机预览 App：

1. 安装 [Expo Go](https://expo.dev/go)（[Android 下载说明](https://docs.expo.dev/get-started/set-up-your-environment/)；iOS 从 App Store 搜索 Expo Go）。
2. 在 `community-app/.env` 设置 `EXPO_PUBLIC_API_URL=http://电脑局域网IP:3001`，手机和电脑连接同一 Wi-Fi。
3. 执行 `cd community-app; npm install; npx expo start`，用 Expo Go 扫描终端二维码；若终端处于 development build 模式，按 `s` 切换到 Expo Go。

Android 模拟器使用 `http://10.0.2.2:3001`，不要在手机上使用 `localhost`。本地部署没有公网 HTTPS，不适合真实用户运营。

### 方式三：云服务器部署（公网或生产环境）

准备 Ubuntu 22.04/24.04、Node.js 22 LTS、SQLite、Nginx 和 HTTPS 域名：

```bash
git clone https://github.com/lvguicheniii/4du-FourCelsius.git
cd 4du-FourCelsius/server
cp .env.example .env
npm ci --omit=dev
npm start
```

编辑 `.env`：设置随机 `JWT_SECRET`、`ADMIN_JWT_SECRET`，首次启动设置自定义管理员账号和至少 12 位密码，成功创建后移除 `ADMIN_BOOTSTRAP_*`；生产环境关闭固定验证码，配置 `CORS_ORIGINS`，通过 Nginx 提供 HTTPS。网页端和 App 的 API 地址必须使用 HTTPS，COS、推送、审核、备份等密钥只放在服务器环境变量中。

完整的 Nginx、进程守护、数据库备份和 App 构建说明请阅读 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

## 许可

本项目按 MIT License 发布，详见 [`LICENSE`](./LICENSE)。部署者需自行遵守所在地区的法律法规、隐私和内容治理要求。
