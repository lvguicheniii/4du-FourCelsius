// WebSocket 实时推送服务
// 每条连接绑定一个 userId，用于定向推送
const { WebSocketServer } = require('ws');
const db = require('./db');
const { parseCst } = require('./lib/time');
const { nowCst } = require('./lib/time');
const { verifyAuthToken } = require('./middleware/auth');
const { defaultSigner } = require('./lib/cos-media-signing');
const { claimOnlineFrostShell, getFrostShellState } = require('./lib/frost-shell');

/** @type {Map<string, Set<WebSocket>>} userId → 连接集合 */
const clients = new Map();
/** roomId → userId → { sockets, joinedAt, nickname, avatar, gender } */
const roomPresence = new Map();
const blockedPairs = new Set();
const pendingLastOnline = new Set();
const coalescedBroadcasts = new Map();
const roomMessageBatches = new Map();
const shellOnlineSessions = new Map();

const MAX_SOCKET_BUFFER_BYTES = Math.max(
  256 * 1024,
  Number(process.env.WS_MAX_BUFFER_BYTES) || 1024 * 1024,
);
const MAX_CONNECTIONS = Math.max(500, Number(process.env.WS_MAX_CONNECTIONS) || 2000);
const MAX_CONNECTIONS_PER_USER = Math.max(2, Number(process.env.WS_MAX_CONNECTIONS_PER_USER) || 4);
const MAX_PAYLOAD_BYTES = Math.max(
  16 * 1024,
  Number(process.env.WS_MAX_PAYLOAD_BYTES) || 64 * 1024,
);

let wss = null;
let eventSequence = 0;
let heartbeatTimer = null;
let lastOnlineTimer = null;
const pressureCounters = {
  sent: 0,
  slowClientDisconnects: 0,
  connectionLimitRejects: 0,
  perUserLimitRejects: 0,
  coalescedUpdates: 0,
};

function blockPairKey(userA, userB) {
  return [String(userA), String(userB)].sort().join(':');
}

function reloadBlockedPairs() {
  blockedPairs.clear();
  db.prepare('SELECT user_id, blocked_user_id FROM blocks').all().forEach((row) => {
    blockedPairs.add(blockPairKey(row.user_id, row.blocked_user_id));
  });
}

function updateBlockPair(userA, userB, blocked) {
  const key = blockPairKey(userA, userB);
  if (blocked) blockedPairs.add(key);
  else blockedPairs.delete(key);
}

function isBlockedPair(userA, userB) {
  return userA !== userB && blockedPairs.has(blockPairKey(userA, userB));
}

function safeSend(ws, payload) {
  if (ws.readyState !== 1) return false;
  if (ws.bufferedAmount > MAX_SOCKET_BUFFER_BYTES) {
    pressureCounters.slowClientDisconnects += 1;
    ws.close(1013, 'connection_too_slow');
    return false;
  }
  ws.send(payload);
  pressureCounters.sent += 1;
  return true;
}

function broadcastCoalesced(key, data, delayMs = 100) {
  const normalizedKey = String(key);
  const existing = coalescedBroadcasts.get(normalizedKey);
  if (existing) {
    existing.data = data;
    pressureCounters.coalescedUpdates += 1;
    return;
  }
  const entry = { data, timer: null };
  entry.timer = setTimeout(() => {
    coalescedBroadcasts.delete(normalizedKey);
    broadcast(entry.data);
  }, Math.max(10, delayMs));
  entry.timer.unref();
  coalescedBroadcasts.set(normalizedKey, entry);
}

function touchLastOnline(userId) {
  pendingLastOnline.add(String(userId));
}

function pushShellInventory(userId) {
  const state = getFrostShellState(db, userId);
  send(userId, {
    type: 'frost_shell_inventory',
    fragileCount: state.fragileCount,
    eternalCount: state.eternalCount,
    onlineSeconds: state.onlineSeconds,
    progressDate: state.progressDate,
    claimedDate: state.claimedDate,
  });
}

function flushShellProgressForUser(userId) {
  const session = shellOnlineSessions.get(String(userId));
  if (!session || session.activeSockets.size === 0) return;
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
  if (elapsedSeconds <= 0) return;
  const result = claimOnlineFrostShell(db)(userId, elapsedSeconds);
  session.startedAt = Date.now();
  if (result?.granted) pushShellInventory(userId);
}

