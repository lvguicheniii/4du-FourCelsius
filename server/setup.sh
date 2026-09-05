# 肆度社区服务器部署脚本
# 在服务器上运行: bash setup.sh

set -e

echo "===== 安装 Node.js ====="
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "===== 安装 Nginx ====="
sudo apt-get install -y nginx

echo "===== 安装必要工具 ====="
sudo apt-get install -y git build-essential

echo "===== 创建目录 ====="
sudo mkdir -p /opt/sidu/uploads
sudo mkdir -p /opt/sidu/data
sudo chown -R $USER:$USER /opt/sidu

echo "===== 部署代码 ====="
# 假设代码已通过 scp/git 放在当前目录
cp -r ./server/* /opt/sidu/

echo "===== 安装依赖 ====="
cd /opt/sidu
npm install

echo "===== 配置 Nginx ====="
sudo cp /opt/sidu/nginx.conf /etc/nginx/sites-available/sidu
sudo ln -sf /etc/nginx/sites-available/sidu /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo "===== SSL 证书（需要域名已解析） ====="
read -p "域名 your-web.example 是否已解析到本服务器？(y/n) " yn
if [ "$yn" = "y" ]; then
  sudo apt-get install -y certbot python3-certbot-nginx
  sudo certbot --nginx -d your-web.example -d www.your-web.example --non-interactive --agree-tos -m admin@your-web.example || true
fi

echo "===== 启动服务 ====="
sudo npm install -g pm2
pm2 start src/index.js --name sidu --cwd /opt/sidu
pm2 save
pm2 startup | bash

echo ""
echo "✅ 部署完成！"
echo "   API: https://your-web.example/api/health"
echo "   管理: pm2 status"
