const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.resolve(__dirname, '../../community-web');
const read = (file) => fs.readFileSync(path.join(webRoot, file), 'utf8');

test('community web is isolated under its own build and production path', () => {
  const pkg = JSON.parse(read('package.json'));
  const vite = read('vite.config.ts');
  const guide = read('README.md');
  assert.equal(pkg.name, 'community-web');
  assert.match(vite, /base: process\.env\.CF_PAGES \? ["']\/["'] : ["']\/community\/["']/);
  assert.match(guide, /\/var\/www\/sidu-community-web\/releases\//);
});

test('web sessions are tab-scoped and do not reuse App tokens', () => {
  const api = read('src/api.ts');
  const session = read('src/session.tsx');
  assert.match(api, /sessionStorage\.getItem/);
  assert.match(api, /\/api\/auth\/web-login/);
  assert.match(api, /\/api\/auth\/web-logout/);
  assert.match(session, /new WebSocket/);
});

test('Live Photos render only still images in the web client', () => {
  const ui = read('src/ui.tsx');
  const screens = read('src/screens.tsx');
  assert.match(ui, /item\.stillUrl/);
  assert.match(screens, /value\.stillUrl/);
  assert.match(`${ui}\n${screens}`, /实况 · 静态预览/);
  assert.doesNotMatch(`${ui}\n${screens}`, /<video/i);
});

test('web UI uses coded dialogs instead of browser alerts', () => {
  const source = ['src/app.tsx', 'src/screens.tsx', 'src/ui.tsx'].map(read).join('\n');
  assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(source, /<Modal/);
});

test('web navigation and legal content stay aligned with the App experience', () => {
  const html = read('index.html');
  const app = read('src/app.tsx');
  const screens = read('src/screens.tsx');
  assert.match(html, /<title>肆度<\/title>/);
  assert.match(html, /\.\/4dulogo_original\.png\?v=20260826c/);
  assert.match(app, /import\.meta\.env\.BASE_URL\}4dulogo_original\.png\?v=20260826c/);
  assert.doesNotMatch(html, /<title>肆度社区<\/title>/);
  assert.match(app, /className=\{cx\("floating-messages"/);
  assert.doesNotMatch(app, /\["messages",\s*Message/);
  assert.match(app, /logo_day\.png/);
  assert.match(app, /logo_night\.png/);
  assert.match(`${app}\n${screens}`, /community-app\/src\/data\/legal-documents/);
  assert.doesNotMatch(screens, /<b>离地而居<\/b>/);
  assert.match(screens, /<b>霜迹<\/b>/);
});

test('desktop web keeps a wide center column for the complete profile capsule row', () => {
  const styles = read('src/styles.css');
  assert.match(styles, /grid-template-columns: 224px minmax\(560px, 800px\) 300px/);
  assert.match(styles, /max-width: 1400px/);
  assert.match(styles, /\.profile-capsules \{[^}]*flex-wrap:wrap[^}]*overflow-x:visible/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*grid-template-columns: 210px minmax\(0, 1fr\)/);
});

test('web home and global top navigation remain connected to the community', () => {
  const app = read('src/app.tsx');
  const screens = read('src/screens.tsx');
  const styles = read('src/styles.css');
  const homeSource = screens.slice(
    screens.indexOf('export function HomeScreen'),
    screens.indexOf('function CommentRow'),
  );
  assert.match(app, /const legacy = location\.hash\.replace\([\s\S]*?legacy \|\| cleanRouteToInternal\(location\.pathname\)/);
  assert.match(app, /root === "home"[^\n]*<HomeScreen/);
  assert.match(app, /className="site-topbar"/);
  assert.match(app, />\s*首页\s*<\/button>/);
  assert.match(app, />\s*社区\s*<\/button>/);
  assert.match(app, /className="site-publish-button"[^>]*[\s\S]*?制备切片/);
  assert.match(app, /className="site-profile-button"/);
  assert.match(app, /className="site-profile-popover"/);
  assert.match(app, /!isFullWidthPage && <button[\s\S]*?className=\{cx\("floating-messages"/);
  assert.match(app, /onLogout=\{\(\) => void logout\(\)\.then\(\(\) => navigate\("home"\)\)\}/);
  assert.match(screens, /export function HomeScreen/);
  assert.match(screens, /低温情绪社区/);
  assert.match(screens, /className="home-slice-preview"/);
  assert.match(screens, /className="home-board-grid"/);
  assert.equal((homeSource.match(/<CoolingIcon/g) || []).length, 3);
  assert.equal((homeSource.match(/<BoardGlyph/g) || []).length, 5);
  assert.doesNotMatch(homeSource, /<Snowflake/);
  assert.match(homeSource, /const navigateFromHome = \(route: string\)/);
  assert.match(homeSource, /window\.requestAnimationFrame\([\s\S]*window\.requestAnimationFrame\([\s\S]*window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(homeSource, /浏览全部冰格[\s\S]*navigateFromHome\("feed\/recommend"\)[\s\S]*navigateFromHome\("reefs"\)[\s\S]*requireLogin\(\) && navigateFromHome\("messages"\)/);
  assert.equal((homeSource.match(/navigateFromHome\("boards"\)/g) || []).length, 1);
  assert.match(homeSource, /navigateFromHome\("board\/b1"\)[\s\S]*navigateFromHome\("board\/board_love"\)[\s\S]*navigateFromHome\("board\/board_anime"\)[\s\S]*navigateFromHome\("board\/board_slacking"\)[\s\S]*navigateFromHome\("board\/board_lovewins"\)/);
  assert.match(homeSource, /BoardGlyph icon="cafe-outline"[\s\S]*BoardGlyph icon="heart-outline"[\s\S]*BoardGlyph icon="sparkles-outline"[\s\S]*BoardGlyph icon="fish-outline"[\s\S]*BoardGlyph icon="heart-circle-outline"/);
  assert.match(homeSource, /#7C6CF2[\s\S]*#FF6B9A[\s\S]*#25BFD3[\s\S]*#2EB89F[\s\S]*#FF5F7E/);
  assert.match(homeSource, /<strong>NOW<\/strong>[\s\S]*<strong>恋爱<\/strong>[\s\S]*<strong>二次元<\/strong>[\s\S]*<strong>摸鱼<\/strong>[\s\S]*<strong>LoveWins<\/strong>/);
  assert.match(homeSource, /每个人，都是一座孤岛。/);
  assert.doesNotMatch(homeSource, /按自己的节奏，靠近别人。/);
  assert.match(homeSource, /--home-board-color/);
  assert.match(homeSource, /className="home-preview-temperature-track"/);
  assert.doesNotMatch(styles, /\.home-preview-temperature > span\s*\{/);
  assert.match(homeSource, /4°C——低温情绪社区/);
  assert.match(homeSource, /<p className="home-hero-lead">凡真实的人生，皆为相遇。<\/p>/);
  assert.doesNotMatch(homeSource, /把此刻制备成一枚切片/);
  assert.match(homeSource, /什么？你也是？我还以为只有我。/);
  assert.doesNotMatch(homeSource, /不急着给情绪命名。先把这一刻放在这里，等一场真实的相遇。/);
  assert.doesNotMatch(homeSource, /home-secondary-action/);
  assert.match(homeSource, /<b>-18°C<\/b>[\s\S]*?<b>26°C<\/b>/);
  assert.match(homeSource, /<span>降温 <CoolingIcon size=\{17\} \/> 128<\/span>/);
  assert.match(homeSource, /43 个冰格/);
  assert.equal((homeSource.match(/凡真实的人生，皆为相遇。/g) || []).length, 1);
  assert.doesNotMatch(screens, /home(?:Publish|Boards|Reefs|Undercurrent)Image/);
  assert.match(screens, /进入社区/);
  assert.doesNotMatch(screens, /home-orbit|home-visual-core/);
  assert.match(styles, /\.site-topbar \{[^}]*position: sticky;/);
  assert.match(styles, /\.site-topbar-inner \{[^}]*width: 100%;[^}]*max-width: none;[^}]*padding: 0 clamp\(16px, 2vw, 28px\)/);
  assert.match(styles, /html::\-webkit-scrollbar-button[\s\S]*?display: none !important;/);
  assert.match(styles, /\.site-profile-popover \{[^}]*background: rgba\(247, 253, 255, 0\.78\);[^}]*backdrop-filter: blur\(20px\)/);
  assert.match(styles, /\.home-hero \{[^}]*grid-template-columns:/);
  assert.match(styles, /\.home-stage-temperature \{[^}]*top: -20px;/);
  assert.match(styles, /\.home-feature-story \{[^}]*border: 1px solid rgba\(91, 184, 217, \.48\);[^}]*border-radius: 8px;/);
  assert.match(styles, /\.home-board-atlas \{[^}]*padding: 0;/);
  assert.match(styles, /\.home-closing \{[^}]*padding: 38px 0 28px;/);
  assert.doesNotMatch(styles, /\.home-closing \{[^}]*border-top:/);
  assert.match(styles, /:root\[data-theme="dark"\][\s\S]*\.home-page \.app-snowflake-icon \{ color: #8be4ff !important; \}/);
  assert.match(styles, /\.home-board-grid button \{[^}]*background: var\(--home-board-color\)/);
  assert.match(styles, /\.home-board-grid button \{[\s\S]*background: color-mix\(in srgb, var\(--home-board-color\) 16%, transparent\)/);
  assert.doesNotMatch(styles, /\.home-board-grid button \{[^}]*background: rgba\(48, 100, 122, \.4\) !important/);
  assert.match(styles, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.0/README.md')), true);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.0/screens.tsx')), true);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.0/styles.css')), true);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.1/README.md')), true);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.1/app.tsx')), true);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.1/screens.tsx')), true);
  assert.equal(fs.existsSync(path.join(webRoot, 'design-backups/home-1.1/styles.css')), true);
});

test('frost trail uses cooled posts without inheriting the main feed header', () => {
  const api = read('src/api.ts');
  const screens = read('src/screens.tsx');
  assert.match(api, /cooledPosts: \(\) => request<any>\("\/api\/posts\/cooled"\)/);
  assert.doesNotMatch(api, /likedPosts:/);
  assert.match(screens, /navigate\("feed\/cooled"\)/);
  assert.match(screens, /mode === "cooled"[\s\S]*\? "霜迹"/);
  assert.match(screens, /mainFeedModes = \["following", "recommend", "latest", "announce"\]/);
  assert.match(screens, /isMainFeed = [^;]*mainFeedModes\.includes\(mode\)/);
});

test('admin browser icon reuses the rounded community logo', () => {
  const adminRoot = path.resolve(__dirname, '../src/public/admin');
  const admin = fs.readFileSync(path.join(adminRoot, 'index.html'), 'utf8');
  assert.match(admin, /\/admin\/favicon\.png\?v=20260826c/);
  assert.deepEqual(
    fs.readFileSync(path.join(adminRoot, 'favicon.png')),
    fs.readFileSync(path.join(webRoot, 'public/4dulogo_original.png')),
  );
});

test('web achievements and profile inventory mirror App-facing details', () => {
  const screens = read('src/screens.tsx');
  const ui = read('src/ui.tsx');
  const styles = read('src/styles.css');
  assert.match(screens, /达成条件：\{selected\?\.conditionText\}/);
  assert.match(screens, /解锁时间：\{formatFullDateTime\(selected\.unlockedAt\)\}/);
  assert.match(screens, /disabled=\{!item\.unlocked\}/);
  assert.match(screens, /举报成功后 \+5 熵减值/);
  assert.match(screens, /Lv\.4  肆度守望者/);
  assert.match(ui, /cracked = false/);
  assert.match(ui, /M32 31C28\.9 27\.2/);
  assert.match(screens, /FrostShellIcon size=\{29\} cracked/);
  assert.match(screens, /FrostShellIcon size=\{29\}\/><span><b>永恒浮霜贝<\/b>/);
  assert.doesNotMatch(screens, /profile-avatar-edit/);
  assert.match(styles, /\.web-gender-badge \{[^}]*width: 29px;[^}]*height: 25px/);
  assert.match(styles, /\.web-gender-badge \{[^}]*color: var\(--gender-color\);[^}]*background: var\(--gender-background\);/);
  assert.match(styles, /\.web-gender-badge\.male \{[^}]*--gender-color: #5ba0d9;[^}]*--gender-background: rgba\(91, 160, 217, 0\.09\);/);
  assert.match(styles, /\.web-gender-badge\.female \{[^}]*--gender-color: #f08cb4;[^}]*--gender-background: rgba\(240, 140, 180, 0\.09\);/);
  assert.match(styles, /\.tags > span:not\(\.web-gender-badge\)/);
  assert.doesNotMatch(styles, /\.tags > \.web-gender-badge/);
  assert.doesNotMatch(styles, /\.tags \.profile-gender/);
  assert.doesNotMatch(ui, /compact \?\? false|compact &&/);
  assert.match(styles, /\.achievement-detail \.achievement-condition[^}]*text-align:center/);
  assert.match(styles, /\.entropy-description p[^}]*font-style:italic[^}]*text-align:center/);
  assert.match(styles, /\.legal-links button[\s\S]*?font-size: 12px/);
});

