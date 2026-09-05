const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production deployment policy protects persistent data and requires verification', () => {
  const guide = fs.readFileSync(path.resolve(__dirname, '../../DEPLOY.md'), 'utf8');
  assert.match(guide, /SHA-256/);
  assert.match(guide, /SQLite.*备份/);
  assert.match(guide, /完整性检查/);
  assert.match(guide, /健康检查/);
  assert.match(guide, /自动恢复上一版代码/);
  assert.match(guide, /uploads 和 \.env 不会进入发布包/);
  assert.doesNotMatch(guide, /node_modules.*符号链接/);
});

test('nginx production templates enforce modern TLS and per-IP pressure limits', () => {
  const security = fs.readFileSync(path.resolve(__dirname, '../ops/nginx-security-http.conf'), 'utf8');
  const ipSite = fs.readFileSync(path.resolve(__dirname, '../nginx-ip.conf'), 'utf8');
  const domainSite = fs.readFileSync(path.resolve(__dirname, '../nginx.conf'), 'utf8');

  assert.match(ipSite, /ssl_protocols TLSv1\.2 TLSv1\.3/);
  assert.doesNotMatch(ipSite, /TLSv1(?:\s|;)/);
  assert.match(security, /server_tokens off/);
  assert.match(security, /limit_req_zone/);
  assert.match(security, /limit_conn_zone/);
  assert.match(ipSite, /limit_req zone=sidu_api_per_ip/);
  assert.match(ipSite, /limit_conn sidu_connections_per_ip/);
  assert.match(domainSite, /limit_req zone=sidu_api_per_ip/);
  for (const site of [ipSite, domainSite]) {
    assert.match(site, /location \^~ \/community\//);
    assert.match(site, /alias \/var\/www\/sidu-community-web\/current\//);
    assert.match(site, /Content-Security-Policy/);
    assert.match(site, /frame-ancestors 'none'/);
    assert.match(site, /Strict-Transport-Security "max-age=31536000" always/);
    assert.match(site, /X-Frame-Options "DENY" always/);
  }
});

test('production service runs as a restricted non-root account', () => {
  const unit = fs.readFileSync(path.resolve(__dirname, '../ops/pm2-sidu.service'), 'utf8');
  const cron = fs.readFileSync(path.resolve(__dirname, '../ops/sidu-ops.cron'), 'utf8');
  const logrotate = fs.readFileSync(path.resolve(__dirname, '../ops/logrotate-sidu-pm2'), 'utf8');

  assert.match(unit, /User=sidu/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /CapabilityBoundingSet=\r?\n/);
  assert.match(unit, /ReadWritePaths=\/opt\/sidu\/src\/data/);
  assert.match(unit, /\/opt\/sidu\/tmp/);
  assert.doesNotMatch(cron, /\sroot\s/);
  assert.match(cron, /\ssidu\scd \/opt\/sidu/);
  assert.match(cron, /restore-drill\.js/);
  assert.doesNotMatch(logrotate, /\/root\/\.pm2/);
});

test('production deployment keeps authorized OTA cache files readable by Nginx', () => {
  const deployScript = fs.readFileSync(path.resolve(__dirname, '../../upload_server.py'), 'utf8');

  assert.match(deployScript, /prepare_ota_cache/);
  assert.match(deployScript, /install -d -o sidu -g www-data -m 2750/);
  assert.match(deployScript, /chown sidu:www-data/);
  assert.match(deployScript, /chmod 640/);
  assert.match(deployScript, /systemctl restart pm2-sidu\.service/);
  assert.match(deployScript, /encrypt-backup-file\.js/);
  assert.match(deployScript, /sidu-\$stamp\.db\.enc/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../nginx.conf'), 'utf8'), /location \^~ \/_ota-self-hosted-assets\//);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../nginx.conf'), 'utf8'), /sendfile on;/);
});

test('production OTA publication is fully self-hosted and hash verified', () => {
  const publishScript = fs.readFileSync(path.resolve(__dirname, '../../publish_self_hosted_ota.py'), 'utf8');
  const packageJson = fs.readFileSync(path.resolve(__dirname, '../../community-app/package.json'), 'utf8');
  const route = fs.readFileSync(path.resolve(__dirname, '../src/routes/app-updates.js'), 'utf8');
  assert.match(publishScript, /sha256sum -c/);
  assert.match(publishScript, /ota-self-hosted\/channels\/production/);
  assert.match(publishScript, /mv .*\.json\.tmp/);
  assert.match(publishScript, /app_update_logs/);
  assert.doesNotMatch(packageJson, /ota:publish:production/);
  assert.doesNotMatch(route, /api\.expo\.dev|u\.expo\.dev|assets\.eascdn\.net|EAS-HMAC/);
});

test('certificate renewal uses the Certbot build that supports IP certificates', () => {
  const override = fs.readFileSync(path.resolve(__dirname, '../ops/certbot-modern-override.conf'), 'utf8');
  assert.match(override, /ExecStart=\/opt\/certbot-ip\/bin\/certbot -q renew/);
  assert.doesNotMatch(override, /\/usr\/bin\/certbot/);
});

test('SSH production policy requires non-root key-only administration', () => {
  const ssh = fs.readFileSync(path.resolve(__dirname, '../ops/sidu-ssh-hardening.conf'), 'utf8');
  assert.match(ssh, /^PermitRootLogin no$/m);
  assert.match(ssh, /^PasswordAuthentication no$/m);
  assert.match(ssh, /^KbdInteractiveAuthentication no$/m);
  assert.match(ssh, /^PubkeyAuthentication yes$/m);
  assert.match(ssh, /^X11Forwarding no$/m);
  assert.match(ssh, /^AllowAgentForwarding no$/m);
  assert.match(ssh, /^MaxAuthTries 3$/m);
});
