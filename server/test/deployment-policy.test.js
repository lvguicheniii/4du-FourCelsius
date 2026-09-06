const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production deployment policy protects persistent data and requires verification', () => {
  const guide = fs.readFileSync(path.resolve(__dirname, '../../DEPLOYMENT.md'), 'utf8');
  assert.match(guide, /server\/src\/data\/sidu\.db/);
  assert.match(guide, /server\/uploads\//);
  assert.match(guide, /备份前停止服务端/);
  assert.match(guide, /HTTPS/);
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