test('web-only navigation, theme, and undercurrent parity remain available', () => {
  const app = read('src/app.tsx');
  const screens = read('src/screens.tsx');
  const api = read('src/api.ts');
  assert.match(app, /sidu-web-theme/);
  assert.match(app, /className="theme-toggle"/);
  assert.doesNotMatch(app, /\["profile",/);
  assert.doesNotMatch(app, /\["favorites",/);
  assert.match(app, /全部话题/);
  assert.doesNotMatch(screens, /FOUR CELSIUS/);
  assert.match(screens, /mode === "salvage"/);
  assert.match(screens, /className="undercurrent-wheel"/);
  assert.match(screens, /投放信标/);
  assert.match(api, /\/api\/posts\/capsule-texts/);
  assert.match(api, /\/api\/beacons\/counts/);
});

test('web discovery hides deferred and system-only entries', () => {
  const app = read('src/app.tsx');
  const screens = read('src/screens.tsx');
  assert.doesNotMatch(app, /\["undercurrent",\s*Fish/);
  assert.match(screens, /category !== "系统"/);
  assert.match(screens, /\["free", "announce"\]\.includes/);
  assert.match(screens, /\.filter\(isPublicBoard\)/);
  assert.match(screens, /replace\(\/\^#\+\\s\*\//);
});

test('web post interactions and presentation follow App rules', () => {
  const ui = read('src/ui.tsx');
  const screens = read('src/screens.tsx');
  const styles = read('src/styles.css');
  assert.match(ui, /onClick=\{\(e\) => e\.stopPropagation\(\)\}/);
  assert.match(ui, /\(\(post\.temperature \+ 18\) \/ 44\) \* 100/);
  assert.match(styles, /#33a9dc 0%[\s\S]*#90b0c4 50%[\s\S]*#ff6b35 100%/);
  assert.match(styles, /\.comment-actions \.liked\s*\{\s*color: #e45567/);
  assert.match(styles, /\.cover img[\s\S]*object-fit: contain/);
  assert.match(ui, /className="post-author-button"[\s\S]*if \(canOpenAuthor\) onUser\(authorId\)/);
  assert.match(styles, /\.media-grid\.one \.media-cell img \{[\s\S]*max-height: min\(420px, 55vh\);[\s\S]*object-fit: contain/);
  assert.match(styles, /\.media-grid\.one \.media-cell \{[\s\S]*width: fit-content;[\s\S]*background: transparent/);
  assert.match(styles, /\.media-grid\.one \{[\s\S]*justify-content: flex-start/);
  assert.match(styles, /\.comment-reply-prefix \.comment-reply-author \{[\s\S]*color: #e84393 !important/);
  assert.match(screens, /<Layers3 size=\{22\} \/>/);
});

test('web publishing returns to the latest feed instead of opening post detail', () => {
  const screens = read('src/screens.tsx');
  const publishScreen = screens.slice(
    screens.indexOf('export function PublishScreen'),
    screens.indexOf('export function MessagesScreen'),
  );
  assert.match(publishScreen, /await api\.createPost\([\s\S]*?navigate\("feed\/latest"\)/);
  assert.doesNotMatch(publishScreen, /navigate\(`post\/\$\{/);
});

test('web messaging, reefs, and profiles retain App interaction parity', () => {
  const app = read('src/app.tsx');
  const api = read('src/api.ts');
  const screens = read('src/screens.tsx');
  const ui = read('src/ui.tsx');
  const styles = read('src/styles.css');
  assert.match(app, /config\?\.dailyTopic/);
  assert.doesNotMatch(app, /room\.onlineCount/);
  assert.match(app, /room\.currentCount/);
  assert.match(screens, /onContextMenu=/);
  assert.match(screens, /hidden: true/);
  assert.match(screens, /room\.zone === zone/);
  assert.match(screens, /formatChatTime\(item\.time/);
  assert.match(screens, /<GenderBadge gender=\{profile\.gender\}/);
  assert.match(screens, /tagCategories\.map/);
  assert.match(screens, /title=\{type === "following" \? "关注" : "粉丝"\}/);
  assert.doesNotMatch(screens, /title=\{type === "following" \? "关注" : "被关注"\}/);
  assert.match(screens, /每天在线4分钟可获得1枚【脆弱浮霜贝】，日上限1枚，存储上限4枚。/);
  assert.match(screens, /每天首次登录获得 1 瓶制冷剂，最多储存 4 瓶。/);
  assert.match(screens, /profileModal === "refrigerant"[\s\S]*title="制冷剂"/);
  assert.doesNotMatch(screens, /> 更换背景/);
  assert.match(screens, /profile-avatar-upload/);
  assert.match(screens, /URL\.createObjectURL\(file\)/);
  assert.match(styles, /\.profile-body \{[\s\S]*padding: 0 22px 12px;/);
  assert.match(api, /\/api\/stickers/);
  assert.match(ui, /composer-panel-tabs/);
  assert.match(ui, /EMOJI_GROUPS/);
});