function setSocketAppActive(ws, active) {
  if (!ws?.userId) return;
  const userId = String(ws.userId);
  let session = shellOnlineSessions.get(userId);
  if (!session) {
    session = { activeSockets: new Set(), startedAt: Date.now() };
    shellOnlineSessions.set(userId, session);
  }
  if (active) {
    if (ws.appActive) return;
    ws.appActive = true;
    session.activeSockets.add(ws);
    if (session.activeSockets.size === 1) {
      session.startedAt = Date.now();
    }
    return;
  }
  if (!ws.appActive) return;
  ws.appActive = false;
  session.activeSockets.delete(ws);
  if (session.activeSockets.size === 0) {
    flushShellProgressForUser(userId);
    shellOnlineSessions.delete(userId);
  }
}

function flushLastOnline() {
  if (pendingLastOnline.size === 0) return;
  const userIds = [...pendingLastOnline];
  pendingLastOnline.clear();
  try {
    const update = db.prepare("UPDATE users SET last_online_at=datetime('now','+8 hours') WHERE id=?");
    db.transaction((ids) => ids.forEach((userId) => update.run(userId)))(userIds);
  } catch (error) {
    userIds.forEach((userId) => pendingLastOnline.add(userId));
    console.error('[WS] Failed to flush last-online timestamps:', error.message);
  }
}

function eventPayload(data) {
  return JSON.stringify(defaultSigner.signPayload({
    ...data,
    _eventId: data._eventId || `${Date.now()}-${++eventSequence}`,
    sentAt: data.sentAt || nowCst(),
  }));
}

function websocketAuthToken(req) {
  const protocols = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const markerIndex = protocols.indexOf('sidu-auth-v1');
  if (markerIndex >= 0 && protocols[markerIndex + 1]) return protocols[markerIndex + 1];

  // Keep query authentication during the client migration window. Nginx
  // disables access logs for /ws so legacy tokens are not written to disk.
  const url = new URL(req.url, 'http://localhost');
  return url.searchParams.get('token');
}

