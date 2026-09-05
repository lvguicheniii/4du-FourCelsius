import { useEffect, useMemo, useState } from "react";
import {
  CircleHelp,
  Layers3,
  LogOut,
  Mail,
  MessagesSquare,
  Moon,
  Plus,
  Settings,
  Snowflake,
  Sun,
} from "lucide-react";
import { useRealtime, useSession } from "./session";
import { api } from "./api";
import { Avatar, CoolingIcon, GenderBadge, LoginModal, cx } from "./ui";
import logoDay from "../../community-app/assets/images/logo_day.png";
import logoNight from "../../community-app/assets/images/logo_night.png";
import { LEGAL_DOCUMENTS } from "../../community-app/src/data/legal-documents";
import {
  AccountScreen,
  AboutScreen,
  AchievementsScreen,
  BlockedScreen,
  BoardsScreen,
  BoxesScreen,
  ChatScreen,
  FavoritesScreen,
  FeedScreen,
  FeedbackScreen,
  HomeScreen,
  LegalScreen,
  MessagesScreen,
  NotificationsScreen,
  OffTheLandScreen,
  PostScreen,
  ProfileScreen,
  PublishScreen,
  ReefChatScreen,
  ReefsScreen,
  SettingsScreen,
  TopicsScreen,
  UndercurrentScreen,
  UserListScreen,
} from "./screens";

