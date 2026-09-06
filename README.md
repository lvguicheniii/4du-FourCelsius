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

本地部署不需要云服务器。需要安装 Git、Node.js 22 LTS（推荐 22.13+）和 pnpm 或 npm；服务端会使用本地 SQLite 数据库。Node.js 24 可能无法为 `better-sqlite3` 找到预编译包。

#### 1. 启动服务端

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run dev
```

编辑 `server/.env`，至少填写随机的 `JWT_SECRET`、`ADMIN_JWT_SECRET`。本地模板预填管理员账号 `noesis`，密码留空时会在首次启动日志中生成一次性随机密码；复制该密码登录后立即修改，然后删除或清空 `ADMIN_BOOTSTRAP_PASSWORD` 并重启服务。也可以自行填写一个至少 12 位的本地测试密码。服务端默认地址为 `http://localhost:3001`。

本地隔离测试默认使用固定验证码 `252616`（由 `.env.example` 配置）；不要将固定验证码用于公网部署。未配置 COS 时，请按服务端当前配置使用本地媒体存储或关闭媒体功能。

#### 2. 启动网页端

新开一个终端：

```powershell
cd community-web
Copy-Item .env.example .env
npm install
npm run dev
```

网页端默认地址为 `http://localhost:5173/community/`。本机访问服务端时，`.env` 中的 `VITE_API_ORIGIN` 保持 `http://localhost:3001` 即可。若通过局域网访问网页端，将它改为运行服务端电脑的局域网地址，并同步调整服务端 `CORS_ORIGINS`。

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

#### 4. 常见检查

```powershell
Invoke-WebRequest http://localhost:3001/api/health
```

返回 HTTP 200 且包含 `"status":"ok"` 即表示服务端正常。若手机无法连接，先确认电脑局域网 IP、Windows 防火墙、手机与电脑是否在同一 Wi-Fi，并确认 App 没有使用 `localhost`。

### 方式二：云服务器部署（公网或生产环境）

推荐 Ubuntu 22.04/24.04、Node.js 20+、SQLite、Nginx 和 HTTPS 域名。基本流程如下：

```bash
git clone https://github.com/lvguicheniii/4du-FourCelsius.git
cd 4du-FourCelsius/server
cp .env.example .env
npm ci --omit=dev
npm start
```

生产环境必须设置随机的 `JWT_SECRET`、`ADMIN_JWT_SECRET`，并在首次启动前设置自定义的 `ADMIN_BOOTSTRAP_USERNAME` 和至少 12 位的 `ADMIN_BOOTSTRAP_PASSWORD`；成功创建管理员后立即移除引导变量。生产环境必须将 `ACCOUNT_VERIFICATION_MODE` 改为真实验证方式并清空固定验证码，配置正确的 `CORS_ORIGINS`，再通过 Nginx 或其他反向代理提供 HTTPS。网页端和 App 的 API 地址都应改为 HTTPS 域名。媒体存储、备份、推送和内容审核服务按实际需要配置，密钥只放在服务器环境变量中。

完整的 Nginx、进程守护、数据库备份和 App 构建说明请阅读 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。域名、凭据、COS 桶名和证书均由部署者自行配置，仓库不包含任何生产数据或密钥。

## 许可

本项目按 MIT License 发布，详见 [`LICENSE`](./LICENSE)。部署者需自行遵守所在地区的法律法规、隐私和内容治理要求。