function init(httpServer) {
  reloadBlockedPairs();
  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });
  lastOnlineTimer = setInterval(flushLastOnline, 5000);
  lastOnlineTimer.unref();
  const shellTimer = setInterval(() => {
    shellOnlineSessions.forEach((_, userId) => flushShellProgressForUser(userId));
  }, 5000);
  shellTimer.unref();
  wss._shellTimer = shellTimer;

  wss.on('connection', (ws, req) => {
    if (wss.clients.size > MAX_CONNECTIONS) {
      pressureCounters.connectionLimitRejects += 1;
      ws.close(1013, 'server_busy');
      return;
    }
    const token = websocketAuthToken(req);

    if (!token) {
      ws.close(4001, '缺少认证');
      return;
    }

    // WebSocket 连接同样校验签名、单设备版本与账号状态。
    let userId = null;
    try {
      const payload = verifyAuthToken(token);
      userId = payload.userId || payload.sub || payload.id;
      const user = db.prepare('SELECT status, ban_until, token_version, nickname, username, avatar, gender FROM users WHERE id = ?').get(userId);
      const banned = user?.status === 'banned' &&
        (!user.ban_until || parseCst(user.ban_until)?.getTime() > Date.now());
      if (!user || (!payload.webSessionHash && payload.tokenVersion !== user.token_version) || banned) {
        ws.close(4003, banned ? '账号已封禁' : '登录已失效');
        return;
      }
    } catch {
      ws.close(4001, '无效 token');
      return;
    }

    if (!userId) {
      ws.close(4001, '无法识别用户');
      return;
    }

    const profile = db.prepare('SELECT nickname,username,avatar,gender FROM users WHERE id=?').get(userId) || {};
    ws.userId = userId;
    ws.profile = profile;
    ws.reefRoomId = null;
    ws.appActive = false;

    // 加入连接池
    if (!clients.has(userId)) clients.set(userId, new Set());
    const userSockets = clients.get(userId);
    if (userSockets.size >= MAX_CONNECTIONS_PER_USER) {
      pressureCounters.perUserLimitRejects += 1;
      ws.close(1008, 'too_many_connections');
      return;
    }
    userSockets.add(ws);
    touchLastOnline(userId);

    if (process.env.WS_VERBOSE_CONNECTION_LOGS === '1') {
      console.log(`[WS] connected user=${userId} online=${clients.size}`);
    }

    // 心跳保活
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') safeSend(ws, JSON.stringify({ type: 'pong' }));
        if (msg.type === 'app_active') setSocketAppActive(ws, true);
        if (msg.type === 'app_inactive') setSocketAppActive(ws, false);
        if (msg.type === 'reef_enter' && msg.roomId) joinReefRoom(ws, String(msg.roomId));
        if (msg.type === 'reef_leave') leaveReefRoom(ws);
      } catch {}
    });

    ws.on('close', () => {
      leaveReefRoom(ws);
      setSocketAppActive(ws, false);
      const set = clients.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          clients.delete(userId);
          touchLastOnline(userId);
        }
      }
      if (process.env.WS_VERBOSE_CONNECTION_LOGS === '1') {
        console.log(`[WS] disconnected user=${userId} online=${clients.size}`);
      }
    });

    ws.on('error', () => {});
  });

  // 每 30 秒清理断线连接
  heartbeatTimer = setInterval(() => {
    if (!wss) { clearInterval(heartbeatTimer); return; }
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  console.log('[WS] WebSocket 服务已启动');
  return wss;
}

function shutdown() {
  if (!wss) return Promise.resolve();
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (lastOnlineTimer) {
    clearInterval(lastOnlineTimer);
    lastOnlineTimer = null;
  }
  if (wss?._shellTimer) {
    clearInterval(wss._shellTimer);
    wss._shellTimer = null;
  }
  flushLastOnline();
  shellOnlineSessions.forEach((_, userId) => flushShellProgressForUser(userId));
  coalescedBroadcasts.forEach((entry) => clearTimeout(entry.timer));
  coalescedBroadcasts.clear();
  roomMessageBatches.forEach((entry) => clearTimeout(entry.timer));
  roomMessageBatches.clear();
  shellOnlineSessions.clear();
  const closingServer = wss;
  wss = null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clients.clear();
      roomPresence.clear();
      resolve();
    };
    const terminateTimer = setTimeout(() => {
      closingServer.clients.forEach((ws) => ws.terminate());
      finish();
    }, 2500);
    closingServer.clients.forEach((ws) => {
      if (ws.readyState === 1) ws.close(1012, 'server_restart');
    });
    closingServer.close(() => {
      clearTimeout(terminateTimer);
      finish();
    });
  });
}

function roomUpdated(roomId, action) {
  broadcastCoalesced(`reef-presence:${roomId}`, { type: 'reef_room_updated', roomId, action }, 100);
}

function leaveReefRoom(ws) {
  const roomId = ws.reefRoomId;
  if (!roomId) return;
  const members = roomPresence.get(roomId);
  const member = members?.get(ws.userId);
  if (member) {
    member.sockets.delete(ws);
    if (member.sockets.size === 0) members.delete(ws.userId);
  }
  if (members?.size === 0) roomPresence.delete(roomId);
  ws.reefRoomId = null;
  roomUpdated(roomId, 'presence');
}

function joinReefRoom(ws, roomId) {
  if (ws.reefRoomId === roomId) return;
  const room = db.prepare("SELECT id,capacity FROM reef_rooms WHERE id=? AND status='active'").get(roomId);
  if (!room) {
    safeSend(ws, eventPayload({ type: 'reef_error', roomId, error: '礁石不存在' }));
    return;
  }
  leaveReefRoom(ws);
  if (!roomPresence.has(roomId)) roomPresence.set(roomId, new Map());
  const members = roomPresence.get(roomId);
  if (!members.has(ws.userId) && members.size >= room.capacity) {
    safeSend(ws, eventPayload({ type: 'reef_error', roomId, error: '礁石人数已满' }));
    return;
  }
  let member = members.get(ws.userId);
  if (!member) {
    member = {
      sockets: new Set(),
      joinedAt: Date.now(),
      nickname: ws.profile.nickname || ws.profile.username || '用户',
      avatar: ws.profile.avatar || null,
      gender: ws.profile.gender || '',
    };
    members.set(ws.userId, member);
  }
  member.sockets.add(ws);
  ws.reefRoomId = roomId;
  db.prepare(`
    INSERT INTO reef_members(room_id,user_id,first_joined_at,last_joined_at)
    VALUES (?,?,datetime('now','+8 hours'),datetime('now','+8 hours'))
    ON CONFLICT(room_id,user_id) DO UPDATE SET last_joined_at=excluded.last_joined_at
  `).run(roomId, ws.userId);
  safeSend(ws, eventPayload({ type: 'reef_entered', roomId }));
  roomUpdated(roomId, 'presence');
}

