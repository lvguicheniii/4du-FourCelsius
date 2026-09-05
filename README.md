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

### 方式一：本地部署（学习和局域网测试）

本地部署不需要云服务器。需要安装 Node.js 20+，服务端会使用本地 SQLite 数据库。

#### 1. 启动服务端

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```

服务端默认地址为 `http://localhost:3001`。本地隔离测试可以在 `.env` 中使用固定验证码；不要将固定验证码用于公网部署。

#### 2. 启动网页端

新开一个终端：

```powershell
cd community-web
Copy-Item .env.example .env
npm install
npm run dev
```

网页端默认地址为 `http://localhost:5173`。本机访问服务端时，`.env` 中的 `VITE_API_ORIGIN` 保持 `http://localhost:3001` 即可。

#### 3. 连接 App

```powershell
cd community-app
Copy-Item .env.example .env
npm install
npx expo start
```

在 `community-app/.env` 中设置 `EXPO_PUBLIC_API_URL`：

- Android 模拟器使用 `http://10.0.2.2:3001`
- 同一局域网的真机使用电脑局域网 IP，例如 `http://192.168.1.20:3001`
- 手机和电脑必须连接同一个局域网，并允许 Node.js 通过 Windows 专用网络防火墙

本地部署只能被本机或局域网设备访问，不提供公网 HTTPS，不适合真实用户运营。

### 方式二：云服务器部署（公网或生产环境）

推荐 Ubuntu 22.04/24.04、Node.js 20+、SQLite、Nginx 和 HTTPS 域名。基本流程如下：

```bash
git clone https://github.com/lvguicheniii/4du-FourCelsius.git
cd 4du-FourCelsius/server
cp .env.example .env
npm ci --omit=dev
npm start
```

生产环境必须设置随机的 `JWT_SECRET`、`ADMIN_JWT_SECRET`，配置正确的 `CORS_ORIGINS`，关闭固定验证码，并通过 Nginx 或其他反向代理提供 HTTPS。网页端和 App 的 API 地址都应改为 HTTPS 域名。媒体存储、备份、推送和内容审核服务按实际需要配置，密钥只放在服务器环境变量中。

完整的 Nginx、进程守护、数据库备份和 App 构建说明请阅读 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。域名、凭据、COS 桶名和证书均由部署者自行配置，仓库不包含任何生产数据或密钥。

## 许可

本项目按 MIT License 发布，详见 [`LICENSE`](./LICENSE)。部署者需自行遵守所在地区的法律法规、隐私和内容治理要求。