const webBase = import.meta.env.BASE_URL.replace(/\/$/, "");
function cleanRouteToInternal(pathname: string) {
  let path = decodeURI(pathname).replace(/\/+$/, "") || "/";
  const atCommunityRoot = webBase && path === webBase;
  if (webBase && path.startsWith(webBase)) path = path.slice(webBase.length) || "/";
  path = path.replace(/^\/+/, "");
  return path === "community" || (path === "" && atCommunityRoot) ? "feed/recommend" : (path || "home");
}
function internalRouteToClean(value: string) {
  if (value === "feed/recommend") return webBase || "/community";
  return `${webBase}/${value}`.replace(/\/{2,}/g, "/");
}
function routeValue() {
  const legacy = location.hash.replace(/^#\/?/, "");
  return legacy || cleanRouteToInternal(location.pathname);
}
function useRoute() {
  const [route, setRoute] = useState(routeValue);
  useEffect(() => {
    const change = () => setRoute(routeValue());
    if (location.hash) {
      const legacyRoute = routeValue();
      history.replaceState(null, "", internalRouteToClean(legacyRoute));
      setRoute(legacyRoute);
    } else if (routeValue() === "feed/recommend" && !location.pathname.endsWith("/community")) {
      history.replaceState(null, "", internalRouteToClean("feed/recommend"));
    }
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  const navigate = (value: string) => {
    const next = internalRouteToClean(value);
    if (`${location.pathname}${location.search}` !== next) history.pushState(null, "", next);
    setRoute(value);
  };
  return { route, navigate };
}
const protectedRoots = new Set([
  "messages",
  "favorites",
  "profile",
  "publish",
  "chat",
  "reef",
  "notifications",
  "boxes",
  "achievements",
  "settings",
  "blocked",
  "feedback",
  "account",
  "users",
  "off-the-land",
]);

export function App() {
  const { route, navigate } = useRoute();
  const { user, loading, logout, refresh: refreshSession } = useSession();
  const { lastEvent } = useRealtime();
  const [login, setLogin] = useState(false);
  const [incomingChat, setIncomingChat] = useState<any | null>(null);
  const [restrictionClock, setRestrictionClock] = useState(Date.now());
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("sidu-web-theme");
    const explicitlyChosen = localStorage.getItem("sidu-web-theme-explicit") === "1";
    if (explicitlyChosen && (saved === "light" || saved === "dark")) return saved;
    return "light";
  });
  const [config, setConfig] = useState<any>({ boards: [], topics: [] });
  const [reefs, setReefs] = useState<any[]>([]);
  const parts = route.split("/");
  const root = parts[0];
  const toggleTheme = () => {
    localStorage.setItem("sidu-web-theme-explicit", "1");
    setTheme((value) => (value === "dark" ? "light" : "dark"));
  };
  const banned = user?.status === "banned" &&
    (!user?.ban_until || parseRestrictionTime(user.ban_until) > restrictionClock);
  useEffect(() => {
    if (user?.status !== "banned" || !user?.ban_until) return;
    const timer = window.setInterval(() => setRestrictionClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [user?.status, user?.ban_until]);
  useEffect(() => {
    if (user?.status === "banned" && user?.ban_until && parseRestrictionTime(user.ban_until) <= restrictionClock) {
      void refreshSession();
    }
  }, [user?.status, user?.ban_until, restrictionClock, refreshSession]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme === "light" ? "only light" : "dark";
    localStorage.setItem("sidu-web-theme", theme);
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      favicon.type = "image/png";
      document.head.appendChild(favicon);
    }
    favicon.href = `${import.meta.env.BASE_URL}4dulogo_original.png?v=20260826c`;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#0e2838" : "#eef8fc",
    );
  }, [theme]);
  useEffect(() => {
    if (banned) return;
    api.config().then(setConfig).catch(() => {});
    api.reefs().then((data) => setReefs(data.rooms || [])).catch(() => {});
  }, [banned]);
  useEffect(() => {
    if (banned || !String(lastEvent?.type || "").startsWith("reef_")) return;
    api.reefs().then((data) => setReefs(data.rooms || [])).catch(() => {});
  }, [lastEvent, banned]);
  useEffect(() => {
    if (!user || lastEvent?.type !== "chat") return;
    if (lastEvent.from === "me") return;
    const senderId = String(lastEvent.from || lastEvent.peerId || "");
    if (!senderId || senderId === String(user.id) || (root === "chat" && String(parts[1]) === senderId)) return;
    setIncomingChat({
      id: senderId,
      name: lastEvent.fromName || lastEvent.peerName || "新消息",
    });
  }, [lastEvent, user?.id, root, parts[1]]);
  useEffect(() => {
    if (!incomingChat) return;
    const timer = window.setTimeout(() => setIncomingChat(null), 6000);
    return () => window.clearTimeout(timer);
  }, [incomingChat]);
  useEffect(() => {
    if (!loading && !user && protectedRoots.has(root)) setLogin(true);
  }, [loading, user, root]);
  const requireLogin = () => {
    if (user) return true;
    setLogin(true);
    return false;
  };
  const content = useMemo(() => {
    if (root === "home") return <HomeScreen navigate={navigate} requireLogin={requireLogin} theme={theme} />;
    if (root === "about") return <AboutScreen theme={theme} />;
    if (root === "feed")
      return (
        <FeedScreen
          navigate={navigate}
          requireLogin={requireLogin}
          mode={parts[1] || "recommend"}
        />
      );
    if (root === "board")
      return (
        <FeedScreen
          navigate={navigate}
          requireLogin={requireLogin}
          boardId={parts[1]}
        />
      );
    if (root === "topic")
      return (
        <FeedScreen
          navigate={navigate}
          requireLogin={requireLogin}
          topic={decodeURIComponent(parts.slice(1).join("/"))}
        />
      );
    if (root === "box")
      return (
        <FeedScreen
          navigate={navigate}
          requireLogin={requireLogin}
          sliceBoxId={parts[1]}
        />
      );
    if (root === "profile-posts")
      return (
        <FeedScreen
          navigate={navigate}
          requireLogin={requireLogin}
          userId={parts[1]}
        />
      );
    if (root === "post")
      return (
        <PostScreen
          id={parts[1]}
          navigate={navigate}
          requireLogin={requireLogin}
        />
      );
    if (root === "boards") return <BoardsScreen navigate={navigate} />;
    if (root === "topics") return <TopicsScreen navigate={navigate} />;
    if (root === "undercurrent")
      return (
        <UndercurrentScreen navigate={navigate} requireLogin={requireLogin} />
      );
    if (root === "reefs")
      return <ReefsScreen navigate={navigate} requireLogin={requireLogin} />;
    if (root === "reef" && user) return <ReefChatScreen id={parts[1]} targetMessageId={parts[2]} navigate={navigate} />;
    if (root === "messages" && user)
      return <MessagesScreen navigate={navigate} />;
    if (root === "chat" && user)
      return (
        <ChatScreen
          peerId={parts[1]}
          name={decodeURIComponent(parts.slice(2).join("/"))}
          navigate={navigate}
        />
      );
    if (root === "notifications" && user)
      return <NotificationsScreen category={parts[1] || "interaction"} navigate={navigate} />;
    if (root === "favorites" && user)
      return (
        <FavoritesScreen navigate={navigate} requireLogin={requireLogin} />
      );
    if (root === "profile" && user)
      return <ProfileScreen navigate={navigate} own />;
    if (root === "user")
      return <ProfileScreen id={parts[1]} navigate={navigate} />;
    if (root === "publish" && user)
      return <PublishScreen navigate={navigate} dailyTopicEntry={parts[1] === "daily-topic"} />;
    if (root === "boxes" && user) return <BoxesScreen navigate={navigate} />;
    if (root === "achievements" && user) return <AchievementsScreen />;
    if (root === "settings" && user)
      return <SettingsScreen navigate={navigate} />;
    if (root === "account" && user) return <AccountScreen />;
    if (root === "off-the-land" && user) return <OffTheLandScreen />;
    if (root === "users" && user)
      return (
        <UserListScreen
          id={parts[1]}
          type={parts[2] === "followers" ? "followers" : "following"}
          navigate={navigate}
        />
      );
    if (root === "feedback" && user) return <FeedbackScreen navigate={navigate} history={parts[1] === "history"} />;
    if (root === "blocked" && user) return <BlockedScreen />;
    if (root === "legal") return <LegalScreen document={parts[1]} />;
    return <FeedScreen navigate={navigate} requireLogin={requireLogin} />;
  }, [route, user, theme]);
  const nav = [
    ["feed/recommend", null, "浮霜带"],
    ["reefs", Layers3, "隐海礁"],
  ] as const;
  if (banned && !(root === "notifications" && parts[1] === "system")) {
    return <BannedAccountView user={user} onNotifications={() => navigate("notifications/system")} onLogout={() => void logout()} />;
  }
  const isFullWidthPage = root === "home" || root === "about";
  const isCommunityRoute = root !== "home" && root !== "about";
  return (
    <>
      <SiteTopbar
        theme={theme}
        user={user}
        root={root}
        communityActive={isCommunityRoute}
        aboutActive={root === "about"}
        navigate={navigate}
        requireLogin={requireLogin}
        onLogin={() => setLogin(true)}
        onToggleTheme={toggleTheme}
        onLogout={() => void logout().then(() => navigate("home"))}
      />
      {isFullWidthPage ? (
        <main className="home-main">{content}</main>
      ) : <div className="app-shell">
        <aside className="sidebar">
          <button className="brand" onClick={() => navigate("feed/recommend")}>
            <picture className="brand-logo">
              <img src={theme === "dark" ? logoNight : logoDay} alt="肆度" />
            </picture>
            <span>肆度</span>
          </button>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "切换为日间模式" : "切换为夜间模式"}
            title={theme === "dark" ? "切换为日间模式" : "切换为夜间模式"}
          >
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <nav className="primary-nav">
            {nav.map(([path, Icon, label]) => (
              <button
                className={cx(
                  "nav-item",
                  (route === path || root === path.split("/")[0]) && "active",
                )}
                key={path}
                onClick={() => {
                  if (protectedRoots.has(path) && !requireLogin()) return;
                  navigate(path);
                }}
              >
                {Icon ? <Icon size={19} /> : <span className="frost-icon">4°C</span>}
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <button
            className="publish-button"
            onClick={() => requireLogin() && navigate("publish")}
          >
            <Plus size={19} />
            制备切片
          </button>
          <div className="sidebar-groups">
            <button className={cx("nav-item", root === "boards" && "active")} onClick={() => navigate("boards")}>
              <span className="all-boards-icon" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
              <span>全部冰格</span>
            </button>
            <button
              className={cx("nav-item", root === "topics" && "active")}
              onClick={() => navigate("topics")}
            >
              <span className="all-topics-icon" aria-hidden="true">#</span>
              <span>全部话题</span>
            </button>
          </div>
          <div className="sidebar-bottom">
            <button
              className="nav-item"
              onClick={() => requireLogin() && navigate("settings")}
            >
              <Settings size={19} />
              <span>设置</span>
            </button>
          </div>
        </aside>
        <main className="main-column">{content}</main>
        <Rightbar
          user={user}
          config={config}
          reefs={reefs}
          navigate={navigate}
          login={() => setLogin(true)}
        />
      </div>}
      {!isFullWidthPage && <button
          className={cx("floating-messages", root === "messages" && "active")}
          onClick={() => requireLogin() && navigate("messages")}
          aria-label="消息"
        >
          <MessagesSquare size={21} />
          <span>消息</span>
        </button>}
      {!isFullWidthPage && incomingChat && (
        <button
          className="incoming-chat-snowflake"
          aria-label={`${incomingChat.name}发来了新消息`}
          title={`${incomingChat.name}发来了新消息`}
          onClick={() => {
            navigate(`chat/${incomingChat.id}/${encodeURIComponent(incomingChat.name)}`);
            setIncomingChat(null);
          }}
        >
          <CoolingIcon size={34} filled />
        </button>
      )}
      <LoginModal
        open={login}
        onClose={() => {
          setLogin(false);
          if (!user && protectedRoots.has(root)) navigate("feed/recommend");
        }}
      />
    </>
  );
}

function Rightbar({
  user,
  config,
  reefs,
  navigate,
  login,
}: {
  user: any;
  config: any;
  reefs: any[];
  navigate: (r: string) => void;
  login: () => void;
}) {
  const topic = config?.dailyTopic;
  return (
    <aside className="rightbar">
      <button
        className="profile-card profile-card-link"
        onClick={() => (user ? navigate("profile") : login())}
        aria-label={user ? "进入我的主页" : "登录社区"}
      >
        {user ? (
          <>
            <Avatar src={user.avatar} name={user.nickname} size={52} />
            <div>
              <strong>{user.nickname}</strong>
              <p>{profileMeta(user)}</p>
            </div>
          </>
        ) : (
          <>
            <div className="guest-avatar" aria-hidden="true"><CircleHelp size={28}/></div>
            <div>
              <strong>登录肆度</strong>
              <p>登录后与 App 实时同步</p>
            </div>
          </>
        )}
      </button>
      <section className="side-card">
        <div className="section-title">
          <span>今日话题</span>
        </div>
        <button
          className="topic-link"
          onClick={() =>
            topic && navigate("publish/daily-topic")
          }
        >
          <h3>
            <span className="rightbar-daily-topic">#{" "}{topic?.title ? String(topic.title).replace(/^#\s*/, "") : "今日话题尚未设置"}</span>
          </h3>
          <p>点击发布今日话题切片</p>
        </button>
      </section>
      <section className="side-card">
        <div className="section-title">
          <span>隐海礁</span>
          <Layers3 size={18} />
        </div>
        {reefs.slice(0, 3).map((room) => (
          <button
            className="reef-row"
            key={room.id}
            onClick={() => navigate(`reef/${room.id}`)}
          >
            <div>
              <b style={{ color: room.color || "#33A9DC" }}>{room.name}</b>
              <p>{room.currentCount || 0} 人正在礁石中</p>
            </div>
          </button>
        ))}
      </section>
      <div className="legal-links" aria-label="法律文件">
        {Object.entries(LEGAL_DOCUMENTS).map(([key, document]) => (
          <button key={key} onClick={() => navigate(`legal/${key}`)}>
            {document.title}
          </button>
        ))}
      </div>
    </aside>
  );
}

function profileMeta(user: any) {
  const gender = String(user?.gender || "").toLowerCase();
  const isMale = gender === "male" || gender === "男";
  const isFemale = gender === "female" || gender === "女";
  const age = Number(user?.age) > 0 ? `${user.age}岁` : "";
  return isMale || isFemale || age ? (
    <>
      {(isMale || isFemale) && <GenderBadge gender={isMale ? "male" : "female"} />}
      {age && <span className="sidebar-age-badge">{age}</span>}
    </>
  ) : "肆度用户";
}

function SiteTopbar({
  theme,
  user,
  root,
  communityActive,
  aboutActive,
  navigate,
  requireLogin,
  onLogin,
  onToggleTheme,
  onLogout,
}: {
  theme: "light" | "dark";
  user: any;
  root: string;
  communityActive: boolean;
  aboutActive: boolean;
  navigate: (route: string) => void;
  requireLogin: () => boolean;
  onLogin: () => void;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const nickname = user?.nickname || user?.username || "肆度用户";
  return (
    <header className="site-topbar">
      <div className="site-topbar-inner">
        <button className="site-brand" onClick={() => navigate("home")} aria-label="肆度首页">
          <span className="site-brand-mark">
            <img src={theme === "dark" ? logoNight : logoDay} alt="" />
          </span>
          <span>肆度</span>
        </button>
        <nav className="site-nav" aria-label="网站导航">
          <button className={cx("site-nav-link", root === "home" && "active")} onClick={() => navigate("home")}>
            首页
          </button>
          <button className={cx("site-nav-link", communityActive && "active")} onClick={() => navigate("feed/recommend")}>
            社区
          </button>
          <button className={cx("site-nav-link", aboutActive && "active")} onClick={() => navigate("about")}>
            关于我们
          </button>
        </nav>
        <div className="site-actions">
          <button
            className="site-theme-toggle"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "切换为日间模式" : "切换为夜间模式"}
            title={theme === "dark" ? "切换为日间模式" : "切换为夜间模式"}
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="site-publish-button" onClick={() => requireLogin() && navigate("publish")}>
            <Plus size={17} />
            <span>制备切片</span>
          </button>
          {user ? (
            <div className="site-profile-menu">
              <button className="site-profile-button" onClick={() => navigate("profile")} aria-label="进入我的主页">
                <Avatar src={user.avatar} name={nickname} size={34} />
                <span>{nickname}</span>
              </button>
              <div className="site-profile-popover" role="menu">
                <button type="button" role="menuitem" onClick={onLogout}>
                  <LogOut size={16} />
                  <span>退出登录</span>
                </button>
              </div>
            </div>
          ) : (
            <button className="site-login-button" onClick={onLogin}>
              <CircleHelp size={17} />
              <span>登录</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function parseRestrictionTime(value: string) {
  const source = String(value || "");
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(source)
    ? source
    : `${source.replace(" ", "T")}+08:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function restrictionRemaining(until?: string | null) {
  if (!until) return "永久";
  const remaining = Math.max(0, parseRestrictionTime(until) - Date.now());
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.max(1, Math.ceil((remaining % 3_600_000) / 60_000));
  if (days) return `${days}天${hours}小时`;
  if (hours) return `${hours}小时${minutes}分钟`;
  return `${minutes}分钟`;
}

function BannedAccountView({ user, onNotifications, onLogout }: { user: any; onNotifications: () => void; onLogout: () => void }) {
  return (
    <main className="banned-account-view">
      <section>
        <span className="banned-snow"><Snowflake size={38}/></span>
        <h1>账号已被封禁</h1>
        <strong>剩余封禁时长：{restrictionRemaining(user?.ban_until)}</strong>
        {user?.ban_reason && <p>原因：{user.ban_reason}</p>}
        <p>封禁期间无法查看浮霜带和消息。你仍可以查看系统通知并提交申诉。</p>
        <div>
          <button className="soft-button" onClick={onNotifications}><Mail size={17}/>系统通知与申诉</button>
          <button className="banned-logout" onClick={onLogout}><LogOut size={17}/>退出登录</button>
        </div>
      </section>
    </main>
  );
}
