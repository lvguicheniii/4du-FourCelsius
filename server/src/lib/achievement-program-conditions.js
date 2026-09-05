const ACHIEVEMENT_PROGRAM_CONDITIONS = Object.freeze({
  absolute_zero: '服务端在成功对自己或他人的切片使用制冷剂后递增 refrigerant_uses 计数；每跨过 10 的倍数时调用成就触发器。',
  deep_hibernation: '用户登录时，服务端用 last_online_at（缺失时用 last_login_at）与当前时间比较；间隔达到 48 小时即触发。',
  resonant_echo: '潜流域客户端在声呐模式成功随机取到他人信标时上报；服务端仅校验登录态和允许上报的成就 key。',
  brief_current: '礁石生命周期任务因留存投票人数不足销毁房间后，为创建者触发；按礁石 ID 去重。',
  first_alarm: '管理者接收用户提交的举报并完成二审结算后，为举报人触发。',
  sonar_short_circuit: '管理者驳回举报，结算产生负向熵值变化，且举报人当前 calibration_value 已低于 0 时触发。',
  sentient_cable: '潜流域客户端连续打捞 44 份普通失温切片且未点击“查看完整切片”时上报；计数保存在当前页面内，查看完整切片、达成或退出页面会重置。服务端不复核次数。',
  words_unsaid: '发布页确认丢弃草稿时，客户端检查 content.length > 50 后上报；服务端不复核草稿内容。',
  r600a: '用户首次成功对自己或他人的 active 切片调用制冷剂推荐加权接口后触发；赠予其他用户不触发。',
  hand_fragrance: '用户首次通过个人主页、私信或评论入口成功赠予其他用户 1 枚脆弱浮霜贝后触发；给切片使用制冷剂不触发。',
  active_cooling: '用户首次为他人的切片新增 post_cools 记录时由服务端触发；给自己的切片降温不触发。',
  make_ripples: '评论创建成功，且切片作者不是评论者本人才由服务端触发。',
  abyss_dive: '潜流域页面首次挂载时由客户端上报；服务端仅校验登录态和允许上报的成就 key。',
  ground_state: '用户在浮霜带已选中状态下 400ms 内再次点击入口，客户端跳转永冻层并上报；服务端不复核点击行为。',
  hz52_broadcast: '用户没有现存信标时成功新建一枚深海信标，由服务端触发；重复提交已有信标不触发。',
  slice_salvage: '潜流域客户端在普通打捞模式成功从池中取到一份切片时上报；服务端不复核打捞结果。',
  prepare_slice: '切片通过服务端校验并成功写入 posts 表后触发。',
  lay_cable: '私信接口成功写入一条非 system 类型消息后，为发送者触发。',
  pelican_town_local: '登录/注册页已激活像素鸡状态后，在登录或注册成功、API token 已同步写入客户端时上报；服务端仅校验登录态和允许上报的成就 key。',
});

function getAchievementProgramCondition(key) {
  return ACHIEVEMENT_PROGRAM_CONDITIONS[key] || '尚未登记程序判定说明。';
}

module.exports = { ACHIEVEMENT_PROGRAM_CONDITIONS, getAchievementProgramCondition };
