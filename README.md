# 4du-FourCelsius

肆度（Four Celsius）是一个开源社区项目，包含 Expo/React Native App、React 网页端和 Node.js 服务端。项目用于学习、研究和自托管部署。

## 目录

- `community-app/`：Android/iOS 客户端（Expo + React Native）
- `community-web/`：浏览器客户端（Vite + React）
- `server/`：REST API、WebSocket、SQLite 数据库和管理接口

## 快速开始

### 服务端

```bash
cd server
cp .env.example .env
npm ci
npm start
```

服务端默认监听 `http://localhost:3001`。首次运行会创建本地数据库和管理员初始化提示。生产环境必须设置随机的 `JWT_SECRET`、`ADMIN_JWT_SECRET`，启用短信或其他真实验证服务，并通过反向代理提供 HTTPS。固定验证码仅适用于隔离的本地测试。

### 网页端

```bash
cd community-web
cp .env.example .env
npm install
npm run dev
```

设置 `VITE_API_ORIGIN` 指向服务端地址。生产构建使用 `npm run build`。

### App

```bash
cd community-app
cp .env.example .env
npm install
npx expo start
```

设置 `EXPO_PUBLIC_API_URL` 指向服务端地址。正式 Android 构建需要本机 Android SDK、签名密钥和 HTTPS API；签名材料绝不提交到 Git。

## 生产部署

请阅读 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。其中的域名、凭据、COS 桶名和证书均由部署者自行配置，仓库不包含任何生产数据或密钥。

## 许可

本项目按 MIT License 发布，详见 [`LICENSE`](./LICENSE)。部署者需自行遵守所在地区的法律法规、隐私和内容治理要求。
