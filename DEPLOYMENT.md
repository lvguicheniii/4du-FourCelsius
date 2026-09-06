# 自托管部署

## 0. 本地数据模式

开发环境默认使用 SQLite 和本地文件存储，不依赖任何云产品：

- 数据库：`server/src/data/sidu.db`
- 媒体：`server/uploads/`
- 临时处理文件：`server/tmp/`

保持 `NODE_ENV=development` 且 COS 配置为空，上传内容会写入本机 `server/uploads/`。注册验证码可使用 `.env.example` 中的固定测试码。完整的本地启动命令见 `README.md`。

备份前停止服务端，复制数据库和整个上传目录。恢复时保持相同相对路径再启动服务。SQLite 的 `-wal`/`-shm` 文件只应在服务停止后处理。

## 1. 准备服务器

推荐 Ubuntu 22.04/24.04、Node.js 22 LTS、SQLite、Nginx 和一个 HTTPS 域名。将仓库复制到服务器后：

```bash
cd 4du-FourCelsius/server
cp .env.example .env
npm ci --omit=dev
```

## 2. 配置环境变量

编辑 `server/.env`，至少设置：

```env
NODE_ENV=production
PORT=3001
SIDU_BIND_ADDRESS=127.0.0.1
JWT_SECRET=请生成至少32字节的随机值
ADMIN_JWT_SECRET=请生成另一组至少32字节的随机值
CORS_ORIGINS=https://你的网页域名
```

媒体上传可选用腾讯云 COS。只使用权限最小化的子账号，并把密钥仅放在服务器 `.env` 中。短信、验证码和内容审核服务均为可选配置；未配置时应保持对应功能关闭。

## 3. 启动服务

```bash
npm start
```

建议使用 systemd/PM2 以非 root 用户运行，并让 Nginx 代理 `/api` 和 `/ws` 到 `127.0.0.1:3001`。不要把 SQLite 数据库、上传目录或 `.env` 放进公开仓库。

## 4. 构建网页端

```bash
cd ../community-web
export VITE_API_ORIGIN=https://你的API域名
npm install
npm run build
```

将 `dist/` 部署到静态托管服务或 Nginx。SPA 服务器需要把未知路径回退到 `index.html`。

## 5. 构建 App

```bash
cd ../community-app
export EXPO_PUBLIC_API_URL=https://你的API域名
npm install
npx expo prebuild
cd android
./gradlew assembleRelease
```

生产签名、OTA 代码签名证书和密钥由部署者自行生成并安全保存。若不需要 OTA，可在 `app.json` 中关闭 `updates`。本地 Expo Go 预览必须设置 `APP_VARIANT=development`，此模式会自动关闭 OTA。公开仓库中的默认配置只适用于本地开发。
