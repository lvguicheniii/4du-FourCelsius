export const BOARD_CATEGORIES = [
  { name: '情绪', boardNames: ['NOW', '喜', '怒', '哀', '乐', '吐槽', '秘密', '孤独', '烦恼', '微醺', '暗恋', '丧'] },
  { name: '共鸣', boardNames: ['自拍', '恋爱', '爱豆', '可撩', '求助', '树洞'] },
  { name: '兴趣', boardNames: ['壁纸', '追剧', '二次元', '摄影', '音乐', '绘画', '抽象', '沙雕', '表情包', '游戏', '电影', '阅读'] },
  { name: '生活', boardNames: ['科技', '美食', '旅行', '宠物', '健身', '职场', '校园', '家居', '摸鱼', 'OOTD', '睡觉', '骑行'] },
  { name: '404', boardNames: ['麻了', 'Ex', 'LoveWins', '肆度反馈'] },
] as const;

export function groupBoardsByCategory<T extends { id: string; name: string; category?: string }>(boards: T[]) {
  const assignedBoardIds = new Set<string>();
  const categories = BOARD_CATEGORIES.map(category => {
    const names = new Set<string>(category.boardNames);
    const categoryBoards = boards.filter(board => board.category
      ? board.category === category.name
      : names.has(board.name));
    categoryBoards.forEach(board => assignedBoardIds.add(board.id));
    return { name: category.name, boards: categoryBoards };
  });

  const uncategorizedBoards = boards.filter(board => !assignedBoardIds.has(board.id));
  if (uncategorizedBoards.length > 0) {
    const lifeCategory = categories.find(category => category.name === '生活');
    lifeCategory?.boards.push(...uncategorizedBoards);
  }
  return categories;
}
