export type Board = {
  id: string;
  name: string;
  desc: string;
  color: string;
  colorDark: string;
  icon: string;
  category?: string;
  active?: number | boolean;
  members: number;
  posts: number;
};

export type Post = {
  id: string;
  author: string;
  authorUid: string;
  avatarColor: string;
  boardId: string;
  time: string;
  content: string;
  image?: string;
  images?: string[];
  likes: number;
  comments: number;
};

export type Conversation = {
  id: string;
  name: string;
  avatarColor: string;
  lastMessage: string;
  time: string;
  unread: number;
};

export type Comment = {
  id: string;
  postId: string;
  author: string;
  avatarColor: string;
  time: string;
  content: string;
  image?: string;
  likes: number;
};

export type ChatMessage = {
  id: string;
  from: 'me' | 'other';
  kind: 'text' | 'sticker' | 'image' | 'video' | 'live_photo' | 'system' | 'post_context' | 'comment_context';
  content: string;
  time: string;
  clientId?: string;
  localPreviewUri?: string;
  localPreviewSize?: { width: number; height: number };
};

export const boards: Board[] = [
  { id: 'b1', name: '闲聊', desc: '', color: '#6C5CE7', colorDark: '#A29BFE', icon: 'cafe', members: 12840, posts: 3204 },
  { id: 'b2', name: '科技', desc: '', color: '#00B894', colorDark: '#55EFC4', icon: 'hardware-chip', members: 8231, posts: 1876 },
  { id: 'b3', name: '美食', desc: '', color: '#E17055', colorDark: '#FAB1A0', icon: 'restaurant', members: 9567, posts: 2451 },
  { id: 'b4', name: '游戏', desc: '', color: '#E84393', colorDark: '#FD79A8', icon: 'game-controller', members: 15320, posts: 4102 },
  { id: 'b5', name: '旅行', desc: '', color: '#0984E3', colorDark: '#74B9FF', icon: 'airplane', members: 5642, posts: 987 },
  { id: 'b6', name: '阅读', desc: '', color: '#00CEC9', colorDark: '#81ECEC', icon: 'book', members: 4210, posts: 756 },
  { id: 'b15', name: '电影', desc: '', color: '#636E72', colorDark: '#B2BEC3', icon: 'film', members: 6120, posts: 1340 },
  { id: 'b7', name: '宠物', desc: '', color: '#E17055', colorDark: '#FDCB6E', icon: 'paw', members: 11205, posts: 3568 },
  { id: 'b8', name: '健身', desc: '', color: '#27AE60', colorDark: '#55E6C1', icon: 'barbell', members: 7433, posts: 1620 },
  { id: 'b9', name: '职场', desc: '', color: '#2D98DA', colorDark: '#45AAF2', icon: 'briefcase', members: 6871, posts: 1443 },
  { id: 'b10', name: '校园', desc: '', color: '#3867D6', colorDark: '#4B7BEC', icon: 'school', members: 9024, posts: 2087 },
  { id: 'b11', name: '音乐', desc: '', color: '#E84393', colorDark: '#FD79A8', icon: 'musical-notes', members: 5310, posts: 934 },
  { id: 'b12', name: '摄影', desc: '', color: '#8854D0', colorDark: '#A55EEA', icon: 'camera', members: 4786, posts: 1102 },
  { id: 'b13', name: '树洞', desc: '', color: '#33A9DC', colorDark: '#7FD8F5', icon: 'heart-half', members: 8659, posts: 2764 },
  { id: 'b14', name: '家居', desc: '', color: '#F7B731', colorDark: '#FED330', icon: 'home', members: 3980, posts: 671 },
  { id: 'board_ootd', name: 'OOTD', desc: '', color: '#F06A9B', colorDark: '#F7A4C2', icon: 'shirt-outline', category: '生活', members: 0, posts: 0 },
  { id: 'board_sleep', name: '睡觉', desc: '', color: '#6D8FE8', colorDark: '#A5BAF4', icon: 'bed-outline', category: '生活', members: 0, posts: 0 },
  { id: 'board_cycling', name: '骑行', desc: '', color: '#22B98A', colorDark: '#72D9B5', icon: 'bicycle-outline', category: '生活', members: 0, posts: 0 },
  { id: 'free', name: '游离态', desc: '未选择冰格的默认标签', color: '#90B0C8', colorDark: '#B0C8D8', icon: 'square-outline', members: 0, posts: 0 },
  { id: 'announce', name: '公告', desc: '官方公告', color: '#F7B731', colorDark: '#FED330', icon: 'megaphone', members: 0, posts: 0 },
];

export const posts: Post[] = [];
export const conversations: Conversation[] = [
  { id: 'c1', name: '山间清风', avatarColor: '#33A9DC', lastMessage: '好的，那条线路的攻略我整理好发你', time: '10:12', unread: 2 },
  { id: 'c2', name: 'Tech小王', avatarColor: '#1D9E75', lastMessage: '评测视频周末应该能剪出来', time: '09:47', unread: 0 },
  { id: 'c3', name: '深夜干饭人', avatarColor: '#D85A30', lastMessage: '[图片]', time: '昨天', unread: 5 },
  { id: 'c4', name: '一只咸鱼', avatarColor: '#993556', lastMessage: '晚上八点开黑，别鸽', time: '昨天', unread: 0 },
  { id: 'c5', name: '系统通知', avatarColor: '#888780', lastMessage: '你的切片收到了新的降温', time: '周一', unread: 1 },
];

