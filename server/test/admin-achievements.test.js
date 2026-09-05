const test = require('node:test');
const assert = require('node:assert/strict');
const registerAdminAchievements = require('../src/routes/admin/append3');

function createHarness() {
  const routes = { get: new Map(), put: new Map() };
  const updates = [];
  const current = {
    key: 'pelican_town_local',
    name: '鹈鹕镇老乡',
    hint: '星露谷永远有下一个春天，你也是。',
    condition_text: '触发像素鸡彩蛋',
    is_hidden: 0,
  };
  const db = {
    prepare(sql) {
      if (sql.includes('LEFT JOIN user_achievements')) {
        return { all: () => [{ ...current, conditionText: current.condition_text, unlockedUsers: 1, triggerCount: 1 }] };
      }
      if (sql.includes('SELECT * FROM achievement_definitions')) {
        return { get: () => current };
      }
      if (sql.includes('UPDATE achievement_definitions')) {
        return { run: (...args) => updates.push(args) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const router = {
    get(path, ...handlers) { routes.get.set(path, handlers.at(-1)); },
    put(path, ...handlers) { routes.put.set(path, handlers.at(-1)); },
  };
  registerAdminAchievements(router, { adminAuth() {}, db, logAdmin() {} });
  return { routes, updates };
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
}

test('admin achievements expose code-owned program conditions', () => {
  const { routes } = createHarness();
  const res = response();
  routes.get.get('/achievements')({}, res);
  const achievement = res.payload.achievements[0];
  assert.match(achievement.programConditionText, /登录|注册/);
  assert.equal(achievement.conditionText, '触发像素鸡彩蛋');
});

test('admin can update the user-visible condition without replacing the program condition', () => {
  const { routes, updates } = createHarness();
  const res = response();
  routes.put.get('/achievements/:key')({
    params: { key: 'pelican_town_local' },
    body: {
      name: '鹈鹕镇老乡',
      hint: '春天还会再来。',
      conditionText: '在某个熟悉的页面找到一位老朋友。',
      programConditionText: '不应写入数据库',
      isHidden: true,
    },
    adminId: 'admin-1',
    ip: '127.0.0.1',
  }, res);
  assert.equal(res.payload.ok, true);
  assert.deepEqual(updates[0], [
    '鹈鹕镇老乡',
    '春天还会再来。',
    '在某个熟悉的页面找到一位老朋友。',
    1,
    'pelican_town_local',
  ]);
});
