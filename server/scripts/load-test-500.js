const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const WebSocket = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.LOAD_TEST_PORT) || (3300 + (process.pid % 2000));
const USERS = Number(process.env.LOAD_TEST_USERS) || 500;
const SECRET = 'local-load-test-secret-with-more-than-32-characters';
const DB_PATH = path.join(ROOT, 'tmp', `load-test-${process.pid}.db`);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function waitForServer(child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Test server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for the test server');
}

function seedUsers() {
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 5000');
  // Use the production bcrypt cost so the authentication burst measures the
  // same CPU pressure users create in a real deployment.
  const hash = bcrypt.hashSync('load-test-password', 10);
  const insert = db.prepare(`
    INSERT INTO users(id,username,password_hash,nickname,role,status,token_version,age,gender,tags,created_at)
    VALUES (?,?,?,?, 'user','active',0,18,?,'[]',datetime('now','+8 hours'))
  `);
  const seed = db.transaction(() => {
    for (let index = 0; index < USERS; index += 1) {
      const id = String(8000000 + index);
      insert.run(id, `load_user_${index}`, hash, `Load User ${index}`, index % 2 ? 'female' : 'male');
    }
    db.prepare("UPDATE reef_rooms SET capacity=? WHERE id='reef_official_1'").run(Math.max(USERS, 500));
    db.prepare(`
      INSERT INTO posts(id,user_id,content,board_id,status,visibility,created_at,updated_at)
      VALUES ('load_post',?,'load test post','["free"]','active','public',datetime('now','+8 hours'),datetime('now','+8 hours'))
    `).run('8000000');
  });
  seed();
  db.close();
}

function tokenFor(index) {
  return jwt.sign({
    userId: String(8000000 + index),
    tokenVersion: 0,
    purpose: 'user',
  }, SECRET, {
    algorithm: 'HS256',
    issuer: 'sidu-api',
    audience: 'sidu-app',
    expiresIn: '1h',
  });
}

function connectSocket(index, counters) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${WS_URL}?token=${encodeURIComponent(tokenFor(index))}`);
    const timeout = setTimeout(() => reject(new Error(`WebSocket ${index} timed out`)), 15_000);
    socket.on('open', () => {
      clearTimeout(timeout);
      socket.on('message', () => { counters.received += 1; });
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
}

async function apiRequest(index, method, pathname, body, requestId) {
  const startedAt = performance.now();
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${tokenFor(index)}`,
      'content-type': 'application/json',
      'idempotency-key': requestId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, durationMs: performance.now() - startedAt, payload };
}

async function runBatch(name, jobs, acceptedStatuses = [200, 201]) {
  const results = await Promise.all(jobs);
  const failures = results.filter(result => !acceptedStatuses.includes(result.status));
  const durations = results.map(result => result.durationMs);
  const summary = {
    name,
    requests: results.length,
    failures: failures.length,
    p50Ms: Math.round(percentile(durations, 0.5)),
    p95Ms: Math.round(percentile(durations, 0.95)),
    p99Ms: Math.round(percentile(durations, 0.99)),
    maxMs: Math.round(Math.max(...durations)),
  };
  if (failures.length) summary.sampleFailure = failures[0];
  return summary;
}

async function main() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      SIDU_BIND_ADDRESS: '127.0.0.1',
      SIDU_DB_PATH: DB_PATH,
      JWT_SECRET: SECRET,
      NODE_ENV: 'test',
      WS_VERBOSE_CONNECTION_LOGS: '0',
      COS_SECRET_ID: '',
      COS_SECRET_KEY: '',
      COS_BUCKET: '',
      COS_REGION: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverErrors = '';
  child.stderr.on('data', chunk => { serverErrors += chunk.toString(); });

  const sockets = [];
  try {
    await waitForServer(child);
    seedUsers();

    const counters = { received: 0 };
    const connectStarted = performance.now();
    sockets.push(...await Promise.all(Array.from({ length: USERS }, (_, index) => connectSocket(index, counters))));
    const connectMs = Math.round(performance.now() - connectStarted);

    sockets.forEach(socket => socket.send(JSON.stringify({ type: 'reef_enter', roomId: 'reef_official_1' })));
    await new Promise(resolve => setTimeout(resolve, 2000));

    const summaries = [];
    summaries.push(await runBatch('registrations', Array.from({ length: 10 }, (_, index) =>
      apiRequest(index, 'POST', '/api/auth/register', {
        username: `burst_register_${index}`,
        password: 'load-test-password',
        nickname: `Burst Register ${index}`,
        age: 18,
      }, `load-register-${index}`))));
    summaries.push(await runBatch('logins', Array.from({ length: 40 }, (_, index) =>
      apiRequest(index + 400, 'POST', '/api/auth/login', {
        username: `load_user_${index + 400}`,
        password: 'load-test-password',
      }, `load-login-${index}`))));
    summaries.push(await runBatch('posts', Array.from({ length: 50 }, (_, index) =>
      apiRequest(index + 201, 'POST', '/api/posts', { content: `post ${index}`, boardId: '["free"]' }, `load-post-${index}`))));
    summaries.push(await runBatch('comments', Array.from({ length: 100 }, (_, index) =>
      apiRequest(index + 1, 'POST', '/api/comments/load_post', { content: `comment ${index}` }, `load-comment-${index}`))));
    summaries.push(await runBatch('direct_messages', Array.from({ length: 100 }, (_, index) =>
      apiRequest(index + 1, 'POST', '/api/chat/send', { toUserId: '8000000', content: `message ${index}`, kind: 'text' }, `load-chat-${index}`))));
    summaries.push(await runBatch('reef_messages', Array.from({ length: 100 }, (_, index) =>
      apiRequest(index + 1, 'POST', '/api/reef/rooms/reef_official_1/messages', { content: `reef ${index}`, kind: 'text' }, `load-reef-${index}`))));

    await new Promise(resolve => setTimeout(resolve, 1000));
    const healthStarted = performance.now();
    const health = await fetch(`${BASE_URL}/api/health`);
    const healthMs = Math.round(performance.now() - healthStarted);
    const failed = summaries.reduce((total, item) => total + item.failures, 0);
    const result = {
      users: USERS,
      websocketConnectMs: connectMs,
      websocketEventsReceived: counters.received,
      healthStatus: health.status,
      healthLatencyMs: healthMs,
      batches: summaries,
      passed: failed === 0 && health.ok && sockets.every(socket => socket.readyState === WebSocket.OPEN),
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } finally {
    sockets.forEach(socket => socket.close());
    if (child.exitCode === null) child.kill('SIGTERM');
    if (!await waitForChildExit(child, 5000)) {
      child.kill('SIGKILL');
      await waitForChildExit(child, 5000);
    }
    for (const suffix of ['', '-shm', '-wal']) {
      fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
    }
    if (serverErrors.trim()) console.error(serverErrors.trim());
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