export const comments: Comment[] = [
  { id: 'cm1', postId: 'p1', author: '背包客小李', avatarColor: '#1D9E75', time: '3分钟前', content: '这也太出片了吧，求具体路线！', likes: 12 },
  { id: 'cm2', postId: 'p1', author: '在路上', avatarColor: '#BA7517', time: '2分钟前', content: '折多山我去的时候全是雾，羡慕了', likes: 8 },
  { id: 'cm3', postId: 'p1', author: '摄影穷三代', avatarColor: '#993556', time: '刚刚', content: '这光线绝了，什么时间拍的？', likes: 3 },
  { id: 'cm4', postId: 'p2', author: '干饭魂', avatarColor: '#185FA5', time: '10分钟前', content: '坐标发一下，明天就去', likes: 20 },
  { id: 'cm5', postId: 'p2', author: '过路的', avatarColor: '#33A9DC', time: '5分钟前', content: '22 一碗确实可以，比我楼下便宜', likes: 6 },
  { id: 'cm6', postId: 'p3', author: '数码羊毛党', avatarColor: '#D85A30', time: '40分钟前', content: '1，等详细评测再决定要不要换', likes: 31 },
  { id: 'cm7', postId: 'p4', author: '峡谷养老院', avatarColor: '#854F0B', time: '1小时前', content: '心态就是：下把还是这样就睡觉', likes: 15 },
  { id: 'cm8', postId: 'p5', author: '书虫一枚', avatarColor: '#0F6E56', time: '2小时前', content: '同感，马尔克斯要多读几遍才有味道', likes: 9 },
  { id: 'cm9', postId: 'p6', author: '摸鱼选手', avatarColor: '#72243E', time: '3小时前', content: '你这个坏消息过于真实了', likes: 44 },
];

export const userBios: Record<string, string> = {
  山间清风: '在路上，去看更大的世界',
  深夜干饭人: '本地探店雷达，只推真好吃的',
  Tech小王: '数码测评 / 不恰饭，只说真话',
  一只咸鱼: '峡谷混子，赢一把就睡',
  阅读记录本: '一年 50 本书计划进行中',
  路人甲: '快乐是自己给的',
};

export const seedChats: Record<string, ChatMessage[]> = {
  山间清风: [
    { id: 'm1', from: 'other', kind: 'text', content: '你上次问的川西路线，我整理了个文档', time: '10:05' },
    { id: 'm2', from: 'me', kind: 'text', content: '太好了！十一想去，就怕人多', time: '10:08' },
    { id: 'm3', from: 'other', kind: 'image', content: 'https://picsum.photos/seed/sichuan1/640/800', time: '10:09' },
    { id: 'm4', from: 'other', kind: 'text', content: '错峰走 318 支线就行，人少景还好', time: '10:10' },
    { id: 'm5', from: 'other', kind: 'text', content: '好的，那条线路的攻略我整理好发你', time: '10:12' },
  ],
  Tech小王: [
    { id: 'm1', from: 'me', kind: 'text', content: '新机评测什么时候出？等你这篇再决定换不换', time: '09:40' },
    { id: 'm2', from: 'other', kind: 'text', content: '评测视频周末应该能剪出来', time: '09:47' },
  ],
  深夜干饭人: [
    { id: 'm1', from: 'me', kind: 'text', content: '那家牛肉面具体在哪？', time: '昨天 21:30' },
    { id: 'm2', from: 'other', kind: 'text', content: '科技园北区后街，蓝色招牌', time: '昨天 21:35' },
  ],
  一只咸鱼: [
    { id: 'm1', from: 'other', kind: 'text', content: '晚上八点开黑，别鸽', time: '昨天 18:20' },
  ],
  系统通知: [
    { id: 'm1', from: 'other', kind: 'text', content: '你的切片收到了新的降温', time: '周一' },
  ],
};

export const currentUser = {
  name: '吕归尘',
  uid: '10247835',
  avatarColor: '#33A9DC',
  bio: '这个人很懒，什么都没写',
  coverImage: 'https://picsum.photos/seed/cover1/800/300',
  tags: ['社恐', '夜猫子', '书虫'] as string[],
  stats: { posts: 12, likes: 356, following: 48, followers: 102 },
};

export const tagCategories = [
  {
    title: '感情状态',
    tags: ['恋爱中', '单身', '已婚', '保密'],
    single: true,
  },
  {
    title: '星座',
    tags: ['白羊座', '金牛座', '双子座', '巨蟹座', '狮子座', '处女座', '天秤座', '天蝎座', '射手座', '摩羯座', '水瓶座', '双鱼座'],
    single: true,
  },
  {
    title: '性格特点',
    tags: ['话痨', '社恐', '社牛', '佛系', '细节控', '完美主义', '乐天派', '慢热'],
  },
  {
    title: '兴趣爱好',
    tags: ['追剧达人', '游戏玩家', '书虫', '运动健将', '美食猎人', '旅行爱好者', '音乐发烧友', '摄影爱好者'],
  },
  {
    title: '生活方式',
    tags: ['早起鸟', '夜猫子', '咖啡续命', '奶茶控', '宅家党', '户外党', '极简主义'],
  },
  {
    title: '钝角',
    tags: ['嘉豪', '神原玩家', '纳垢', 'ikun', 'popoA5', '0', '1', '叮咚鸡', '大狗叫', '咕咕嘎嘎'],
  },
] as const;

export const myPosts: Post[] = [];
export function boardName(id: string) {
  return boards.find((b) => b.id === id)?.name ?? '';
}