function getRoomPresence(roomId) {
  const members = roomPresence.get(roomId);
  if (!members) return [];
  return [...members.entries()]
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt)
    .map(([userId, member]) => ({
      userId,
      nickname: member.nickname,
      avatar: member.avatar,
      gender: member.gender,
    }));
}

function broadcastRoom(roomId, data) {
  const members = roomPresence.get(roomId);
  if (!members) return;
  const payload = eventPayload(data);
  const sourceUserId = data?.message?.userId || data?.fromUserId || '';
  members.forEach((member, viewerId) => member.sockets.forEach(ws => {
    if (sourceUserId && isBlockedPair(viewerId, sourceUserId)) return;
    safeSend(ws, payload);
  }));
}

/**
 * 推送给指定用户
 * @param {string} userId
 * @param {object} data
 */
function send(userId, data) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const payload = eventPayload(data);
  set.forEach((ws) => {
    safeSend(ws, payload);
  });
}

/**
 * 推送给多个用户
 */
function sendTo(userIds, data) {
  userIds.forEach((uid) => send(uid, data));
}

/**
 * 广播给所有在线用户
 */
function broadcast(data) {
  const payload = eventPayload(data);
  const sourceUserId = data?.message?.userId || data?.latestMessage?.userId || data?.fromUserId || '';
  wss?.clients.forEach((ws) => {
    if (sourceUserId && isBlockedPair(ws.userId, sourceUserId)) return;
    safeSend(ws, payload);
  });
}

function getOnlineCount() {
  return clients.size;
}

function isOnline(userId) {
  return clients.has(String(userId));
}

function flushRoomMessageBatch(roomId) {
  const entry = roomMessageBatches.get(roomId);
  if (!entry) return;
  roomMessageBatches.delete(roomId);
  const members = roomPresence.get(roomId);
  if (!members || entry.messages.length === 0) return;
  const base = { type: 'reef_message_batch', roomId, messages: entry.messages };
  const fullPayload = eventPayload(base);
  members.forEach((member, viewerId) => {
    const visibleMessages = entry.messages.filter(message => !isBlockedPair(viewerId, message.userId));
    if (visibleMessages.length === 0) return;
    const payload = visibleMessages.length === entry.messages.length
      ? fullPayload
      : eventPayload({ ...base, messages: visibleMessages });
    member.sockets.forEach(ws => safeSend(ws, payload));
  });
}

/**
 * A short batch window keeps message order but turns a burst of N messages to
 * M room members from N*M WebSocket frames into roughly M frames.
 */
function broadcastRoomMessage(roomId, message, delayMs = 20) {
  const normalizedRoomId = String(roomId);
  const existing = roomMessageBatches.get(normalizedRoomId);
  if (existing) {
    existing.messages.push(message);
    return;
  }
  const entry = { messages: [message], timer: null };
  entry.timer = setTimeout(() => flushRoomMessageBatch(normalizedRoomId), Math.max(5, delayMs));
  entry.timer.unref();
  roomMessageBatches.set(normalizedRoomId, entry);
}

function getPressureStats() {
  return {
    connections: wss?.clients.size || 0,
    users: clients.size,
    activeRooms: roomPresence.size,
    pendingLastOnline: pendingLastOnline.size,
    pendingCoalescedBroadcasts: coalescedBroadcasts.size,
    pendingRoomMessageBatches: roomMessageBatches.size,
    limits: {
      connections: MAX_CONNECTIONS,
      connectionsPerUser: MAX_CONNECTIONS_PER_USER,
      socketBufferBytes: MAX_SOCKET_BUFFER_BYTES,
      payloadBytes: MAX_PAYLOAD_BYTES,
    },
    ...pressureCounters,
  };
}

module.exports = {
  init,
  shutdown,
  send,
  sendTo,
  broadcast,
  getOnlineCount,
  isOnline,
  getRoomPresence,
  broadcastRoom,
  broadcastRoomMessage,
  broadcastCoalesced,
  updateBlockPair,
  reloadBlockedPairs,
  getPressureStats,
};
