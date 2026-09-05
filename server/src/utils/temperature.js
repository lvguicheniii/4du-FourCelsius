const { parseCst } = require('../lib/time');

/**
 * 肆度温度计算引擎
 * 
 * 温度范围: -18°C (绝对冷冻) ~ 4°C (初始) ~ 26°C (融化)
 * 对称轴心: 4°C
 */

/**
 * 计算帖子当前温度
 * @param {number} likesCount 当前降温数
 * @param {string} createdAt 帖子创建时间 (ISO 字符串)
 * @param {string|null} lastActionAt 最后互动时间 (like/comment，可为null)
 * @param {number} refrigerantCount 累计成功用于该切片的制冷剂数量
 * @returns {number} 当前温度，范围 [-18, 26]
 */
function calculateTemperature(likesCount, createdAt, lastActionAt, boardId, refrigerantCount = 0) {
  // 公告帖固定 4°C 恒温（boardId 可能是 JSON 数组如 ["announce"]）
  if (boardId && (typeof boardId === 'string') && boardId.includes('announce')) return 4;
  
  let temp = 4; // 初始 4°C

  // ===== 降温计算：3 阶段比热容模型 =====
  let remaining = likesCount;

  // 第一阶段：破冰期 4°C → 0°C，每次 -0.8°C，需要 5 次
  const phase1 = Math.min(remaining, 5);
  temp -= phase1 * 0.8;
  remaining -= phase1;

  // 第二阶段：深寒期 0°C → -10°C，对数递减，约 20 次
  if (temp <= 0 && remaining > 0) {
    const phase2 = Math.min(remaining, 20);
    for (let i = 0; i < phase2; i++) {
      temp -= (0.58 - i * 0.0025); // 从 0.58 递减到 ~0.53
    }
    remaining -= phase2;
  }

  // 第三阶段：绝对零度 -10°C → -18°C，每次 -0.1°C，需要 80 次
  if (temp <= -10 && remaining > 0) {
    temp -= remaining * 0.1;
  }

  // 每瓶成功用于切片的制冷剂永久额外降低 1°C。
  temp -= Math.max(0, Number(refrigerantCount) || 0);

  // 下限锁定
  if (temp < -18) temp = -18;

  // ===== 升温计算：牛顿冷却定律 =====
  const now = new Date();
  const created = parseCst(createdAt) || new Date();
  const hoursSinceCreation = (now - created) / (1000 * 60 * 60);
  const hoursSinceLastAction = lastActionAt
    ? (now - (parseCst(lastActionAt) || now)) / (1000 * 60 * 60)
    : hoursSinceCreation;

  // 升温基准（温度>=0时速率0.2°C/h）
  const warmRate = 0.2;

  if (hoursSinceLastAction < 1) {
    // 最近有互动：仅累计到上次互动为止的升温，暂停后续升温
    const warmHours = Math.max(0, hoursSinceCreation - hoursSinceLastAction);
    temp += warmHours * warmRate;
  } else {
    // 无近期互动：累计全部升温
    temp += hoursSinceCreation * warmRate;
  }

  if (temp > 26) temp = 26;

  return Math.round(temp * 10) / 10;
}

module.exports = { calculateTemperature };
