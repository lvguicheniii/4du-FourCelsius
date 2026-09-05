import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  Award,
  ArrowUp,
  Bookmark,
  Boxes,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleHelp,
  Copy,
  Crosshair,
  Edit3,
  Earth,
  Fish,
  Flag,
  FilePlus2,
  Grid3X3,
  Hash,
  Heart,
  Hourglass,
  Image as ImageIcon,
  Lock,
  Layers3,
  MessageCircle,
  Plus,
  RefreshCw,
  Radio,
  Send,
  Settings,
  ShieldHalf,
  Smile,
  Sparkles,
  Trash2,
  UserX,
  Users,
  X,
} from "lucide-react";
import { api, uploadFile } from "./api";
import { useRealtime, useSession } from "./session";
import {
  LEGAL_DOCUMENTS,
  LEGAL_OPERATOR,
} from "../../community-app/src/data/legal-documents";
import { tagCategories } from "../../community-app/src/data/mock";
import { groupBoardsByCategory } from "../../community-app/src/data/board-categories";
import logoDay from "../../community-app/assets/images/logo_day.png";
import logoNight from "../../community-app/assets/images/logo_night.png";
import {
  Avatar,
  Composer,
  CoolingIcon,
  Empty,
  FrostShellIcon,
  GenderBadge,
  ImageViewer,
  Loading,
  Modal,
  PostCard,
  RefrigerantIcon,
  ReportModal,
  cx,
  formatChatTime,
  formatTime,
} from "./ui";

export type Navigate = (route: string) => void;
const list = (data: any, key = "posts") =>
  Array.isArray(data) ? data : data?.[key] || [];
const isPublicBoard = (board: any) =>
  board?.isActive !== false &&
  board?.active !== false &&
  board?.active !== 0 &&
  board?.category !== "系统" &&
  !["free", "announce"].includes(String(board?.id || ""));
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
function reefCountdown(expiresAt?: string | null, now = Date.now()) {
  if (!expiresAt) return "长期开放";
  const remaining = Math.max(0, parseRestrictionTime(expiresAt) - now);
  if (!remaining) return "存续时间已结束";
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  return days > 0
    ? `${days}天 ${hours}小时 ${minutes}分 ${secs}秒`
    : `${hours}小时 ${minutes}分 ${secs}秒`;
}
function formatFullDateTime(value?: string | null) {
  if (!value) return "";
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value.replace(" ", "T")}+08:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function useLoad<T>(loader: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const next = await loader();
      if (current === requestGeneration.current) setData(next);
    } catch (e: any) {
      if (current === requestGeneration.current) setError(e.message || "读取失败");
    } finally {
      if (current === requestGeneration.current) setLoading(false);
    }
  }, deps);
  useEffect(() => {
    void refresh();
    return () => { requestGeneration.current += 1; };
  }, [refresh]);
  return { data, error, loading, refresh, setData };
}
export function PageHeader({
  title,
  subtitle,
  back,
  onBack,
  action,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {back && (
          <button className="back" onClick={onBack}>
            <ChevronLeft size={19} />
          </button>
        )}
        <div>
          <h1>{title}</h1>
          {subtitle && <span>{subtitle}</span>}
        </div>
      </div>
      {action}
    </header>
  );
}
function ErrorBox({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="error-box">
      <p>{message}</p>
      <button onClick={retry}>
        <RefreshCw size={15} />
        重新加载
      </button>
    </div>
  );
}

export function FeedScreen({
  navigate,
  requireLogin,
  mode = "recommend",
  boardId,
  topic,
  sliceBoxId,
  userId,
  enforceAuthor = false,
  hideHeader = false,
}: {
  navigate: Navigate;
  requireLogin: () => boolean;
  mode?: string;
  boardId?: string;
  topic?: string;
  sliceBoxId?: string;
  userId?: string;
  enforceAuthor?: boolean;
  hideHeader?: boolean;
}) {
  const config = useLoad(() => api.config(), []);
  const [items, setItems] = useState<any[]>([]);
  const [followingItems, setFollowingItems] = useState<any[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const sentinel = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const loadingMoreRef = useRef(false);
  const isMainInfiniteFeed = !boardId && !topic && !sliceBoxId && !userId &&
    ["recommend", "latest", "following"].includes(mode);
  const isProfileInfiniteFeed = !!userId && !boardId && !topic && !sliceBoxId;
  const isInfiniteFeed = isMainInfiniteFeed || isProfileInfiniteFeed;

  const replaceItems = useCallback((next: any[]) => {
    const seen = new Set<string>();
    setItems(next.filter((post: any) => {
      const key = String(post?.id || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }, []);
  const appendItems = useCallback((next: any[]) => {
    setItems((current) => {
      const seen = new Set(current.map((post: any) => String(post?.id || "")));
      return [...current, ...next.filter((post: any) => {
        const key = String(post?.id || "");
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })];
    });
  }, []);
  const loadInitial = useCallback(async (background = false) => {
    const startedAt = performance.now();
    const current = ++generation.current;
    if (background) setRefreshing(true);
    else setInitialLoading(true);
    setError("");
    try {
      let data: any;
      if (topic) data = await api.topicPosts(topic);
      else if (boardId || userId || sliceBoxId) data = await api.posts(1, 30, boardId, userId, sliceBoxId);
      else if (mode === "recommend") data = await api.recommend();
      else if (mode === "announce") {
        data = await api.posts(1, 1000);
        data = {
          ...data,
          posts: list(data).filter((post: any) => {
            try {
              const boards = JSON.parse(post.boardId || "[]");
              return Array.isArray(boards) && boards.includes("announce");
            } catch {
              return post.boardId === "announce";
            }
          }),
        };
      } else if (mode === "following") data = await api.followingPosts();
      else if (mode === "cooled") data = await api.cooledPosts();
      else data = await api.posts(1, 30, boardId, userId, sliceBoxId);
      if (current !== generation.current) return;
      const loaded = list(data);
      if (mode === "following" && isMainInfiniteFeed) {
        setFollowingItems(loaded);
        replaceItems(loaded.slice(0, 20));
        setHasMore(loaded.length > 20);
      } else {
        setFollowingItems([]);
        replaceItems(loaded);
        setHasMore(isInfiniteFeed && !!data?.hasMore);
      }
      setNextCursor(data?.nextCursor || undefined);
      setPage(1);
    } catch (e: any) {
      if (current === generation.current) setError(e?.message || "读取失败");
    } finally {
      if (current === generation.current) {
        if (background) {
          const remaining = 350 - (performance.now() - startedAt);
          if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
        }
        if (current !== generation.current) return;
        setInitialLoading(false);
        setRefreshing(false);
      }
    }
  }, [mode, boardId, topic, sliceBoxId, userId, isMainInfiniteFeed, isInfiniteFeed, replaceItems]);
  useEffect(() => {
    void loadInitial(false);
    return () => { generation.current += 1; };
  }, [loadInitial]);
  const loadMore = useCallback(async () => {
    if (!isInfiniteFeed || !hasMore || loadingMoreRef.current || initialLoading || refreshing) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setError("");
    try {
      if (mode === "following") {
        const next = followingItems.slice(items.length, items.length + 20);
        appendItems(next);
        setHasMore(items.length + next.length < followingItems.length);
      } else if (mode === "recommend") {
        const data = await api.recommend(nextCursor);
        appendItems(list(data));
        setNextCursor(data?.nextCursor || undefined);
        setHasMore(!!data?.hasMore && !!data?.nextCursor);
      } else {
        const nextPage = page + 1;
        const data = await api.posts(nextPage, 30, boardId, userId, sliceBoxId);
        appendItems(list(data));
        setPage(nextPage);
        setHasMore(!!data?.hasMore);
      }
    } catch (e: any) {
      setError(e?.message || "继续加载失败");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [isInfiniteFeed, hasMore, initialLoading, refreshing, mode, followingItems, items.length, appendItems, nextCursor, page, boardId, userId, sliceBoxId]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !isInfiniteFeed) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "500px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isInfiniteFeed, loadMore]);
  const posts = userId && enforceAuthor
    ? items.filter((post: any) => {
        const authorId = post.userId ?? post.user_id ?? post.authorId ?? post.author_id;
        return authorId != null && String(authorId) === String(userId);
      })
    : items;
  const mainFeedModes = ["following", "recommend", "latest", "announce"];
  const title = topic
    ? `# ${String(topic).replace(/^#+\s*/, "")}`
    : boardId
      ? (config.data?.boards || []).find((b: any) => b.id === boardId)?.name ||
        "冰格"
      : sliceBoxId
        ? "切片盒"
        : userId
          ? "个人切片"
          : mode === "cooled"
            ? "霜迹"
            : "浮霜带";
  const isMainFeed = !boardId && !topic && !sliceBoxId && !userId && mainFeedModes.includes(mode);
  const header = !hideHeader && (
    <>
      <PageHeader
        title={title}
        subtitle={isMainFeed ? "让此刻的情绪，在 4°C 被轻轻接住。" : undefined}
        action={
          <div className="feed-header-actions">
            {isMainFeed && <button className="soft-button icon-action" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} title="回到顶部" aria-label="回到顶部"><ArrowUp size={16} /></button>}
            <button className="soft-button" disabled={refreshing} onClick={() => void loadInitial(true)}>
              <RefreshCw className={refreshing ? "spin" : undefined} size={15} />
              {refreshing ? "刷新中" : "刷新"}
            </button>
          </div>
        }
      />
      {isMainFeed && (
        <div className="feed-tabs">
          <button
            className={mode === "following" ? "selected" : ""}
            onClick={() => requireLogin() && navigate("feed/following")}
          >
            关注
          </button>
          <button
            className={mode === "recommend" ? "selected" : ""}
            onClick={() => navigate("feed/recommend")}
          >
            推荐
          </button>
          <button
            className={mode === "latest" ? "selected" : ""}
            onClick={() => navigate("feed/latest")}
          >
            最新
          </button>
          <button
            className={mode === "announce" ? "selected" : ""}
            onClick={() => navigate("feed/announce")}
          >
            公告
          </button>
        </div>
      )}
    </>
  );
  return (
    <>
      {isMainFeed && !hideHeader ? <div className="feed-sticky-header">{header}</div> : header}
      {initialLoading && !posts.length ? (
        <Loading />
      ) : error && !posts.length ? (
        <ErrorBox message={error} retry={() => void loadInitial(false)} />
      ) : posts.length ? (
        <section className="feed">
          {posts.map((post: any) => (
            <PostCard
              key={post.id}
              post={post}
              boards={config.data?.boards || []}
              onOpen={() => navigate(`post/${post.id}`)}
              onUser={(id) => navigate(`user/${id}`)}
              onBoard={(id) => navigate(`board/${id}`)}
              onTopic={(topic) => navigate(`topic/${encodeURIComponent(topic)}`)}
              onBox={(id) => navigate(`box/${id}`)}
              onChanged={() => loadInitial(true)}
              requireLogin={requireLogin}
            />
          ))}
        </section>
      ) : (
        <Empty title="这里还没有切片" detail="新的相遇会在这里出现。" />
      )}
      {isInfiniteFeed && <div className="feed-sentinel" ref={sentinel}>{loadingMore ? <><RefreshCw className="spin" size={15}/> 正在继续打捞切片</> : !hasMore && posts.length ? (userId ? "已显示全部切片" : "已经抵达浮霜带的尽头") : null}</div>}
      {error && posts.length > 0 && <div className="feed-load-error"><span>{error}</span><button onClick={() => void loadMore()}>重试</button></div>}
    </>
  );
}

export function HomeScreen({ navigate, requireLogin, theme }: { navigate: Navigate; requireLogin: () => boolean; theme: "light" | "dark" }) {
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const elements = Array.from(
      pageRef.current?.querySelectorAll<HTMLElement>("[data-home-reveal]") ?? [],
    );
    if (!elements.length) return;

    if (
      !window.IntersectionObserver
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      elements.forEach((element) => element.classList.add("is-visible"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -9%", threshold: 0.12 },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const navigateFromHome = (route: string) => {
    navigate(route);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
    });
  };
  const homeBoardStyle = (color: string, colorDark: string) => ({
    "--home-board-color": color,
    "--home-board-dark-color": colorDark,
  } as CSSProperties);

  return (
    <div ref={pageRef} className="home-page">
      <section className="home-hero">
        <div className="home-hero-copy">
          <span className="home-kicker">4°C——低温情绪社区</span>
          <h1><span>肆度</span></h1>
          <p className="home-hero-lead">凡真实的人生，皆为相遇。</p>
          <div className="home-hero-actions">
            <button className="home-primary-action" onClick={() => navigateFromHome("feed/recommend")}>进入社区</button>
          </div>
        </div>
        <div className="home-product-stage" aria-label="肆度切片功能预览">
          <span className="home-stage-temperature" aria-hidden="true">4°C</span>
          <div className="home-stage-index" aria-hidden="true"><span>01</span><i /></div>
          <article className="home-slice-preview">
            <header>
              <span className="home-preview-avatar">肆</span>
              <span><strong>一枚正在漂流的切片</strong><small>刚刚 · 浮霜带</small></span>
              <b>NOW</b>
            </header>
            <div className="home-preview-topic"># 此刻的温度</div>
            <p>什么？你也是？我还以为只有我。</p>
            <div className="home-preview-temperature">
              <b>-18°C</b>
              <span className="home-preview-temperature-track"><i /></span>
              <b>26°C</b>
            </div>
            <footer>
              <span><MessageCircle size={17} /> 12 条回应</span>
              <span>降温 <CoolingIcon size={17} /> 128</span>
            </footer>
          </article>
          <div className="home-stage-caption">
            <span>SLICE / 001</span>
            <p>文字、照片与话题，都可以成为一枚切片。</p>
          </div>
        </div>
      </section>
      <section className="home-principle">
        <div className="home-principle-copy home-reveal" data-home-reveal>
          <h2>情绪会升温。<br />回应让它慢一点融化。</h2>
          <p>在肆度，表达不需要先成为答案。它可以只是一句话、一张照片，或一个想被理解的瞬间。</p>
        </div>
        <div className="home-temperature-flow home-reveal-group" data-home-reveal aria-label="切片的流动方式">
          <div><CoolingIcon size={18} /><strong>制备</strong><span>记录此刻</span></div>
          <div><Radio size={18} /><strong>漂流</strong><span>等待回应</span></div>
          <div><Fish size={18} /><strong>沉降</strong><span>回到潜流</span></div>
        </div>
      </section>
      <section className="home-feature-story">
        <div className="home-board-atlas home-reveal home-reveal-scale" data-home-reveal aria-label="冰格功能预览">
          <header><span>情绪坐标</span><b>43 个冰格</b></header>
          <div className="home-board-grid">
            <button style={homeBoardStyle("#7C6CF2", "#AAA0FF")} onClick={() => navigateFromHome("board/b1")}><BoardGlyph icon="cafe-outline" /><strong>NOW</strong><small>此刻</small></button>
            <button style={homeBoardStyle("#FF6B9A", "#FF9ABA")} onClick={() => navigateFromHome("board/board_love")}><BoardGlyph icon="heart-outline" /><strong>恋爱</strong><small>心动与靠近</small></button>
            <button style={homeBoardStyle("#25BFD3", "#70D8E5")} onClick={() => navigateFromHome("board/board_anime")}><BoardGlyph icon="sparkles-outline" /><strong>二次元</strong><small>次元同好</small></button>
            <button style={homeBoardStyle("#2EB89F", "#74D2C1")} onClick={() => navigateFromHome("board/board_slacking")}><BoardGlyph icon="fish-outline" /><strong>摸鱼</strong><small>忙里偷闲</small></button>
            <button style={homeBoardStyle("#FF5F7E", "#FF93A8")} onClick={() => navigateFromHome("board/board_lovewins")}><BoardGlyph icon="heart-circle-outline" /><strong>LoveWins</strong><small>爱没有边界</small></button>
          </div>
          <p>不必被归类，也可以保持游离态。</p>
        </div>
        <div className="home-feature-copy home-reveal home-reveal-delay-1" data-home-reveal>
          <span className="home-kicker">为此刻找到位置</span>
          <h2>不必解释情绪。<br />只需选择它此刻的样子。</h2>
          <p>选择合适的冰格，或保持游离态。情绪不必被纠正，只需要一个可以停留的位置。</p>
          <button onClick={() => navigateFromHome("boards")}>浏览全部冰格 <ChevronRight size={17} /></button>
        </div>
      </section>
      <section className="home-spaces" aria-label="肆度的交流空间">
        <header className="home-reveal" data-home-reveal><h2>每个人，都是一座孤岛。</h2><p>你可以停留、交谈，也可以继续漂流。</p></header>
        <div className="home-space-list">
          <article className="home-reveal" data-home-reveal>
            <span className="home-space-icon"><CoolingIcon size={20} /></span>
            <div><h3>浮霜带</h3><p>浏览正在发生的情绪，给一枚切片留下回应。</p></div>
            <button onClick={() => navigateFromHome("feed/recommend")} aria-label="进入浮霜带"><ChevronRight size={20} /></button>
          </article>
          <article className="home-reveal home-reveal-delay-1" data-home-reveal>
            <span className="home-space-icon"><Layers3 size={20} /></span>
            <div><h3>隐海礁</h3><p>在公海遇见陌生声音，或在领海留一处安静空间。</p></div>
            <button onClick={() => navigateFromHome("reefs")} aria-label="进入隐海礁"><ChevronRight size={20} /></button>
          </article>
          <article className="home-reveal home-reveal-delay-2" data-home-reveal>
            <span className="home-space-icon"><MessageCircle size={20} /></span>
            <div><h3>同频相遇</h3><p>从一枚切片开始私信，让对话自然发生。</p></div>
            <button onClick={() => requireLogin() && navigateFromHome("messages")} aria-label="查看消息"><ChevronRight size={20} /></button>
          </article>
        </div>
      </section>
      <section className="home-closing home-reveal-group" data-home-reveal>
        <img src={theme === "dark" ? logoNight : logoDay} alt="肆度" />
        <div><h2>祝你在 4°C，获得平静。</h2></div>
        <button className="home-primary-action" onClick={() => navigateFromHome("feed/recommend")}>进入肆度</button>
      </section>
    </div>
  );
}

function commentBodyOnly(content: unknown) {
  const text = String(content || "");
  return text.match(/^回复 .+?：([\s\S]*)$/)?.[1] || text;
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // HTTP or browser permission policies can reject the modern clipboard API.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function CommentRow({
  item,
  postAuthorId,
  postAuthorName,
  navigate,
  onReply,
  requireLogin,
  onChanged,
  onContextMenu,
}: {
  item: any;
  postAuthorId?: string;
  postAuthorName?: string;
  navigate: Navigate;
  onReply: (item: any) => void;
  requireLogin: () => boolean;
  onChanged: () => Promise<void>;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, item: any) => void;
}) {
  const [liked, setLiked] = useState(!!item.liked);
  const [likes, setLikes] = useState(Number(item.likes) || 0);
  const [report, setReport] = useState(false);
  const [shells, setShells] = useState(Number(item.frostShells ?? item.refrigerants) || 0);
  const [gifting, setGifting] = useState(false);
  const [giftConfirmOpen, setGiftConfirmOpen] = useState(false);
  const [giftError, setGiftError] = useState("");
  const { user } = useSession();
  const isAuthor = String(item.userId || item.user_id) === String(postAuthorId || "");
  const isOwn = String(item.userId || item.user_id) === String(user?.id || user?.userId || "");
  const name = item.nickname || item.username || "未知航行者";
  const replyMatch = String(item.content || "").match(/^回复 (.+?)：([\s\S]*)$/);
  const replyTarget = replyMatch && postAuthorName && replyMatch[1] === postAuthorName
    ? "作者"
    : replyMatch?.[1] || "";
  const replyBody = replyMatch?.[2] || item.content;
  const replyPrefix = replyTarget && (
    <span className="comment-reply-prefix">
      回复 {replyTarget === "作者" ? <span className="comment-reply-author">作者</span> : replyTarget}：
    </span>
  );
  async function toggle() {
    if (!requireLogin()) return;
    const result = await api.likeComment(item.id, !liked);
    setLiked(result.liked);
    setLikes(result.likes);
  }
  async function gift() {
    if (!requireLogin() || gifting) return;
    setGiftError("");
    setGifting(true);
    try {
      const result = await api.giftFrostShell(item.userId || item.user_id, "comment", item.id);
      if (Number.isFinite(result?.commentFrostShellCount)) setShells(result.commentFrostShellCount);
      setGiftConfirmOpen(false);
    } catch (error: any) {
      setGiftError(error?.message || "赠予失败，请稍后重试");
    } finally { setGifting(false); }
  }
  return (
    <div className="comment" onContextMenu={(event) => onContextMenu(event, item)}>
      <button className="comment-user-link avatar-link" onClick={() => navigate(`user/${item.userId || item.user_id}`)} aria-label={`查看${name}的主页`}><Avatar src={item.avatar} name={name} size={36} /></button>
      <div className="comment-main">
        <button className={cx("comment-user-link", "comment-author", isAuthor && "owner")} onClick={() => navigate(`user/${item.userId || item.user_id}`)}>{isAuthor ? "作者" : name}</button>
        {item.kind === "sticker" && item.mediaUrl ? (
          <div className="comment-sticker-content">
            {replyPrefix}
            <img className="comment-sticker" src={item.mediaUrl} alt="表情包" />
          </div>
        ) : (
          <p>{replyPrefix}{replyBody}</p>
        )}
        <span>
          {formatTime(item.createdAt || item.created_at)}
          {item.ipRegion ? ` · ${item.ipRegion}` : ""}
        </span>
        <div className="comment-lower-actions">
          <button onClick={() => requireLogin() && onReply(item)}><MessageCircle size={13}/>回复</button>
          {!isOwn && <button onClick={() => requireLogin() && navigate(`chat/${item.userId || item.user_id}/${encodeURIComponent(name)}`)}><Send size={13}/>私信</button>}
          {!isOwn && <button onClick={() => requireLogin() && setReport(true)}>举报</button>}
        </div>
      </div>
      <div className="comment-side-actions">
        <button className={liked ? "liked" : ""} onClick={toggle}><Heart size={18} fill={liked ? "currentColor" : "none"}/><small>{likes}</small></button>
        {!isOwn && <button className="shell-action" disabled={gifting} onClick={() => requireLogin() && setGiftConfirmOpen(true)}><FrostShellIcon size={19} cracked/><small>{shells}</small></button>}
      </div>
      <Modal open={giftConfirmOpen} onClose={() => !gifting && setGiftConfirmOpen(false)} title="赠予浮霜贝" className="gift-confirm-modal">
        <div className="gift-confirm-content"><FrostShellIcon size={34} cracked/><p>确定赠予 <b>{name}</b> 1 枚脆弱浮霜贝吗？</p>{giftError && <p className="error">{giftError}</p>}<div className="modal-actions"><button className="soft-button" disabled={gifting} onClick={() => setGiftConfirmOpen(false)}>取消</button><button className="primary" disabled={gifting} onClick={gift}>{gifting ? "赠予中…" : "确认赠予"}</button></div></div>
      </Modal>
      <ReportModal
        open={report}
        onClose={() => setReport(false)}
        onSubmit={async (reason, detail) => {
          await api.reportComment(item.id, reason, detail);
          setReport(false);
          await onChanged();
        }}
      />
    </div>
  );
}
export function PostScreen({
  id,
  navigate,
  requireLogin,
}: {
  id: string;
  navigate: Navigate;
  requireLogin: () => boolean;
}) {
  const config = useLoad(() => api.config(), []);
  const { user } = useSession();
  const post = useLoad(() => api.post(id), [id]);
  const comments = useLoad(() => api.comments(id), [id]);
  const [replyTo, setReplyTo] = useState<any>(null);
  const [commentMenu, setCommentMenu] = useState<{ item: any; x: number; y: number } | null>(null);
  const [contextReport, setContextReport] = useState<any>(null);
  const postAuthorId = post.data?.userId || post.data?.user_id;
  const postAuthorName = post.data?.nickname || post.data?.author || post.data?.username;
  const replyLabel = replyTo
    ? String(replyTo.userId || replyTo.user_id) === String(postAuthorId || "")
      ? "作者"
      : replyTo.nickname || replyTo.username
    : "";
  useEffect(() => {
    if (!commentMenu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.(".comment-context-menu")) setCommentMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCommentMenu(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [commentMenu]);

  const refreshComments = async () => {
    await Promise.all([post.refresh(), comments.refresh()]);
  };

  const openCommentMenu = (event: ReactMouseEvent<HTMLDivElement>, item: any) => {
    event.preventDefault();
    event.stopPropagation();
    setCommentMenu({
      item,
      x: Math.min(event.clientX, window.innerWidth - 205),
      y: Math.min(event.clientY, window.innerHeight - 185),
    });
  };

  const selectedCommentIsOwn = String(commentMenu?.item?.userId || commentMenu?.item?.user_id || "") === String(user?.id || user?.userId || "");
  return (
    <>
      <PageHeader title="切片" back onBack={() => history.back()} />
      {post.loading ? (
        <Loading />
      ) : post.error ? (
        <ErrorBox message={post.error} retry={post.refresh} />
      ) : (
        post.data && (
          <PostCard
            post={post.data}
            boards={config.data?.boards || []}
            onOpen={() => {}}
            onUser={(uid) => navigate(`user/${uid}`)}
            onBoard={(bid) => navigate(`board/${bid}`)}
            onTopic={(topic) => navigate(`topic/${encodeURIComponent(topic)}`)}
            onBox={(box) => navigate(`box/${box}`)}
            onChanged={() => {
              void post.refresh();
              void comments.refresh();
            }}
            requireLogin={requireLogin}
          />
        )
      )}
      <section className="panel comments">
        <h2>
          评论 <span>{list(comments.data, "comments").length}</span>
        </h2>
        {comments.loading ? (
          <Loading />
        ) : (
          [...list(comments.data, "comments")].sort((a: any, b: any) => Date.parse(b.createdAt || b.created_at || 0) - Date.parse(a.createdAt || a.created_at || 0)).map((item: any) => (
            <CommentRow
              item={item}
              postAuthorId={postAuthorId}
              postAuthorName={postAuthorName}
              navigate={navigate}
              onReply={setReplyTo}
              key={item.id}
              requireLogin={requireLogin}
              onContextMenu={openCommentMenu}
              onChanged={comments.refresh}
            />
          ))
        )}
        {requireLogin() && (
          <Composer
            placeholder={replyTo ? `回复 ${replyLabel}…` : "写下你的回应…"}
            onSend={async (text) => {
              const content = replyTo ? `回复 ${replyLabel}：${text}` : text;
              await api.comment(id, content);
              setReplyTo(null);
              await comments.refresh();
              await post.refresh();
            }}
            onSticker={async (url) => {
              const content = replyTo ? `回复 ${replyLabel}：[表情包]` : "[表情包]";
              await api.comment(id, content, "sticker", url);
              setReplyTo(null);
              await comments.refresh();
              await post.refresh();
            }}
          />
        )}
      </section>
      {commentMenu && <div className="comment-context-menu" style={{ left: commentMenu.x, top: commentMenu.y }} role="menu" onContextMenu={(event) => event.preventDefault()}>
        <button role="menuitem" onClick={async () => {
          await copyText(commentBodyOnly(commentMenu.item?.content));
          setCommentMenu(null);
        }}><Copy size={16}/>复制评论</button>
        {selectedCommentIsOwn ? <button className="danger" role="menuitem" onClick={async () => {
          await api.deleteComment(commentMenu.item.id);
          setCommentMenu(null);
          await refreshComments();
        }}><Trash2 size={16}/>删除评论</button> : <>
          <button role="menuitem" onClick={() => { setContextReport(commentMenu.item); setCommentMenu(null); }}><Flag size={16}/>举报评论</button>
          <button className="danger" role="menuitem" onClick={async () => {
            await api.block(commentMenu.item.userId || commentMenu.item.user_id, true);
            setCommentMenu(null);
            await refreshComments();
          }}><UserX size={16}/>拉黑用户</button>
        </>}
      </div>}
      <ReportModal
        open={!!contextReport}
        onClose={() => setContextReport(null)}
        onSubmit={async (reason, detail) => {
          await api.reportComment(contextReport.id, reason, detail);
          setContextReport(null);
          await refreshComments();
        }}
      />
    </>
  );
}

export function PublishScreen({ navigate, dailyTopicEntry = false }: { navigate: Navigate; dailyTopicEntry?: boolean }) {
  const config = useLoad(() => api.config(), []);
  const boxes = useLoad(() => api.boxes(), []);
  const reefs = useLoad(() => api.reefs("mine"), []);
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [board, setBoard] = useState("");
  const [box, setBox] = useState("");
  const [topic, setTopic] = useState("");
  const [reef, setReef] = useState("");
  const [picker, setPicker] = useState<"board" | "topic" | "reef" | "box" | null>(null);
  const [topicHistory, setTopicHistory] = useState(false);
  const [reefCreating, setReefCreating] = useState(false);
  const [reefName, setReefName] = useState("");
  const [reefCapacity, setReefCapacity] = useState("30");
  const [reefHours, setReefHours] = useState("24");
  const [reefSaving, setReefSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reefError, setReefError] = useState("");
  const initialTopicApplied = useRef(false);
  const initialBoardApplied = useRef(false);
  const boards = (config.data?.boards || []).filter(isPublicBoard);
  const boardCategories = groupBoardsByCategory(boards);
  const privateReefs = list(reefs.data, "rooms").filter((item: any) => item.zone === "private");
  const selectedBoard = boards.find((item: any) => item.id === board);
  const selectedReef = privateReefs.find((item: any) => item.id === reef);
  const selectedBox = list(boxes.data, "boxes").find((item: any) => item.id === box);
  const currentDailyTopic = String(config.data?.dailyTopic?.title || "").replace(/^#/, "");

  useEffect(() => {
    if (initialBoardApplied.current || !boards.length) return;
    initialBoardApplied.current = true;
    setBoard((boards.find((item: any) => String(item.name).toUpperCase() === "NOW") || boards[0]).id);
  }, [boards]);
  useEffect(() => {
    if (!dailyTopicEntry || initialTopicApplied.current || !currentDailyTopic) return;
    initialTopicApplied.current = true;
    setTopic(currentDailyTopic);
  }, [dailyTopicEntry, currentDailyTopic]);

  const normalizeReefNumber = (value: string, min: number, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min ? Math.min(44, Math.floor(parsed)) : fallback;
  };
  const closePicker = () => {
    setPicker(null);
    setTopicHistory(false);
    setReefCreating(false);
    setReefError("");
  };
  async function createPrivateReef() {
    const cleanName = reefName.trim();
    if (cleanName.length < 2) {
      setReefError("礁石名称需要 2-18 个字");
      return;
    }
    setReefSaving(true);
    setReefError("");
    try {
      const result = await api.createReef(cleanName, normalizeReefNumber(reefCapacity, 2, 30), normalizeReefNumber(reefHours, 1, 24));
      const room = result?.room || result;
      if (room?.id) {
        const selectedRoom = { zone: "private", color: "#33A9DC", currentCount: 0, latestMessage: null, ...room };
        reefs.setData((current: any) => ({ ...(current || {}), rooms: [selectedRoom, ...list(current, "rooms").filter((item: any) => item.id !== selectedRoom.id)] }));
        setReef(selectedRoom.id);
      }
      setReefName("");
      setReefCapacity("30");
      setReefHours("24");
      closePicker();
    } catch (e: any) {
      setReefError(e?.message || "创建领海礁石失败，请稍后重试");
    } finally {
      setReefSaving(false);
    }
  }
  async function publish() {
    setBusy(true);
    setError("");
    try {
      const status = await api.publishStatus();
      if (status.canPublish === false) throw new Error("44秒内只能发布一份切片！");
      const uploads = [];
      for (const file of files) uploads.push(await uploadFile(file, "p"));
      await api.createPost({
        content: topic ? `#${topic.replace(/^#/, "")}${content.trim() ? `\n${content.trim()}` : ""}` : content.trim(),
        images: uploads.map((item) => item.url),
        thumbnails: uploads.map((item) => item.thumbUrl || item.url),
        boardId: board ? JSON.stringify([board]) : undefined,
        reefRoomId: reef || undefined,
        sliceBoxId: box || undefined,
      });
      navigate("feed/latest");
    } catch (e: any) {
      setError(e?.message || "发布失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }

  const pickerHeader = (left: ReactNode) => <div className="publish-picker-header-actions">{left}<button className="icon-button" onClick={closePicker} aria-label="关闭"><X size={19}/></button></div>;
  return (
    <>
      <PageHeader title="制备切片" subtitle="将此刻轻轻封存在浮霜里" />
      <section className="panel publish-panel">
        <div className={cx("publish-copy-field", topic && "has-topic")}>
          {topic && <div className="publish-topic-chip"><span>#{topic}</span><button type="button" aria-label="移除话题" onClick={() => setTopic("")}><X size={15}/></button></div>}
          <textarea className="publish-text" maxLength={4444} placeholder="现在，想留下些什么？" value={content} onChange={(event) => setContent(event.target.value)} />
          <span className="publish-character-count">{content.length}/4444</span>
        </div>
        {selectedReef && (
          <div className="publish-selected-reef" style={{ "--reef-color": selectedReef.color || "#33A9DC" } as CSSProperties}>
            <span className="publish-selected-reef-icon"><Layers3 size={21}/></span>
            <div>
              <b>{selectedReef.name}</b>
              <p>{selectedReef.latestMessage?.content || "礁石等待第一句话"}</p>
            </div>
            <small>{selectedReef.currentCount || 0} 人在线</small>
            <button type="button" onClick={() => setReef("")} aria-label="移除礁石"><X size={14}/></button>
          </div>
        )}
        <div className="preview-grid">
          {files.map((file, index) => <div key={`${file.name}-${index}`}><img src={URL.createObjectURL(file)} alt="待发布图片"/><button onClick={() => setFiles((value) => value.filter((_, itemIndex) => itemIndex !== index))}>×</button></div>)}
        </div>
        <label className="upload-tile"><ImageIcon size={20}/>添加图片（至多9张）<input type="file" accept="image/*" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 9))}/></label>
        {currentDailyTopic && !topic && <button className="daily-topic-prompt" onClick={() => setTopic(currentDailyTopic)}><Sparkles size={18}/><span>今日话题 · #{currentDailyTopic}</span><Plus size={18}/></button>}
        <div className="publish-selectors">
          <button onClick={() => setPicker("board")}><span className={cx("publish-selector-icon", selectedBoard && "board-icon-box")} style={selectedBoard ? { "--board-color": selectedBoard.color || "#33A9DC", "--board-dark-color": selectedBoard.colorDark || selectedBoard.color || "#7FD8F5" } as CSSProperties : undefined}>{selectedBoard ? <BoardGlyph icon={selectedBoard.icon}/> : <Grid3X3 size={20}/>}</span><b>{selectedBoard?.name || "冰格"}</b><ChevronRight size={16}/></button>
          <button onClick={() => setPicker("topic")}><span className="publish-selector-icon"><Hash size={20}/></span><b>{topic ? `#${topic}` : "话题"}</b><ChevronRight size={16}/></button>
          <button onClick={() => setPicker("reef")}><span className="publish-selector-icon"><Layers3 size={20}/></span><b>{selectedReef?.name || "礁石"}</b><ChevronRight size={16}/></button>
          <button onClick={() => setPicker("box")}><span className="publish-selector-icon"><Boxes size={20}/></span><b>{selectedBox?.name || "切片盒"}</b><ChevronRight size={16}/></button>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy || (!content.trim() && !files.length && !topic && !reef)} onClick={publish}>{busy ? "正在制备…" : "发布切片"}</button>
      </section>

      <Modal open={picker === "board"} onClose={closePicker} title="选择冰格" className="publish-picker-modal">
        <div className="board-picker-list">{boardCategories.map((category) => category.boards.length > 0 && <section key={category.name}><h3>{category.name}</h3><div className="board-picker-grid">{category.boards.map((item: any) => <button className={item.id === board ? "selected" : ""} key={item.id} onClick={() => { setBoard(item.id === board ? "" : item.id); closePicker(); }}><span className="board-icon-box" style={{ "--board-color": item.color || "#33A9DC", "--board-dark-color": item.colorDark || item.color || "#7FD8F5" } as CSSProperties}><BoardGlyph icon={item.icon}/>{item.id === board && <i className="board-picker-check"><Check size={11}/></i>}</span><b>{item.name}</b></button>)}</div></section>)}</div>
      </Modal>

      <Modal open={picker === "topic"} onClose={closePicker} title={topicHistory ? "历史每日话题" : "选择话题"} className="publish-picker-modal" headerAction={pickerHeader(<button className="publish-picker-text-action" onClick={() => setTopicHistory((value) => !value)}>{topicHistory ? "返回选择" : "历史每日话题"}</button>)}>
        {topicHistory ? <div className="topic-history-list">{(config.data?.dailyTopicHistory || []).map((item: any) => { const value = String(item.title || "").replace(/^#/, ""); return <button className={value === topic ? "selected" : ""} key={item.id || value} onClick={() => { setTopic(value); closePicker(); }}><small>{item.themeDate}</small><b>#{value}</b></button>; })}{!(config.data?.dailyTopicHistory || []).length && <p className="publish-picker-empty">暂无历史每日话题</p>}</div> : <><p className="publish-picker-hint">选择一个话题，它会出现在切片文字的第一行</p><div className="topic-picker-grid">{(config.data?.topics || []).map((item: any) => { const value = String(item.name || item.title || "").replace(/^#/, ""); return <button className={value === topic ? "selected" : ""} key={item.id || value} onClick={() => { setTopic(value); closePicker(); }}>#{value}</button>; })}</div><button className="topic-picker-clear" onClick={() => { setTopic(""); closePicker(); }}>不添加话题</button></>}
      </Modal>

      <Modal open={picker === "reef"} onClose={closePicker} title={reefCreating ? "创建领海礁石" : "选择礁石"} className="publish-picker-modal" headerAction={pickerHeader(<button className="publish-picker-leading" onClick={() => { setReefCreating((value) => !value); setReefError(""); }} aria-label={reefCreating ? "返回选择礁石" : "创建领海礁石"}>{reefCreating ? <ChevronLeft size={21}/> : <Plus size={21}/>}</button>)}>
        {reefCreating ? <div className="form reef-create-form"><p className="form-hint">创建后会随切片一起发布</p><label className="reef-name-field"><span><Edit3 size={15}/> 礁石名称</span><input maxLength={18} placeholder="2-18 个字" value={reefName} onChange={(event) => { setReefName(event.target.value); setReefError(""); }}/></label><div className="reef-number-grid">{[{ label: "最大容纳人数", icon: Users, value: reefCapacity, setValue: setReefCapacity, min: 2, fallback: 30, unit: "人" }, { label: "礁石存在时间", icon: Hourglass, value: reefHours, setValue: setReefHours, min: 1, fallback: 24, unit: "小时" }].map(({ icon: Icon, ...field }) => <label className="reef-number-field" key={field.label}><span><Icon size={15}/> {field.label}</span><div><input inputMode="numeric" maxLength={2} value={field.value} onFocus={(event) => event.currentTarget.select()} onBlur={() => field.setValue(String(normalizeReefNumber(field.value, field.min, field.fallback)))} onChange={(event) => field.setValue(event.target.value.replace(/\D/g, "").slice(0, 2))}/><b>{field.unit}</b></div><small>上限 44 {field.unit}</small></label>)}</div>{reefError && <p className="error">{reefError}</p>}<button className="primary" disabled={reefSaving} onClick={() => void createPrivateReef()}>{reefSaving ? "创建中…" : "创建并插入切片"}</button></div> : <div className="publish-picker-list reef-picker-list"><button onClick={() => { setReef(""); closePicker(); }}><span><Layers3 size={18}/></span><b>不关联礁石</b></button>{privateReefs.map((item: any) => <button className={item.id === reef ? "selected" : ""} key={item.id} onClick={() => { setReef(item.id); closePicker(); }}><span style={{ color: item.color, background: `${item.color || "#33A9DC"}18` }}><Layers3 size={18}/></span><b>{item.name}</b><small>{item.currentCount || 0} 人在线</small></button>)}{!privateReefs.length && <p className="publish-picker-empty">暂无参与过或创建的私人礁石</p>}</div>}
      </Modal>

      <Modal open={picker === "box"} onClose={closePicker} title="选择切片盒" className="publish-picker-modal"><div className="publish-picker-list"><button onClick={() => { setBox(""); closePicker(); }}><span><Boxes size={18}/></span><b>不放入切片盒</b></button>{list(boxes.data, "boxes").map((item: any) => <button className={item.id === box ? "selected" : ""} key={item.id} onClick={() => { setBox(item.id); closePicker(); }}><span><Boxes size={18}/></span><b>{item.name}</b><small>{item.postCount || 0} 份切片</small></button>)}</div></Modal>
    </>
  );
}

type ShortcutTarget = {
  kind: "chat" | "reef";
  id: string;
  important: boolean;
  x: number;
  y: number;
};

export function MessagesScreen({ navigate }: { navigate: Navigate }) {
  const { lastEvent, connected } = useRealtime();
  const [shortcut, setShortcut] = useState<ShortcutTarget | null>(null);
  const state = useLoad(
    () =>
      Promise.all([
        api.conversations(),
        api.reefs("messages"),
        api.notifications("interaction"),
        api.notifications("system"),
        api.unread(),
      ]),
    [],
  );
  useEffect(() => {
    if (["chat", "notification", "reef_message", "reef_presence", "reef_room_changed"].includes(String(lastEvent?.type || ""))) {
      void state.refresh();
    }
  }, [lastEvent]);
  const conversations = state.data?.[0] || [];
  const reefs = list(state.data?.[1], "rooms");
  const interactionNotifications = list(state.data?.[2]);
  const systemNotifications = list(state.data?.[3]);
  const unread = state.data?.[4] || {};
  const notificationRows = [
    {
      shortcutKind: "notification" as const,
      category: "interaction",
      label: "互动通知",
      preview: interactionNotifications[0]?.content || interactionNotifications[0]?.title || "暂无新通知",
      time: interactionNotifications[0]?.createdAt || "",
      unread: unread.interaction || 0,
      color: "#33A9DC",
      icon: "notifications-outline",
    },
    {
      shortcutKind: "notification" as const,
      category: "system",
      label: "系统通知",
      preview: systemNotifications[0]?.title || systemNotifications[0]?.content || "暂无新通知",
      time: systemNotifications[0]?.createdAt || "",
      unread: unread.system || 0,
      color: "#F7B731",
      icon: "megaphone-outline",
    },
  ];
  const messageItems = [
    ...conversations.map((item: any) => ({
      ...item,
      shortcutKind: "chat" as const,
      sortTime: item.importantAt || item.important_at || item.time || "",
    })),
    ...reefs.map((item: any) => ({
      ...item,
      shortcutKind: "reef" as const,
      sortTime:
        item.importantAt ||
        item.important_at ||
        item.latestMessage?.time ||
        item.latestMessage?.createdAt ||
        item.createdAt ||
        "",
    })),
    ...notificationRows.map((item) => ({
      ...item,
      important: false,
      sortTime: item.time,
    })),
  ].sort((a, b) => {
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;
    const aSortTime = a.important && a.importantAt && a.importantAt > a.sortTime
      ? a.importantAt
      : a.sortTime;
    const bSortTime = b.important && b.importantAt && b.importantAt > b.sortTime
      ? b.importantAt
      : b.sortTime;
    return String(bSortTime || "").localeCompare(String(aSortTime || ""));
  });
  useEffect(() => {
    if (!shortcut) return;
    const closeMenu = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.(".shortcut-menu")) {
        setShortcut(null);
      }
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [shortcut]);
  function openShortcut(
    event: ReactMouseEvent<HTMLElement>,
    kind: "chat" | "reef",
    id: string,
    important: boolean,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setShortcut({
      kind,
      id,
      important,
      x: Math.min(event.clientX, window.innerWidth - 205),
      y: Math.min(event.clientY, window.innerHeight - 150),
    });
  }
  async function updateShortcut(values: { important?: boolean; hidden?: boolean }) {
    if (!shortcut) return;
    if (shortcut.kind === "chat") await api.chatPreference(shortcut.id, values);
    else await api.reefPreference(shortcut.id, values);
    setShortcut(null);
    await state.refresh();
  }
  return (
    <>
      <PageHeader
        title="消息"
        subtitle={connected ? "实时连接已建立" : "正在重新连接"}
        action={
          <button className="soft-button" onClick={() => navigate("favorites")}>
            <Bookmark size={15} />
            收藏
          </button>
        }
      />
      {state.loading && !state.data ? (
        <Loading />
      ) : (
        <section className="panel list-panel messages-list-panel">
          {messageItems.map((item: any) =>
            item.shortcutKind === "notification" ? (
              <button
                className="notice-row"
                key={`notification-${item.category}`}
                onClick={() => navigate(`notifications/${item.category}`)}
              >
                <span className="list-icon notification-icon" style={{ color: item.color, backgroundColor: `${item.color}18` }}>
                  <NotificationGlyph type={item.category === "system" ? "system" : "interaction"} />
                  {item.unread > 0 && <em>{item.unread > 99 ? "99+" : item.unread}</em>}
                </span>
                <div>
                  <b>{item.label}</b>
                  <p>{item.preview}</p>
                </div>
                <time>{formatTime(item.time)}</time>
              </button>
            ) : item.shortcutKind === "chat" ? (
              <button
                className="conversation"
                key={`chat-${item.userId}`}
                onClick={() =>
                  navigate(`chat/${item.userId}/${encodeURIComponent(item.name)}`)
                }
                onContextMenu={(event) => openShortcut(event, "chat", item.userId, !!item.important)}
              >
                <Avatar src={item.avatar} name={item.name} />
                <div>
                  <b>{item.name}</b>
                  <p>{item.lastMessage}</p>
                </div>
                {item.important && <Bookmark className="favorite-mark chat-favorite-mark" size={14} fill="currentColor" />}
                <time>{formatTime(item.time)}</time>
                {item.unread > 0 && <em>{item.unread}</em>}
              </button>
            ) : (
              <button
                className="conversation"
                key={`reef-${item.id}`}
                onClick={() => navigate(`reef/${item.id}`)}
                onContextMenu={(event) => openShortcut(event, "reef", item.id, !!item.important)}
                style={{
                  borderColor: `${item.color || "#33A9DC"}45`,
                  backgroundColor: `${item.color || "#33A9DC"}10`,
                }}
              >
                <span
                  className="list-icon reef"
                  style={{
                    color: item.color || "#33A9DC",
                    backgroundColor: `${item.color || "#33A9DC"}20`,
                  }}
                >
                  {(item.name || "礁").trim().slice(0, 1)}
                </span>
                <div>
                  <b>{item.name}</b>
                  <p>{item.latestMessage?.content || "礁石等待第一句话"}</p>
                </div>
                {item.important && (
                  <Bookmark className="favorite-mark reef-favorite-mark" size={14} fill="currentColor" style={{ color: item.color || "#33A9DC" }}/>
                )}
                <time className="reef-count" style={{ color: item.color || "#33A9DC" }}>{item.currentCount || 0} 人</time>
              </button>
            ),
          )}
        </section>
      )}
      {shortcut && (
        <>
          <div className="context-menu-shade" aria-hidden="true" />
          <div
            className="shortcut-menu"
            style={{ left: shortcut.x, top: shortcut.y }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button onClick={() => void updateShortcut({ important: !shortcut.important })}>
              <Bookmark size={17} fill={shortcut.important ? "currentColor" : "none"} />
              {shortcut.important
                ? "取消重要"
                : shortcut.kind === "chat" ? "设为重要对话" : "设为重要礁石"}
            </button>
            <button className="danger" onClick={() => void updateShortcut({ hidden: true })}>
              <Trash2 size={17} />
              {shortcut.kind === "chat" ? "删除对话" : "删除礁石"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

function messageMedia(
  item: any,
  onOpenImage?: (url: string) => void,
  onOpenContext?: (kind: string, value: any) => void,
) {
  if (item.kind === "image" || item.kind === "sticker")
    return <img src={item.content} alt={item.kind === "sticker" ? "表情包" : "消息图片"} className="viewable-image" onClick={() => onOpenImage?.(item.content)} />;
  if (item.kind === "live_photo") {
    try {
      const value = JSON.parse(item.content);
      return (
        <div className="message-live">
          <img className="viewable-image" src={value.stillUrl || value.poster || value.url} onClick={() => onOpenImage?.(value.stillUrl || value.poster || value.url)} />
          <span>实况 · 静态预览</span>
        </div>
      );
    } catch {
      return <span>[实况照片]</span>;
    }
  }
  if (item.kind === "post_context" || item.kind === "comment_context") {
    try {
      const value = JSON.parse(item.content);
      return (
        <button
          type="button"
          className={cx("context-message", onOpenContext && "clickable")}
          disabled={!onOpenContext || (!value.postId && !value.commentId)}
          onClick={() => onOpenContext?.(item.kind, value)}
        >
          {value.image && <img src={value.image} alt="关联切片" />}
          <span>
            <b>
              {item.kind === "post_context"
                ? `从 ${value.author ? `${value.author} 的` : ""}切片开始对话`
                : `从 ${value.author ? `${value.author} 的` : ""}评论开始对话`}
            </b>
            <p>{value.content || value.commentContent || "查看关联内容"}</p>
          </span>
          {onOpenContext && (value.postId || value.commentId) && <ChevronRight size={18} />}
        </button>
      );
    } catch {}
  }
  return item.content;
}
function messageTimeValue(item: any) {
  const value = String(item.time || item.createdAt || item.created_at || "");
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(" ", "T")}+08:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
function groupMessageTimes(messages: any[]) {
  return messages.map((item, index) => ({
    item,
    showTime: index === 0 || messageTimeValue(item) <= 0 || messageTimeValue(messages[index - 1]) <= 0 || messageTimeValue(item) - messageTimeValue(messages[index - 1]) >= 5 * 60 * 1000,
  }));
}
function isGiftSystemMessage(item: any) {
  return item.kind === "system" && /赠予了\s*1\s*(?:瓶制冷剂|枚脆弱(?:的)?浮霜贝)/.test(String(item.content || ""));
}
function appendMessageData(current: any, message: any) {
  const messages = list(current, "messages");
  if (messages.some((item: any) => String(item.id) === String(message.id))) return current;
  const next = [...messages, message];
  return Array.isArray(current) ? next : { ...(current || {}), messages: next };
}
export function ChatScreen({
  peerId,
  name,
  navigate,
}: {
  peerId: string;
  name: string;
  navigate: Navigate;
}) {
  const { user } = useSession();
  const { version } = useRealtime();
  const profile = useLoad(() => api.profile(peerId), [peerId]);
  const state = useLoad(() => api.chat(name, peerId), [peerId, name]);
  const [exactMessageTimes, setExactMessageTimes] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  const [gifting, setGifting] = useState(false);
  const [giftError, setGiftError] = useState("");
  const messagesAreaRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (version) void state.refresh();
  }, [version]);
  async function sendImage(file: File) {
    const uploaded = await uploadFile(file, "m");
    const result = await api.sendChat(name, peerId, uploaded.url, "image", uploaded.mediaId);
    state.setData((current: any) => appendMessageData(current, { ...result, kind: "image", from: "me" }));
  }
  async function giftFrostShell() {
    if (gifting) return;
    setGifting(true);
    setGiftError("");
    try {
      await api.giftFrostShell(peerId, "chat");
      setGiftOpen(false);
      await state.refresh();
    } catch (error: any) {
      setGiftError(error?.message || "赠予失败，请稍后重试");
    } finally {
      setGifting(false);
    }
  }
  const messages = list(state.data, "messages");
  const context = messages.find((item: any) => item.kind === "post_context" || item.kind === "comment_context");
  const ordinaryMessages = groupMessageTimes(messages.filter((item: any) => item !== context));
  const latestMessageId = ordinaryMessages.at(-1)?.item?.id || "";
  useEffect(() => {
    if (state.loading || !latestMessageId) return;
    const scrollToLatest = () => messagesEndRef.current?.scrollIntoView({ block: "end" });
    const frame = requestAnimationFrame(scrollToLatest);
    const timer = window.setTimeout(scrollToLatest, 180);
    const observer = new ResizeObserver(scrollToLatest);
    if (messagesAreaRef.current) observer.observe(messagesAreaRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [peerId, state.loading, latestMessageId]);
  return (
    <div className="chat-screen">
      <PageHeader
        title={name}
        back
        onBack={() => history.back()}
        action={
          <button
            className="soft-button"
            onClick={async () => {
              await api.chatPreference(peerId, { important: true });
              navigate("messages");
            }}
          >
            <Bookmark size={15} />
            收藏
          </button>
        }
      />
      {profile.data && (
        <button
          className="chat-profile"
          onClick={() => navigate(`user/${peerId}`)}
        >
          <Avatar src={profile.data.avatar} name={name} size={48} />
          <div>
            <b>{name}</b>
            <p>
              {profile.data.gender === "male"
                ? "♂"
                : profile.data.gender === "female"
                  ? "♀"
                  : ""}
              {profile.data.age ? ` ${profile.data.age}` : ""} · UID {peerId}
            </p>
          </div>
          <ChevronRight />
        </button>
      )}
      {context && <div className="chat-context-pinned">{messageMedia(context, undefined, (_kind, value) => {
        const postId = value.postId || value.relatedPostId;
        if (postId) navigate(`post/${postId}`);
      })}</div>}
      <section className="messages-area" ref={messagesAreaRef}>
        {state.loading && !state.data ? (
          <Loading />
        ) : (
          ordinaryMessages.map(({ item, showTime }: any) => (
            <div className="message-entry" key={item.id}>
              {showTime && <button className="message-time chat-time-divider" onClick={() => setExactMessageTimes((value) => !value)}>{formatChatTime(item.time, exactMessageTimes)}</button>}
              {item.kind === "system" ? <div className={cx("system-chat-message", isGiftSystemMessage(item) && "gift")}>
                {isGiftSystemMessage(item) && <FrostShellIcon size={20}/>}<span>{item.content === "消息已撤回" ? (item.from === "me" ? "你刚撤回了一条消息" : `【${name}】刚撤回了一条消息`) : item.content}</span>
              </div> : <div className={cx("bubble-row", item.from === "me" && "mine")}>
                {item.from !== "me" && <button
                  className="chat-avatar-action"
                  aria-label={`赠予${name}浮霜贝`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setGiftError("");
                    setGiftOpen(true);
                  }}
                ><Avatar src={item.fromAvatar || profile.data?.avatar} name={name} size={32} /></button>}
                <div className="bubble-stack"><div className={cx("bubble", (item.kind === "image" || item.kind === "sticker") && "media-message", item.kind === "sticker" && "sticker-message", item.kind === "image" && "image-message")}>{messageMedia(item, setViewerUrl)}</div></div>
              </div>
              }
            </div>
          ))
        )}
      </section>
      <Composer
        placeholder={`发消息给 ${name}`}
        onSend={async (text) => {
          const result = await api.sendChat(name, peerId, text);
          state.setData((current: any) => appendMessageData(current, { ...result, kind: "text", from: "me" }));
        }}
        onImage={sendImage}
        onSticker={async (url) => {
          const result = await api.sendChat(name, peerId, url, "sticker");
          state.setData((current: any) => appendMessageData(current, { ...result, kind: "sticker", from: "me" }));
        }}
      />
      <div className="messages-end-anchor" ref={messagesEndRef} aria-hidden="true" />
      {viewerUrl && <ImageViewer images={[viewerUrl]} index={0} onIndex={() => {}} onClose={() => setViewerUrl(null)} />}
      <Modal open={giftOpen} onClose={() => !gifting && setGiftOpen(false)} title="赠予浮霜贝" className="gift-confirm-modal">
        <div className="gift-confirm-content">
          <FrostShellIcon size={34} cracked/>
          <p>确定赠予 <b>{name}</b> 1 枚脆弱浮霜贝吗？</p>
          {giftError && <p className="error">{giftError}</p>}
          <div className="modal-actions">
            <button className="soft-button" disabled={gifting} onClick={() => setGiftOpen(false)}>取消</button>
            <button className="primary" disabled={gifting} onClick={() => void giftFrostShell()}>{gifting ? "赠予中…" : "确认赠予"}</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function ReefsScreen({
  navigate,
  requireLogin,
}: {
  navigate: Navigate;
  requireLogin: () => boolean;
}) {
  const { version } = useRealtime();
  const state = useLoad(() => api.reefs(), []);
  const [zone, setZone] = useState<"public" | "private">("public");
  const [create, setCreate] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationName, setApplicationName] = useState("");
  const [applicationReason, setApplicationReason] = useState("");
  const [applicationError, setApplicationError] = useState("");
  const [applicationSubmitting, setApplicationSubmitting] = useState(false);
  const [applicationSubmitted, setApplicationSubmitted] = useState(false);
  const [rules, setRules] = useState(false);
  const [redLine, setRedLine] = useState(false);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("30");
  const [hours, setHours] = useState("24");
  const [createError, setCreateError] = useState("");
  const rooms = list(state.data, "rooms")
    .filter((room: any) => room.zone === zone)
    .sort((a: any, b: any) => (b.currentCount || 0) - (a.currentCount || 0));
  useEffect(() => {
    if (version) void state.refresh();
  }, [version]);
  const normalizeNumber = (value: string, min: number, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min
      ? Math.min(44, Math.floor(parsed))
      : fallback;
  };
  return (
    <>
      <div className="reef-sticky-header">
        <PageHeader
          title="隐海礁"
          subtitle="短暂相遇，也认真交谈。"
          action={
            <button
              className="soft-button"
              onClick={() => {
                if (!requireLogin()) return;
                if (zone === "public") {
                  setApplicationError("");
                  setApplicationSubmitted(false);
                  setApplicationOpen(true);
                } else {
                  setCreate(true);
                }
              }}
            >
              {zone === "public" ? <FilePlus2 size={15} /> : <Plus size={15} />}
              {zone === "public" ? "申请新公海礁石" : "创建领海礁石"}
            </button>
          }
        />
        <div className="segment reef-zone-tabs">
          <button className={zone === "public" ? "active" : ""} onClick={() => setZone("public")}>
            <Earth size={16} /> 公海
          </button>
          <button className={zone === "private" ? "active" : ""} onClick={() => setZone("private")}>
            <ShieldHalf size={16} /> 领海
          </button>
        </div>
      </div>
      {state.loading ? (
        <Loading />
      ) : rooms.length === 0 ? (
        <Empty
          title={zone === "public" ? "公海暂时没有开放的礁石" : "这里空空如也"}
          detail={zone === "private" ? "创建第一座私人礁石吧" : undefined}
        />
      ) : (
        <div className="reef-grid">
          {rooms.map((room: any) => (
            <button
              className="reef-card"
              key={room.id}
              onClick={() => requireLogin() && navigate(`reef/${room.id}`)}
              style={{
                borderColor: `${room.color || "#33A9DC"}70`,
                backgroundColor: `${room.color || "#33A9DC"}1F`,
              }}
            >
              <span
                style={{
                  color: room.color || "#33A9DC",
                  backgroundColor: `${room.color || "#33A9DC"}20`,
                }}
              >
                <Layers3 size={22} />
              </span>
              <div>
                <b>{room.name}</b>
                <p>{room.latestMessage?.content || "尚无消息"}</p>
              </div>
              <em>
                {room.currentCount || 0}/{room.capacity}
              </em>
            </button>
          ))}
        </div>
      )}
      <Modal
        open={applicationOpen}
        onClose={() => !applicationSubmitting && setApplicationOpen(false)}
        title="新增公海礁石申请"
      >
        {applicationSubmitted ? (
          <div className="gift-confirm-content">
            <Check size={34} />
            <p>申请已提交，肆度官方管理团队会在后台查看。</p>
            <button className="primary" onClick={() => setApplicationOpen(false)}>完成</button>
          </div>
        ) : <div className="form reef-create-form">
          <label className="reef-name-field">
            <span><Edit3 size={15} /> 公海礁石名称</span>
            <input
              maxLength={18}
              placeholder="2-18 个字"
              value={applicationName}
              onChange={(event) => { setApplicationName(event.target.value); setApplicationError(""); }}
            />
          </label>
          <label className="reef-name-field">
            <span><MessageCircle size={15} /> 申请理由</span>
            <textarea
              maxLength={200}
              placeholder="请说明希望新增这座公海礁石的原因"
              value={applicationReason}
              onChange={(event) => { setApplicationReason(event.target.value); setApplicationError(""); }}
            />
            <small>{applicationReason.length}/200</small>
          </label>
          {applicationError && <p className="error">{applicationError}</p>}
          <div className="modal-actions">
            <button className="soft-button" disabled={applicationSubmitting} onClick={() => setApplicationOpen(false)}>取消</button>
            <button
              className="primary"
              disabled={applicationSubmitting}
              onClick={async () => {
                const reefName = applicationName.trim();
                const reason = applicationReason.trim();
                if (reefName.length < 2) return setApplicationError("公海礁石名称需要 2-18 个字");
                if (!reason) return setApplicationError("请填写申请理由");
                setApplicationSubmitting(true);
                try {
                  await api.submitPublicReefApplication(reefName, reason);
                  setApplicationName("");
                  setApplicationReason("");
                  setApplicationSubmitted(true);
                } catch (error: any) {
                  setApplicationError(error?.message || "提交失败，请稍后重试");
                } finally {
                  setApplicationSubmitting(false);
                }
              }}
            >
              {applicationSubmitting ? "提交中…" : "提交申请"}
            </button>
          </div>
        </div>}
      </Modal>
      <Modal
        open={create}
        onClose={() => setCreate(false)}
        title="创建领海礁石"
        titleAction={
          <button className="rules-help" onClick={() => setRules(true)} aria-label="查看私人礁石规则">
            <CircleHelp size={15} />
          </button>
        }
      >
        <div className="form reef-create-form">
          <p className="form-hint">创建后会出现在领海广场</p>
          <label className="reef-name-field">
            <span><Edit3 size={15} /> 礁石名称</span>
            <input
              maxLength={18}
              placeholder="2-18 个字"
              value={name}
              onChange={(e) => { setName(e.target.value); setCreateError(""); }}
            />
          </label>
          <div className="reef-number-grid">
            {[
              { label: "最大容纳人数", icon: Users, value: capacity, setValue: setCapacity, min: 2, fallback: 30, unit: "人" },
              { label: "礁石存在时间", icon: Hourglass, value: hours, setValue: setHours, min: 1, fallback: 24, unit: "小时" },
            ].map(({ icon: Icon, ...field }) => (
              <label className="reef-number-field" key={field.label}>
                <span><Icon size={15} /> {field.label}</span>
                <div><input
                  inputMode="numeric"
                  maxLength={2}
                  value={field.value}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={() => field.setValue(String(normalizeNumber(field.value, field.min, field.fallback)))}
                  onChange={(event) => field.setValue(event.target.value.replace(/\D/g, "").slice(0, 2))}
                /><b>{field.unit}</b></div>
                <small>上限 44 {field.unit}</small>
              </label>
            ))}
          </div>
          {createError && <p className="error">{createError}</p>}
          <div className="modal-actions">
            <button className="soft-button" onClick={() => setCreate(false)}>取消</button>
          <button
            className="primary"
            onClick={async () => {
              const normalizedName = name.trim();
              if (normalizedName.length < 2) {
                setCreateError("礁石名称需要 2-18 个字");
                return;
              }
              try {
                const result = await api.createReef(
                  normalizedName,
                  normalizeNumber(capacity, 2, 30),
                  normalizeNumber(hours, 1, 24),
                );
                setCreate(false);
                navigate(`reef/${result.id || result.room?.id}`);
              } catch (error: any) {
                setCreateError(error?.message || "创建失败，请稍后重试");
              }
            }}
          >
            创建
          </button>
          </div>
        </div>
      </Modal>
      <Modal open={rules} onClose={() => setRules(false)} title="私人礁石规则">
        <div className="reef-rules">
          <div><b>1</b><p>礁石内依旧受到<button className="red-line-link" onClick={() => { setRules(false); setRedLine(true); }}>【肆度红线】</button>严格管控！</p></div>
          <div><b>2</b><p>礁石创建4小时后，会向礁石内发言过的用户及创建者发布一条礁石存续许可投票，如果同意票达到5票，礁石存续时长会延长至30天。</p></div>
        </div>
      </Modal>
      <Modal open={redLine} onClose={() => { setRedLine(false); setRules(true); }} title="肆度红线">
        <div className="red-line-rules">
          <em>“违反以下规则会触发最严厉的惩罚！”</em>
          {[
            "严禁发布反动、涉政、暴恐及一切违背现实法律的内容。",
            "严禁发布任何色情、淫秽、低俗及擦边内容。",
            "严禁谩骂、人身攻击、恶意引战与网络暴力。",
            "严禁发布广告、营销、黑产及恶意引流信息。",
          ].map((rule, index) => <div key={rule}><b>{index + 1}</b><p>{rule}</p></div>)}
        </div>
      </Modal>
    </>
  );
}

export function ReefChatScreen({ id, targetMessageId, navigate }: { id: string; targetMessageId?: string; navigate: Navigate }) {
  const { version, enterReef, leaveReef } = useRealtime();
  const { user } = useSession();
  const card = useLoad(() => api.reefCard(id), [id]);
  const state = useLoad(() => api.reefMessages(id, targetMessageId), [id, targetMessageId]);
  const overview = useLoad(() => api.reefOverview(id), [id]);
  const retention = useLoad(() => api.reefRetention(id), [id]);
  const [info, setInfo] = useState(false);
  const [exactMessageTimes, setExactMessageTimes] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [giftTarget, setGiftTarget] = useState<{ id: string; name: string } | null>(null);
  const [gifting, setGifting] = useState(false);
  const [giftError, setGiftError] = useState("");
  const [mentionUsers, setMentionUsers] = useState<{ id: string; name: string }[]>([]);
  const [reefReportOpen, setReefReportOpen] = useState(false);
  const [reefReportNotice, setReefReportNotice] = useState("");
  const [overviewClock, setOverviewClock] = useState(Date.now());
  const messagesAreaRef = useRef<HTMLElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
  useEffect(() => {
    if (version) {
      void state.refresh();
      void card.refresh();
      if (info) void overview.refresh();
    }
  }, [version, info]);
  useEffect(() => {
    if (!info) return;
    void overview.refresh();
    setOverviewClock(Date.now());
    const timer = window.setInterval(() => setOverviewClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [info, overview.refresh]);
  useEffect(() => {
    enterReef(id);
    return () => leaveReef();
  }, [id, enterReef, leaveReef]);
  async function sendImage(file: File) {
    const uploaded = await uploadFile(file, "m");
    const result = await api.sendReef(id, uploaded.url, "image", uploaded.mediaId);
    state.setData((current: any) => appendMessageData(current, { ...result, isMine: true }));
  }
  async function giftFrostShell() {
    if (!giftTarget || gifting) return;
    setGifting(true);
    setGiftError("");
    try {
      await api.giftFrostShell(giftTarget.id, "chat");
      setGiftTarget(null);
      await state.refresh();
    } catch (error: any) {
      setGiftError(error?.message || "赠予失败，请稍后重试");
    } finally {
      setGifting(false);
    }
  }
  const room = card.data?.room || card.data;
  const details = overview.data?.room || overview.data;
  const reefColor = room?.color || "#33A9DC";
  const speakers = list(details, "speakers");
  const groupedMessages = groupMessageTimes(list(state.data, "messages"));
  const latestMessageId = groupedMessages.at(-1)?.item?.id || "";
  useEffect(() => {
    if (state.loading || !latestMessageId) return;
    if (targetMessageId) {
      const target = messageElementsRef.current.get(targetMessageId);
      if (!target) return;
      const scrollToTarget = () => target.scrollIntoView({ block: "center", behavior: "smooth" });
      const frame = requestAnimationFrame(scrollToTarget);
      const timer = window.setTimeout(scrollToTarget, 180);
      return () => {
        cancelAnimationFrame(frame);
        window.clearTimeout(timer);
      };
    }
    const scrollToLatest = () => messagesEndRef.current?.scrollIntoView({ block: "end" });
    const frame = requestAnimationFrame(scrollToLatest);
    const timer = window.setTimeout(scrollToLatest, 180);
    const observer = new ResizeObserver(scrollToLatest);
    if (messagesAreaRef.current) observer.observe(messagesAreaRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [id, state.loading, latestMessageId, targetMessageId]);
  return (
    <div className="chat-screen">
      <div className="reef-chat-sticky-header">
        <PageHeader
          title={room?.name || "礁石"}
          subtitle={room ? `${room.currentCount || 0} 人在线` : ""}
          back
          onBack={() => history.back()}
          action={
            <button className="soft-button" onClick={() => setInfo(true)}>
              礁石概览
            </button>
          }
        />
      </div>
      <section className="messages-area reef-messages" ref={messagesAreaRef}>
        {state.loading && !state.data ? (
          <Loading />
        ) : (
          groupedMessages.map(({ item, showTime }: any) => {
            const senderId = String(item.userId || item.user_id || "");
            const senderName = item.nickname || item.username || "肆度用户";
            const mine = item.isMine || senderId === String(user?.id);
            return <div
              className={cx("message-entry", targetMessageId === item.id && "targeted-message")}
              key={item.id}
              ref={(element) => {
                if (element) messageElementsRef.current.set(item.id, element);
                else messageElementsRef.current.delete(item.id);
              }}
            >
              {showTime && <button className="message-time chat-time-divider" onClick={() => setExactMessageTimes((value) => !value)}>{formatChatTime(item.time || item.createdAt, exactMessageTimes)}</button>}
              <div className={cx("reef-message", mine && "mine")}>
                {mine || !senderId ? <Avatar src={item.avatar} name={senderName} size={34}/> : <button
                  className="chat-avatar-action"
                  aria-label={`点击赠予${senderName}浮霜贝，右键@${senderName}`}
                  onClick={() => {
                    setGiftError("");
                    setGiftTarget({ id: senderId, name: senderName });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMentionUsers((current) => current.some((mention) => mention.id === senderId)
                      ? current
                      : [...current, { id: senderId, name: senderName }].slice(0, 8));
                  }}
                ><Avatar src={item.avatar} name={senderName} size={34}/></button>}
                <div className="reef-bubble-stack"><b>{senderName}</b><div className={cx("bubble", (item.kind === "image" || item.kind === "sticker") && "media-message", item.kind === "sticker" && "sticker-message", item.kind === "image" && "image-message")}>{item.kind === "text" ? String(item.content || "").split(/(@[^\s@，。！？,.!?:：；;]+)/g).map((part: string, index: number) => part.startsWith("@") ? <span key={`${part}-${index}`} className="reef-mention">{part}</span> : part) : messageMedia(item, setViewerUrl)}</div></div>
              </div>
            </div>;
          })
        )}
      </section>
      <Composer
        placeholder="向礁石发送消息…"
        onSend={async (text) => {
          const result = await api.sendReef(id, text, "text", undefined, mentionUsers.map((mention) => mention.id));
          setMentionUsers([]);
          state.setData((current: any) => appendMessageData(current, { ...result, isMine: true }));
        }}
        onImage={sendImage}
        onSticker={async (url) => {
          const result = await api.sendReef(id, url, "sticker");
          state.setData((current: any) => appendMessageData(current, { ...result, isMine: true }));
        }}
        mentionUsers={mentionUsers}
        onRemoveMention={(userId) => setMentionUsers((current) => current.filter((mention) => mention.id !== userId))}
      />
      <div className="messages-end-anchor" ref={messagesEndRef} aria-hidden="true" />
      {viewerUrl && <ImageViewer images={[viewerUrl]} index={0} onIndex={() => {}} onClose={() => setViewerUrl(null)} />}
      <Modal open={!!giftTarget} onClose={() => !gifting && setGiftTarget(null)} title="赠予浮霜贝" className="gift-confirm-modal">
        <div className="gift-confirm-content">
          <FrostShellIcon size={34} cracked/>
          <p>确定赠予 <b>{giftTarget?.name}</b> 1 枚脆弱浮霜贝吗？</p>
          {giftError && <p className="error">{giftError}</p>}
          <div className="modal-actions">
            <button className="soft-button" disabled={gifting} onClick={() => setGiftTarget(null)}>取消</button>
            <button className="primary" disabled={gifting} onClick={() => void giftFrostShell()}>{gifting ? "赠予中…" : "确认赠予"}</button>
          </div>
        </div>
      </Modal>
      <Modal
        open={info}
        onClose={() => setInfo(false)}
        title="礁石概览"
        wide
        className="reef-overview-modal"
        headerAction={
          <div className="reef-overview-header-actions">
            <button className="reef-report-button" onClick={() => setReefReportOpen(true)} aria-label="举报礁石" title="举报礁石">
              <Flag size={18}/><span>举报</span>
            </button>
            <button className="icon-button" onClick={() => setInfo(false)} aria-label="关闭"><X size={19}/></button>
          </div>
        }
      >
        {overview.loading && !details ? <Loading/> : (
          <div className="reef-overview" style={{ "--reef-color": reefColor } as CSSProperties}>
            <section className="reef-overview-summary">
              <div className="reef-overview-icon"><Layers3 size={28}/></div>
              <h2>{details?.name || room?.name || "礁石"}</h2>
              <p>{details?.currentCount ?? room?.currentCount ?? 0}人正在礁间交谈</p>
              <div className="reef-overview-countdown">
                <Hourglass size={16}/>
                <span>存续倒计时 · {reefCountdown(details?.expiresAt || room?.expiresAt, overviewClock)}</span>
              </div>
            </section>

            <div className="reef-overview-facts">
              <div><span>礁石类型</span><b>{(details?.zone || room?.zone) === "private" ? "领海礁石" : "公海礁石"}</b></div>
              <div><span>容纳人数</span><b>{details?.capacity || room?.capacity || "—"} 人</b></div>
              <div><span>创建时间</span><b>{formatTime(details?.createdAt || room?.createdAt)}</b></div>
              <div><span>礁石状态</span><b>{details?.status === "active" || room?.status === "active" ? "正在存续" : "已结束"}</b></div>
            </div>

            {retention.data?.eligible && (
              <section className="reef-retention-panel">
                <div><b>礁石存续许可</b><small>同意票达到5票后，礁石会延长至30天。</small></div>
                {retention.data?.myVote ? (
                  <span>你已选择了{retention.data.myVote === "yes" ? "是" : "否"}</span>
                ) : (
                  <div className="field-row">
                    <button className="soft-button" onClick={async () => { await api.voteReefRetention(id, "yes"); await Promise.all([retention.refresh(), overview.refresh()]); }}>同意存续</button>
                    <button className="soft-button" onClick={async () => { await api.voteReefRetention(id, "no"); await retention.refresh(); }}>不同意</button>
                  </div>
                )}
              </section>
            )}

            <section className="reef-speakers-section">
              <div className="reef-speakers-title"><h3>发言成员</h3><span>{speakers.length}</span></div>
              <div className="reef-speakers-list">
                {speakers.length ? speakers.map((speaker: any) => (
                  <button key={speaker.id} onClick={() => { setInfo(false); navigate(`user/${speaker.id}`); }}>
                    <Avatar src={speaker.avatar} name={speaker.nickname || speaker.username} size={42}/>
                    <div><b>{speaker.nickname || speaker.username || "肆度用户"}</b><span>发言 {speaker.messageCount || 0} 条</span></div>
                    {(speaker.gender === "male" || speaker.gender === "female") && <GenderBadge gender={speaker.gender}/>}
                    <ChevronRight size={17}/>
                  </button>
                )) : <p className="reef-speakers-empty">还没有人留下声音</p>}
              </div>
            </section>
            {reefReportNotice && <p className="reef-report-notice">{reefReportNotice}</p>}
          </div>
        )}
      </Modal>
      <ReportModal
        open={reefReportOpen}
        onClose={() => setReefReportOpen(false)}
        reasons={["垃圾广告", "色情低俗", "人身攻击", "不实信息", "违法违规", "其他"]}
        onSubmit={async (reason, detail) => {
          await api.reportReef(id, reason, detail);
          setReefReportOpen(false);
          setReefReportNotice("举报已提交，我们会尽快核查这座礁石。");
        }}
      />
    </div>
  );
}

export function UndercurrentScreen({
  navigate,
  requireLogin,
}: {
  navigate: Navigate;
  requireLogin: () => boolean;
}) {
  const { user } = useSession();
  const [gender, setGender] = useState<"male" | "female">(
    String(user?.gender).toLowerCase() === "female" ? "female" : "male",
  );
  const [mode, setMode] = useState<"salvage" | "sonar">("salvage");
  const capsules = useLoad(() => api.capsuleTexts(), []);
  const posts = useLoad(() => api.undercurrent(gender), [gender]);
  const beacons = useLoad(() => api.beacons(gender), [gender]);
  const counts = useLoad(() => api.beaconCounts(gender), [gender]);
  const [wheelIndex, setWheelIndex] = useState(0);
  const [result, setResult] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [beaconEditor, setBeaconEditor] = useState(false);
  const [beaconText, setBeaconText] = useState("");
  const [beaconImage, setBeaconImage] = useState("");
  const [sending, setSending] = useState(false);
  const wheelTimer = useRef(0);
  const capsuleTexts = (capsules.data?.texts || []).map((item: any) =>
    typeof item === "string" ? item : item.text,
  ).filter(Boolean);
  const wheelItems = capsuleTexts.length ? capsuleTexts : [
    "一段空白的记忆",
    "关于某种执念",
    "无人注意的……",
    "某种无序的乱流",
    "一段低频的白噪音",
  ];

  useEffect(() => {
    if (user) void api.achievementEvent("abyss_dive").catch(() => {});
  }, [user?.id]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      void Promise.allSettled([beacons.refresh(), counts.refresh()]);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [beacons.refresh, counts.refresh]);
  useEffect(() => () => window.clearTimeout(wheelTimer.current), []);
  useEffect(() => {
    window.clearTimeout(wheelTimer.current);
    setNotice("");
  }, [mode, gender]);

  const salvage = useCallback(async () => {
    setNotice("");
    try {
      if (mode === "sonar") {
        let pool = list(beacons.data, "beacons");
        if (!pool.length) {
          const fresh = await api.beacons(gender);
          pool = list(fresh, "beacons");
          beacons.setData(fresh);
        }
        if (!pool.length) {
          setNotice("这片水域暂时没有可共振的深海信标，请稍后再试。");
          return;
        }
        setResult({ ...pool[Math.floor(Math.random() * pool.length)], isBeacon: true });
        if (user) void api.achievementEvent("resonant_echo").catch(() => {});
        return;
      }
      let pool = list(posts.data);
      if (!pool.length) {
        const fresh = await api.undercurrent(gender);
        pool = list(fresh);
        posts.setData(fresh);
      }
      if (!pool.length) {
        setNotice("这片水域暂时没有符合条件的失温切片，请稍后再试。");
        return;
      }
      setResult(pool[Math.floor(Math.random() * pool.length)]);
      if (user) void api.achievementEvent("slice_salvage").catch(() => {});
    } catch {
      setNotice("水流暂时不稳定，请稍后再试。");
    }
  }, [mode, gender, beacons.data, posts.data, user?.id]);

  const turnWheel = (step: number) => {
    setWheelIndex((value) => (value + step + wheelItems.length) % wheelItems.length);
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => void salvage(), 480);
  };
  const openBeaconEditor = async () => {
    if (!requireLogin()) return;
    try {
      const mine = await api.myBeacon();
      setBeaconText(mine?.beacon?.content || "");
      setBeaconImage(mine?.beacon?.image || "");
    } catch {
      setBeaconText("");
      setBeaconImage("");
    }
    setBeaconEditor(true);
  };
  return (
    <div className="undercurrent-page">
      <div className="deep-sea-decor" aria-hidden="true"><i /><i /><i /><i /></div>
      <header className="undercurrent-header">
        <button
          className="undercurrent-mode"
          onClick={() => setMode((value) => value === "salvage" ? "sonar" : "salvage")}
          aria-label={mode === "salvage" ? "切换到共振模式" : "切换到打捞模式"}
        >
          {mode === "salvage" ? <Fish size={22} /> : <Radio size={22} />}
        </button>
        <div>
          <div className="undercurrent-title-row">
            <h1>潜流域</h1>
            <button
              className={cx("gender-switch", gender === "female" && "female")}
              onClick={() => setGender((value) => value === "male" ? "female" : "male")}
              aria-label={`当前匹配${gender === "male" ? "男性" : "女性"}，点击切换`}
            >
              {gender === "male" ? "♂" : "♀"}
            </button>
          </div>
          <p><b>{counts.data?.undercurrent || 0}</b> 份失温切片沉入潜流，<b>{counts.data?.beacons || 0}</b> 枚深海信标完成投放。</p>
        </div>
        <button className="undercurrent-locate" onClick={openBeaconEditor} aria-label="投放深海信标">
          <Crosshair size={22} />
        </button>
      </header>

      {(capsules.loading || posts.loading) && !capsules.data ? <Loading /> : (
        <section
          className="undercurrent-wheel"
          onWheel={(event) => {
            event.preventDefault();
            turnWheel(event.deltaY > 0 ? 1 : -1);
          }}
        >
          <div className="wheel-guide" aria-hidden="true" />
          {[-3, -2, -1, 0, 1, 2, 3].map((offset) => {
            const index = (wheelIndex + offset + wheelItems.length) % wheelItems.length;
            return (
              <button
                key={`${index}-${offset}`}
                className={cx("wheel-capsule", offset === 0 && "selected")}
                style={{ "--wheel-distance": Math.abs(offset) } as CSSProperties}
                onClick={() => offset === 0 ? void salvage() : turnWheel(offset)}
              >
                {wheelItems[index]}
              </button>
            );
          })}
          <p className="wheel-hint">滚动轮盘，停稳后自动{mode === "salvage" ? "打捞切片" : "共振信标"}</p>
          {notice && <div className="undercurrent-notice">{notice}</div>}
        </section>
      )}
      <footer className="undercurrent-footer">
        宇宙充满无序的布朗运动，<br />直到两次心跳产生短暂的纠缠。
      </footer>

      <Modal open={Boolean(result)} onClose={() => setResult(null)} title={result?.isBeacon ? "共振回声" : "打捞切片"}>
        {result && (
          <div className="salvage-result">
            <div className="salvage-author">
              <Avatar src={result.avatar} name={result.nickname || result.username} />
              <div><b>{result.nickname || result.username || "未知航行者"}</b><p>{formatTime(result.createdAt)}</p></div>
            </div>
            <p className={result.isBeacon ? "beacon-copy" : ""}>{result.content || "（无内容）"}</p>
            {(result.image || result.images?.[0]) && <img src={result.image || result.images[0]} alt="打捞内容" />}
            <button
              className="primary"
              onClick={() => {
                setResult(null);
                if (result.isBeacon) {
                  if (requireLogin()) navigate(`chat/${result.userId}/${encodeURIComponent(result.nickname || result.username || "用户")}`);
                } else navigate(`post/${result.id}`);
              }}
            >
              {result.isBeacon ? <><Send size={17} /> 私信</> : "查看完整切片"}
            </button>
          </div>
        )}
      </Modal>
      <Modal
        open={beaconEditor}
        onClose={() => setBeaconEditor(false)}
        title="深海信标"
      >
        <div className="form">
          <label>
            写下你的深海信标
            <textarea
              className="textarea"
              maxLength={200}
              value={beaconText}
              placeholder="写下你的深海信标…"
              onChange={(event) => setBeaconText(event.target.value)}
            />
            <small className="character-count">{beaconText.length}/200</small>
          </label>
          {beaconImage ? (
            <div className="beacon-image-preview">
              <img src={beaconImage} alt="信标图片" />
              <button onClick={() => setBeaconImage("")}>移除图片</button>
            </div>
          ) : (
            <label className="upload-tile">
              <ImageIcon size={19} /> 添加图片（可选）
              <input
                type="file"
                accept="image/*"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  const uploaded = await uploadFile(file);
                  setBeaconImage(uploaded.url);
                }}
              />
            </label>
          )}
          <button
            className="primary"
            disabled={!beaconText.trim() || sending}
            onClick={async () => {
              if (!beaconText.trim()) return;
              setSending(true);
              try {
                await api.createBeacon(beaconText.trim(), beaconImage || undefined);
                setBeaconEditor(false);
                setBeaconText("");
                setBeaconImage("");
                await Promise.all([beacons.refresh(), counts.refresh()]);
              } finally {
                setSending(false);
              }
            }}
          >
            <Send size={17} /> {sending ? "投放中…" : "投放信标"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function NotificationsScreen({ category, navigate }: { category: string; navigate: Navigate }) {
  const state = useLoad(() => api.notifications(category), [category]);
  const [appeal, setAppeal] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [reason, setReason] = useState("");
  const acknowledgedCategory = useRef("");
  useEffect(() => {
    if (state.loading || !state.data || acknowledgedCategory.current === category) return;
    acknowledgedCategory.current = category;
    void api.readAll(category);
  }, [category, state.data, state.loading]);
  const appealTypes = new Set([
    "post_deleted",
    "comment_deleted",
    "muted",
    "banned",
  ]);
  const detailTypes = new Set([
    "welcome",
    "system",
    "achievement",
    "post_deleted",
    "comment_deleted",
    "muted",
    "banned",
    "appeal_result",
    "entropy_reward",
    "entropy_penalty",
    "reef_retention_vote",
    "feedback_reviewed",
    "feedback_reply",
    "reef_mention",
  ]);
  return (
    <>
      <PageHeader
        title={category === "system" ? "系统通知" : "互动通知"}
        back
        onBack={() => history.back()}
        action={
          <button
            className="soft-button"
            onClick={async () => {
              await api.readAll(category);
              await state.refresh();
            }}
          >
            全部已读
          </button>
        }
      />
      <section className="panel list-panel">
        {state.loading ? (
          <Loading />
        ) : (
          list(state.data).map((item: any) => (
            <article
              className={cx("notification-item", !item.isRead && "unread", detailTypes.has(item.type) && "clickable")}
              key={item.id}
              role={detailTypes.has(item.type) ? "button" : undefined}
              tabIndex={detailTypes.has(item.type) ? 0 : undefined}
              onClick={async () => {
                if (!detailTypes.has(item.type)) return;
                if (item.type === "reef_mention" && item.metadata?.roomId) {
                  await api.readNotification(item.id).catch(() => {});
                  navigate(`reef/${item.metadata.roomId}/${encodeURIComponent(item.metadata.messageId || "")}`);
                  return;
                }
                setDetail(item);
                await api.readNotification(item.id).catch(() => {});
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (detailTypes.has(item.type) && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  event.currentTarget.click();
                }
              }}
            >
              <span className="list-icon" style={notificationIconStyle(item.type)}><NotificationGlyph type={item.type} /></span>
              <div className="notification-copy">
                <b>{item.title || "社区通知"}</b>
                <p>{item.content}</p>
                {appealTypes.has(item.type) && (
                  <button
                    className="text-button"
                    disabled={!!item.appeal}
                    onClick={async (event) => {
                      event.stopPropagation();
                      await api.readNotification(item.id);
                      setAppeal(item);
                    }}
                  >
                    {item.appeal ? "申诉已提交" : "对此处理申诉"}
                  </button>
                )}
              </div>
              <time>{formatTime(item.createdAt)}</time>
            </article>
          ))
        )}
      </section>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title || "社区通知"} className={cx("notification-detail-modal", detail?.type === "welcome" && "welcome-detail-modal")}>
        <div className="notification-detail-content">
          {String(detail?.content || "").split(/\r?\n/).map((paragraph, index) => (
            paragraph ? <p key={index}>{detail?.type === "welcome" ? `　　${paragraph}` : paragraph}</p> : <br key={index} />
          ))}
          <time>{formatTime(detail?.createdAt)}</time>
        </div>
      </Modal>
      <Modal open={!!appeal} onClose={() => setAppeal(null)} title="提交申诉">
        <div className="form">
          <p className="form-note">
            请具体说明你认为处理有误的原因，至少填写10个字。
          </p>
          <textarea
            className="textarea tall"
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <button
            className="primary"
            disabled={reason.trim().length < 10}
            onClick={async () => {
              await api.appeal(appeal.id, reason.trim());
              setAppeal(null);
              setReason("");
              await state.refresh();
            }}
          >
            提交申诉
          </button>
        </div>
      </Modal>
    </>
  );
}

export function FavoritesScreen({
  navigate,
  requireLogin,
}: {
  navigate: Navigate;
  requireLogin: () => boolean;
}) {
  const state = useLoad(
    () => Promise.all([api.favoriteConversations(), api.reefs("favorites")]),
    [],
  );
  return (
    <>
      <PageHeader title="收藏" back onBack={() => history.back()} />
      <section className="panel list-panel">
        {(state.data?.[0] || []).map((item: any) => (
          <button
            className="conversation"
            key={item.userId}
            onClick={() =>
              navigate(`chat/${item.userId}/${encodeURIComponent(item.name)}`)
            }
          >
            <Avatar src={item.avatar} name={item.name} />
            <div>
              <b>{item.name}</b>
              <p>{item.lastMessage}</p>
            </div>
            <Bookmark size={15} fill="currentColor" />
          </button>
        ))}
        {list(state.data?.[1], "rooms").map((room: any) => (
          <button
            className="conversation"
            key={room.id}
            onClick={() => navigate(`reef/${room.id}`)}
          >
            <span className="list-icon reef">◌</span>
            <div>
              <b>{room.name}</b>
              <p>{room.latestMessage?.content || "礁石"}</p>
            </div>
            <Bookmark size={15} fill="currentColor" />
          </button>
        ))}
      </section>
    </>
  );
}

export function ProfileScreen({
  id,
  navigate,
  own = false,
}: {
  id?: string;
  navigate: Navigate;
  own?: boolean;
}) {
  const session = useSession();
  const target = id || session.user?.id || "";
  const state = useLoad(
    () => (own ? api.me() : api.profile(target)),
    [target, own],
  );
  const profile = state.data;
  const follow = useLoad(
    () => (own ? Promise.resolve(null) : api.followStatus(target)),
    [target, own],
  );
  const boxes = useLoad(() => (own ? api.boxes() : Promise.resolve({ boxes: [] })), [own]);
  const shells = useLoad(() => (own ? api.frostShells() : Promise.resolve(null)), [own]);
  const [edit, setEdit] = useState(false);
  const [pinnedEditor, setPinnedEditor] = useState(false);
  const [profileModal, setProfileModal] = useState<"shell" | "refrigerant" | "entropy" | null>(null);
  const postsAnchor = useRef<HTMLDivElement>(null);
  const [nickname, setNickname] = useState("");
  const [bio, setBio] = useState("");
  const [pinnedDraft, setPinnedDraft] = useState("");
  const [age, setAge] = useState(18);
  const [tags, setTags] = useState<string[]>([]);
  const [editAvatar, setEditAvatar] = useState("");
  const [editAvatarPreview, setEditAvatarPreview] = useState("");
  const [profileAvatarPreview, setProfileAvatarPreview] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [, setRestrictionClock] = useState(0);
  const mutedUntil = profile?.muted_until || profile?.mutedUntil;
  const isMuted = !!mutedUntil && parseRestrictionTime(mutedUntil) > Date.now();
  const entropyDescriptionLines = (String(profile?.entropy?.description || "您当前处于自由漂流状态。享受 26°C 的微风吧。").match(/[^。！？!?]+[。！？!?]?/g) || [])
    .map((line) => line.trim())
    .filter(Boolean);
  useEffect(() => {
    if (!isMuted) return;
    const timer = window.setInterval(() => setRestrictionClock((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [isMuted, mutedUntil]);
  useEffect(() => {
    setNickname(profile?.nickname || "");
    setBio(profile?.bio || "");
    setAge(Number.isInteger(profile?.age) ? profile.age : 18);
    setTags(profile?.tags || []);
    setEditAvatar(profile?.avatar || "");
    setEditAvatarPreview("");
  }, [profile?.nickname, profile?.bio, profile?.age, profile?.avatar, profile?.tags]);
  useEffect(() => () => {
    if (editAvatarPreview) URL.revokeObjectURL(editAvatarPreview);
  }, [editAvatarPreview]);
  useEffect(() => () => {
    if (profileAvatarPreview) URL.revokeObjectURL(profileAvatarPreview);
  }, [profileAvatarPreview]);
  function toggleProfileTag(categoryIndex: number, tag: string) {
    setTags((current) => {
      const category = tagCategories[categoryIndex];
      if ("single" in category && category.single) {
        const withoutCategory = current.filter((item) => !(category.tags as readonly string[]).includes(item));
        return current.includes(tag) ? withoutCategory : [...withoutCategory, tag];
      }
      return current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
    });
  }
  async function saveProfile() {
    if (savingProfile || avatarUploading || !nickname.trim()) return;
    setSavingProfile(true);
    setProfileError("");
    try {
      const payload: any = {
        nickname: nickname.trim(),
        age,
        tags,
      };
      if (editAvatar !== (profile?.avatar || "")) payload.avatar = editAvatar || null;
      await api.updateProfile(payload);
      await Promise.all([session.refresh(), state.refresh()]);
      setEdit(false);
    } catch (error: any) {
      setProfileError(error?.message || "保存资料失败，请稍后重试");
    } finally {
      setSavingProfile(false);
    }
  }
  function openProfileEditor() {
    setEditAvatar(profile?.avatar || "");
    setEditAvatarPreview("");
    setProfileError("");
    setEdit(true);
  }
  function closeProfileEditor() {
    if (savingProfile || avatarUploading) return;
    setEditAvatar(profile?.avatar || "");
    setEditAvatarPreview("");
    setProfileError("");
    setEdit(false);
  }
  async function changeAvatar(file: File, saveImmediately: boolean) {
    if (avatarUploading) return;
    const preview = URL.createObjectURL(file);
    setProfileError("");
    setAvatarUploading(true);
    if (saveImmediately) setProfileAvatarPreview(preview);
    else setEditAvatarPreview(preview);
    try {
      const result = await uploadFile(file, "a");
      if (saveImmediately) {
        await api.updateProfile({ avatar: result.url });
        await Promise.all([session.refresh(), state.refresh()]);
        setProfileAvatarPreview("");
      } else {
        setEditAvatar(result.url);
      }
    } catch (error: any) {
      setProfileError(error?.message || "头像上传失败，请稍后重试");
      if (saveImmediately) setProfileAvatarPreview("");
      else setEditAvatarPreview("");
    } finally {
      setAvatarUploading(false);
    }
  }
  if (state.loading) return <Loading />;
  if (state.error)
    return <ErrorBox message={state.error} retry={state.refresh} />;
  return (
    <>
      <PageHeader
        title={own ? "我的" : "个人主页"}
        action={
          own ? (
            <button
              className="soft-button"
              onClick={() => navigate("settings")}
            >
              <Settings size={15} />
              设置
            </button>
          ) : undefined
        }
      />
      <section className="profile-hero">
        <div
          className="cover"
          style={
            profile?.cover_image
              ? { backgroundImage: `url(${profile.cover_image})` }
              : undefined
          }
        >
          {profile?.cover_image && <img src={profile.cover_image} alt="个人主页背景" />}
        </div>
        <div className="profile-body">
          {own ? (
            <label className={cx("profile-avatar-upload", avatarUploading && "uploading")} title="更换头像">
              <Avatar src={profileAvatarPreview || profile?.avatar} name={profile?.nickname} size={86} />
              <input
                type="file"
                accept="image/*"
                disabled={avatarUploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void changeAvatar(file, true);
                }}
              />
            </label>
          ) : <Avatar src={profile?.avatar} name={profile?.nickname} size={86} />}
          <div className="profile-main">
            <h2>{profile?.nickname || profile?.username}</h2>
            <p>
              UID {profile?.id}
              {profile?.ipRegion ? ` · ${profile.ipRegion}` : ""}
            </p>
            <div className="tags">
              {(profile?.gender === "male" || profile?.gender === "female") && <GenderBadge gender={profile.gender} />}
              {Number.isInteger(profile?.age) && <span className="profile-age">{profile.age}岁</span>}
              {(profile?.tags || []).map((tag: string) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            {isMuted && <div className="profile-restriction"><CircleAlert size={15}/><span>禁言中，剩余 {restrictionRemaining(mutedUntil)}</span></div>}
          </div>
          {own ? (
            <button className="soft-button profile-edit" onClick={openProfileEditor}>
              <Edit3 size={15} />
              编辑资料
            </button>
          ) : (
            <div className="profile-actions">
              <button
                className="soft-button"
                onClick={() => navigate(`chat/${target}/${encodeURIComponent(profile?.nickname || profile?.username)}`)}
              >
                私信
              </button>
              <button
                className={cx("primary", "small", follow.data?.following && "following")}
                onClick={async () => {
                  await api.follow(target, !follow.data?.following);
                  await follow.refresh();
                }}
              >
                {follow.data?.following ? "已关注" : "+ 关注"}
              </button>
            </div>
          )}
        </div>
        {profileError && !edit && <p className="profile-error" role="alert">{profileError}</p>}
        {own ? <div className="profile-capsules" aria-label="个人数据">
          <button onClick={() => postsAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" })}><Layers3 size={17}/><span>切片</span><b>{profile?.stats?.posts || 0}</b></button>
          <button onClick={() => navigate("boxes")}><Boxes size={17}/><span>切片盒</span><b>{list(boxes.data, "boxes").length}</b></button>
          <button onClick={() => navigate(`users/${target}/following`)}><Users size={17}/><span>关注</span><b>{profile?.stats?.following || 0}</b></button>
          <button onClick={() => navigate(`users/${target}/followers`)}><Users size={17}/><span>粉丝</span><b>{profile?.stats?.followers || 0}</b></button>
          <button className="shell-capsule" onClick={() => setProfileModal("shell")}><FrostShellIcon size={18}/><span>贝壳</span></button>
          <button className="refrigerant-capsule" onClick={() => setProfileModal("refrigerant")}><RefrigerantIcon size={18}/><span>制冷剂</span><b>{profile?.refrigerant_count || 0}</b></button>
          <button onClick={() => setProfileModal("entropy")}><Sparkles size={17}/><span>熵减值</span><b>{profile?.entropy?.value || 0}</b></button>
        </div> : <div className="stats">
          <button onClick={() => navigate(`users/${target}/following`)}><b>{profile?.stats?.following || 0}</b><span>关注</span></button>
          <button onClick={() => navigate(`users/${target}/followers`)}><b>{profile?.stats?.followers || 0}</b><span>粉丝</span></button>
          <button onClick={() => postsAnchor.current?.scrollIntoView({ behavior: "smooth" })}><b>{profile?.stats?.posts || 0}</b><span>切片</span></button>
        </div>}
      </section>
      {(own || bio.trim()) && (
        <button
          className={cx("pinned-profile-card", own && "editable")}
          aria-disabled={!own}
          onClick={() => {
            if (!own) return;
            setPinnedDraft(bio);
            setPinnedEditor(true);
          }}
        >
          <span>TOP</span>
          <p>{bio.trim() || "点击编辑置顶卡片"}</p>
        </button>
      )}
      <Modal
        open={edit}
        onClose={closeProfileEditor}
        title="编辑资料"
        wide
        className="edit-profile-modal"
        headerAction={
          <button
            className="edit-profile-save"
            disabled={savingProfile || avatarUploading || !nickname.trim()}
            onClick={saveProfile}
          >
            {savingProfile ? "保存中…" : "保存"}
          </button>
        }
      >
        <div className="form edit-profile-form">
          <section className="edit-profile-section">
            <b>头像</b>
            <div className="edit-media-row">
              <Avatar src={editAvatarPreview || editAvatar} name={nickname} size={64} />
              <label className="soft-button upload-button">
                <Camera size={16} /> {avatarUploading ? "上传中…" : "更换头像"}
                <input type="file" accept="image/*" disabled={avatarUploading} onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void changeAvatar(file, false);
                }} />
              </label>
            </div>
            {profileError && <p className="error" role="alert">{profileError}</p>}
          </section>
          <section className="edit-profile-section edit-profile-basics">
          <label>
            昵称
            <input
              maxLength={8}
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
            <small>{nickname.length}/8</small>
          </label>
          <label>
            年龄
            <input
              type="number"
              min={0}
              max={444}
              value={age}
              onChange={(event) => setAge(Math.max(0, Math.min(444, Number(event.target.value) || 0)))}
            />
          </label>
          </section>
          {tagCategories.map((category, categoryIndex) => (
            <section className="edit-profile-section" key={category.title}>
              <b>{category.title}<small>{"single" in category && category.single ? "单选" : "多选"}</small></b>
              <div className="edit-tag-grid">
                {category.tags.map((tag) => (
                  <button
                    className={tags.includes(tag) ? "selected" : ""}
                    key={tag}
                    onClick={() => toggleProfileTag(categoryIndex, tag)}
                  >
                    {tags.includes(tag) && "✓ "}{tag}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </Modal>
      <Modal open={pinnedEditor} onClose={() => !savingProfile && setPinnedEditor(false)} title="编辑置顶卡片" className="pinned-editor-modal">
        <div className="form">
          <p className="form-note">这段文字会始终显示在你的个人主页</p>
          <textarea
            className="textarea pinned-editor-input"
            autoFocus
            maxLength={500}
            value={pinnedDraft}
            onChange={(event) => setPinnedDraft(event.target.value)}
            placeholder="写下想置顶展示的文字"
          />
          <small className="pinned-editor-count">{pinnedDraft.length}/500</small>
          <button
            className="primary"
            disabled={savingProfile}
            onClick={async () => {
              setSavingProfile(true);
              try {
                const nextBio = pinnedDraft.trim();
                await api.updateProfile({ bio: nextBio });
                setBio(nextBio);
                await Promise.all([session.refresh(), state.refresh()]);
                setPinnedEditor(false);
              } finally {
                setSavingProfile(false);
              }
            }}
          >
            {savingProfile ? "保存中…" : "保存"}
          </button>
        </div>
      </Modal>
      <Modal open={profileModal === "shell"} onClose={() => setProfileModal(null)} title="贝壳" className="inventory-system-modal">
        <div className="inventory-modal"><div className="inventory-row"><FrostShellIcon size={29} cracked/><span><b>脆弱浮霜贝</b><small>可赠予 · 每日在线获得</small></span><strong>{shells.data?.fragileCount ?? profile?.fragile_frost_shell_count ?? 0} 枚</strong></div><div className="inventory-row"><FrostShellIcon size={29}/><span><b>永恒浮霜贝</b><small>永久保存 · 无限积累</small></span><strong>{shells.data?.eternalCount ?? profile?.eternal_frost_shell_count ?? 0} 枚</strong></div><div className="inventory-rules"><p>1、每天在线4分钟可获得1枚【脆弱浮霜贝】，日上限1枚，存储上限4枚。</p><p>2、【脆弱浮霜贝】可赠予他人，同时转化为【永恒浮霜贝】，象征友好、善意、认可。</p><p>3、面对同一用户，每天仅可赠送其1枚【脆弱浮霜贝】。</p><p>4、【永恒浮霜贝】无法转赠，无法使用，永久保存，无限积累。</p></div></div>
      </Modal>
      <Modal open={profileModal === "refrigerant"} onClose={() => setProfileModal(null)} title="制冷剂" className="inventory-system-modal">
        <div className="inventory-modal"><div className="inventory-hero"><RefrigerantIcon size={36}/><strong>{profile?.refrigerant_count || 0} 瓶</strong></div><div className="inventory-rules"><p>1、每天首次登录获得 1 瓶制冷剂，最多储存 4 瓶。</p><p>2、制冷剂无法转赠，可对自己或他人的切片使用，增加推荐权重，同时降低 1°C。</p></div></div>
      </Modal>
      <Modal open={profileModal === "entropy"} onClose={() => setProfileModal(null)} title="熵减系统" className="inventory-system-modal entropy-system-modal">
        <div className="inventory-modal entropy-summary"><div className="inventory-hero"><Sparkles size={34}/><span><b>Lv.{profile?.entropy?.level || 0} {profile?.entropy?.title || "浅海漂流客"}</b><small>当前熵减值 {profile?.entropy?.value || 0}</small></span></div><div className="entropy-progress"><i style={{ width: `${Math.round((profile?.entropy?.progress || 0) * 100)}%` }}/></div><div className="entropy-description">{entropyDescriptionLines.map((line, index) => <p key={`${line}-${index}`}>“{line}”</p>)}</div><div className="inventory-rules"><p>1、用户可对评论、切片、私信提交举报，举报成功后 +5 熵减值。</p><p>2、对同一违规内容，如果你是前三个提交举报的用户，举报成功后，获得额外 5 熵减值。</p><p>3、为防止滥用举报，每累计五次无效举报，系统确认为滥用后，会扣除 25 熵减值。</p><p>4、熵减系统共分为五个等级：</p><div className="entropy-level-list"><span>Lv.0  浅海漂流客</span><span>Lv.1  浮霜清道夫</span><span>Lv.2  隐礁巡航卫</span><span>Lv.3  潜流探测员</span><span>Lv.4  肆度守望者</span></div></div></div>
      </Modal>
      <div ref={postsAnchor}><FeedScreen
        navigate={navigate}
        requireLogin={() => true}
        userId={profile?.id || target}
        enforceAuthor
        hideHeader
      /></div>
    </>
  );
}

export function BoxesScreen({ navigate }: { navigate: Navigate }) {
  const state = useLoad(() => api.boxes(), []);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  return (
    <>
      <PageHeader
        title="切片盒"
        action={
          <button className="soft-button" onClick={() => setCreate(true)}>
            新建
          </button>
        }
      />
      <div className="box-grid">
        {list(state.data, "boxes").map((box: any) => (
          <button onClick={() => navigate(`box/${box.id}`)} key={box.id}>
            <span>{box.name.slice(0, 1)}</span>
            <div>
              <b>{box.name}</b>
              <p>{box.postCount || 0} 份切片</p>
            </div>
          </button>
        ))}
      </div>
      <Modal open={create} onClose={() => setCreate(false)} title="新建切片盒">
        <div className="form">
          <label>
            名称（最多8个字）
            <input
              maxLength={8}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={async () => {
              await api.createBox(name);
              setCreate(false);
              setName("");
              await state.refresh();
            }}
          >
            新建
          </button>
        </div>
      </Modal>
    </>
  );
}
export function AchievementsScreen() {
  const state = useLoad(() => api.achievements(), []);
  const [selected, setSelected] = useState<any | null>(null);
  return (
    <>
      <PageHeader title="航行日志" />
      <div className="achievement-grid">
        {list(state.data, "achievements").map((item: any) => (
          <button
            className={item.unlocked ? "unlocked" : ""}
            disabled={!item.unlocked}
            key={item.key}
            onClick={() => item.unlocked && setSelected(item)}
          >
            <span><Award size={20} /></span>
            <b>{item.name}</b>
            {item.unlocked && <ChevronRight className="achievement-chevron" size={17} />}
          </button>
        ))}
      </div>
      <Modal open={!!selected} onClose={() => setSelected(null)} title="成就详情" className="achievement-detail-modal">
        <div className="achievement-detail">
          <span className="achievement-detail-icon"><Award size={28} /></span>
          <h2>{selected?.name}</h2>
          <p className="achievement-detail-hint">“{selected?.hint}”</p>
          <div className="achievement-condition">达成条件：{selected?.conditionText}</div>
          {!!selected?.unlockedAt && <time>解锁时间：{formatFullDateTime(selected.unlockedAt)}</time>}
        </div>
      </Modal>
    </>
  );
}

const IONICON_GLYPHS: Record<string, number> = {
  "cafe-outline": 61898, "hardware-chip-outline": 62309, "restaurant-outline": 62774,
  "game-controller-outline": 62261, "airplane-outline": 61706, "book-outline": 61862,
  "film-outline": 62207, "paw-outline": 62618, "barbell-outline": 61811,
  "briefcase-outline": 61874, "school-outline": 62813, "musical-notes-outline": 62570,
  "camera-outline": 61916, "heart-half-outline": 62325, "home-outline": 62339,
  "heart-outline": 62327, "images-outline": 62354, "chatbox-ellipses-outline": 61965,
  "tv-outline": 62981, "lock-closed-outline": 62408, "star-outline": 62873,
  "moon-outline": 62561, "sparkles-outline": 62861, "rainy-outline": 62729,
  "wine-outline": 63029, "color-palette-outline": 62078, "rose-outline": 62795,
  "megaphone-outline": 62543, "heart-dislike-outline": 62322, "shapes-outline": 62831,
  "heart-circle-outline": 62316, "happy-outline": 62306, "fish-outline": 62219,
  "chatbubbles-outline": 61976, "sad-outline": 62798, "camera-reverse-outline": 61918,
  "help-buoy-outline": 62331, "cloud-outline": 62045, "pulse-outline": 62711,
  "square-outline": 62867, "grid-outline": 62294, "bicycle-outline": 61847,
  "notifications-outline": 62591, "at-outline": 61775,
  "alert-circle-outline": 61716, "analytics-outline": 61724, "ban-outline": 61802,
  "chatbubble-ellipses-outline": 61971, "chatbubble-outline": 61973,
  "checkmark-circle-outline": 61983, "cube-outline": 62105, "eye-outline": 62186,
  "layers-outline": 62384, "person-add-outline": 62631, "shield-checkmark-outline": 62841,
  "snow-outline": 62858, "trash-outline": 62966,
};
const MATERIAL_ICON_GLYPHS: Record<string, number> = {
  "emoticon-angry-outline": 986218,
  "emoticon-lol-outline": 987669,
};
function BoardGlyph({ icon = "grid-outline" }: { icon?: string }) {
  if (icon === "shirt-outline" || icon === "ootd-outline") {
    return <svg className="custom-board-glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 3.5 6.2 4.9 3.9 8.1l2.4 1.6L8 7.9v4.5h8V7.9l1.7 1.8 2.4-1.6-2.3-3.2L15 3.5c-.5 1.3-1.5 2-3 2s-2.5-.7-3-2Z"/><path d="M7.5 13.7h9l-.6 6.8h-3.1L12 16.7l-.8 3.8H8.1l-.6-6.8Z"/></svg>;
  }
  if (icon === "bed-outline" || icon === "zzz-outline") {
    return <svg className="custom-board-glyph sleep-board-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.3 3.2h6v1.6l-3.6 3.8h3.8v1.8h-6.4V8.8l3.7-3.8h-3.5V3.2Z"/><path d="M8.7 9.4h4.8v1.4l-2.9 3h3.1v1.6H8.5V14l3-3H8.7V9.4Z"/><path d="M4 15.1h3.7v1.2l-2.1 2.2h2.3V20H3.8v-1.3L6 16.5H4v-1.4Z"/></svg>;
  }
  const material = icon.startsWith("emoticon-");
  const code = (material ? MATERIAL_ICON_GLYPHS[icon] : IONICON_GLYPHS[icon]) || IONICON_GLYPHS["grid-outline"];
  return <span className={cx("native-board-glyph", material && "material")} aria-hidden="true">{String.fromCodePoint(code)}</span>;
}
const WEB_NOTIFICATION_VISUALS: Record<string, { icon: string; color: string }> = {
  welcome: { icon: "sparkles-outline", color: "#F7B731" },
  post_deleted: { icon: "trash-outline", color: "#E17055" },
  comment_deleted: { icon: "chatbubble-ellipses-outline", color: "#E17055" },
  muted: { icon: "alert-circle-outline", color: "#E17055" },
  banned: { icon: "ban-outline", color: "#E24B4A" },
  unmuted: { icon: "checkmark-circle-outline", color: "#00B894" },
  unbanned: { icon: "checkmark-circle-outline", color: "#00B894" },
  appeal_result: { icon: "shield-checkmark-outline", color: "#33A9DC" },
  entropy_reward: { icon: "analytics-outline", color: "#33A9DC" },
  entropy_penalty: { icon: "analytics-outline", color: "#E17055" },
  achievement: { icon: "notifications-outline", color: "#33A9DC" },
  reef_retention_vote: { icon: "layers-outline", color: "#33A9DC" },
  reef_mention: { icon: "at-outline", color: "#33A9DC" },
  feedback_reviewed: { icon: "eye-outline", color: "#33A9DC" },
  feedback_reply: { icon: "chatbox-ellipses-outline", color: "#33A9DC" },
  like: { icon: "snow-outline", color: "#33A9DC" },
  comment: { icon: "chatbubble-outline", color: "#6C5CE7" },
  follow: { icon: "person-add-outline", color: "#E84393" },
  refrigerant: { icon: "snow-outline", color: "#33A9DC" },
  frost_shell: { icon: "cube-outline", color: "#33A9DC" },
  system: { icon: "megaphone-outline", color: "#F7B731" },
  interaction: { icon: "notifications-outline", color: "#33A9DC" },
};
function notificationVisual(type?: string) {
  return WEB_NOTIFICATION_VISUALS[type || ""] || { icon: "notifications-outline", color: "#9AA0B4" };
}
function notificationIconStyle(type?: string): CSSProperties {
  const { color } = notificationVisual(type);
  return { color, backgroundColor: `${color}18` };
}
function NotificationGlyph({ type }: { type?: string }) {
  if (type === "achievement") return <Award size={20} aria-hidden="true" />;
  if (type === "refrigerant") return <RefrigerantIcon size={20} />;
  if (type === "frost_shell") return <FrostShellIcon size={20} />;
  const icon = notificationVisual(type).icon;
  const code = IONICON_GLYPHS[icon] || IONICON_GLYPHS["notifications-outline"];
  return <span className="native-board-glyph notification-glyph" aria-hidden="true">{String.fromCodePoint(code)}</span>;
}
export function BoardsScreen({ navigate }: { navigate: Navigate }) {
  const state = useLoad(() => api.config(), []);
  const boards = (state.data?.boards || []).filter(isPublicBoard);
  const groups = useMemo(() => {
    const order = ["情绪", "共鸣", "兴趣", "生活", "404"];
    const result = new Map<string, any[]>();
    for (const name of order) result.set(name, []);
    for (const board of boards) {
      const name = board.category || "生活";
      if (!result.has(name)) result.set(name, []);
      result.get(name)!.push(board);
    }
    return [...result.entries()].filter(([, items]) => items.length);
  }, [boards]);
  return (
    <>
      <PageHeader title="全部冰格" subtitle="选择一个温区继续浏览" />
      {state.loading ? (
        <Loading />
      ) : (
        <div className="board-groups">
          {groups.map(([name, items]) => (
            <section key={name}>
              <h2>{name}</h2>
              <div className="board-grid">
                {items.map((board: any) => (
                  <button
                    key={board.id}
                    onClick={() => navigate(`board/${board.id}`)}
                    style={
                      {
                        "--board-color": board.color || "#55b7d8",
                        "--board-dark-color": board.colorDark || board.color || "#7FD8F5",
                      } as CSSProperties
                    }
                  >
                    <span>
                      <BoardGlyph icon={board.icon} />
                    </span>
                    <b>{board.name}</b>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

export function TopicsScreen({ navigate }: { navigate: Navigate }) {
  const state = useLoad(() => api.config(), []);
  const topics = state.data?.topics || [];
  return (
    <>
      <PageHeader title="全部话题" subtitle="循着话题，找到正在发生的相遇" />
      {state.loading ? (
        <Loading />
      ) : topics.length ? (
        <div className="topic-grid">
          {topics.map((topic: any, index: number) => {
            const name = typeof topic === "string"
              ? topic
              : topic.title || topic.name || topic.content || `话题${index + 1}`;
            return (
              <button key={topic.id || name} onClick={() => navigate(`topic/${encodeURIComponent(name)}`)}>
                <span><Hash size={18} /></span>
                <b>{String(name).replace(/^#/, "")}</b>
              </button>
            );
          })}
        </div>
      ) : (
        <Empty title="暂时没有话题" />
      )}
    </>
  );
}

export function UserListScreen({
  id,
  type,
  navigate,
}: {
  id: string;
  type: "following" | "followers";
  navigate: Navigate;
}) {
  const state = useLoad(
    () => (type === "following" ? api.following(id) : api.followers(id)),
    [id, type],
  );
  const users = list(state.data, "users");
  return (
    <>
      <PageHeader
        title={type === "following" ? "关注" : "粉丝"}
        back
        onBack={() => window.history.back()}
      />
      <section className="panel list-panel">
        {state.loading ? (
          <Loading />
        ) : users.length ? (
          users.map((item: any) => (
            <button
              className="conversation"
              key={item.id || item.userId}
              onClick={() => navigate(`user/${item.id || item.userId}`)}
            >
              <Avatar src={item.avatar} name={item.nickname || item.username} />
              <div>
                <b>{item.nickname || item.username}</b>
                <p>UID {item.id || item.userId}</p>
              </div>
              <ChevronRight size={18} />
            </button>
          ))
        ) : (
          <Empty title="这里还没有人" />
        )}
      </section>
    </>
  );
}

export function AccountScreen() {
  const { user, logout } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setError("");
    if (nextPassword.length < 10) {
      setError("新密码至少需要10位");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword({ current_password: currentPassword, password: nextPassword, verify_code: verifyCode });
      await logout();
      history.pushState(null, "", import.meta.env.BASE_URL.replace(/\/$/, "") || "/community");
      dispatchEvent(new PopStateEvent("popstate"));
    } catch (e: any) {
      setError(e.message || "修改失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="账号与安全"
        back
        onBack={() => window.history.back()}
      />
      <section className="panel form account-form">
        <p className="form-note">
          网页端会话与 App 会话相互独立；修改密码后所有已登录设备会统一退出。
        </p>
        <label>
          当前密码
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </label>
        <label>
          新密码
          <input
            type="password"
            autoComplete="new-password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
          />
        </label>
        <label>
          再次输入新密码
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </label>
        <label className="auth-code">固定验证码<span><input inputMode="numeric" maxLength={6} value={verifyCode} onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))} placeholder="固定验证码 000000"/><button type="button" disabled={!user?.phone} onClick={async () => { setError(""); try { const result = await api.sendCode(user.phone, "password_change"); setVerifyCode(String(result.fixedCode || "000000")); } catch (e: any) { setError(e.message || "获取失败"); } }}>填入验证码</button></span></label>
        {error && <p className="error">{error}</p>}
        <button
          className="primary"
          disabled={
            busy || !currentPassword || !nextPassword || !confirmPassword || verifyCode.length !== 6
          }
          onClick={save}
        >
          {busy ? "正在保存…" : "修改密码"}
        </button>
      </section>
    </>
  );
}

const landPrompts = [
  "允许今天没有结论。",
  "把世界调成静音，再听一遍自己。",
  "有些抵达，不需要被任何人看见。",
  "暂时离开坐标，也是一种航行。",
  "缓慢不是停滞，是另一种速度。",
  "此刻的空白，也值得被保存。",
];
export function OffTheLandScreen() {
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * landPrompts.length),
  );
  const next = () =>
    setIndex(
      (value) =>
        (value + 1 + Math.floor(Math.random() * (landPrompts.length - 1))) %
        landPrompts.length,
    );
  return (
    <>
      <PageHeader title="离地而居" back onBack={() => window.history.back()} />
      <button className="off-land" onClick={next}>
        <span>OFF THE LAND</span>
        <blockquote>“{landPrompts[index]}”</blockquote>
        <p>点击文字，切换一条新的提示</p>
        <i>凡真实的人生，皆为相遇。</i>
      </button>
    </>
  );
}

export function SettingsScreen({ navigate }: { navigate: Navigate }) {
  const { logout } = useSession();
  return (
    <>
      <PageHeader title="设置" />
      <section className="panel settings-list">
        <button onClick={() => navigate("account")}>
          <Lock />
          <div>
            <b>账号与安全</b>
            <p>修改登录密码</p>
          </div>
          <ChevronRight />
        </button>
        <button onClick={() => navigate("feed/cooled")}>
          <Heart />
          <div>
            <b>霜迹</b>
            <p>查看你降温过的切片</p>
          </div>
          <ChevronRight />
        </button>
        <button onClick={() => navigate("blocked")}>
          <Lock />
          <div>
            <b>黑名单</b>
            <p>管理已屏蔽用户</p>
          </div>
          <ChevronRight />
        </button>
        <button onClick={() => navigate("feedback")}>
          <MessageCircle />
          <div>
            <b>听取反馈</b>
            <p>向团队提交问题与建议</p>
          </div>
          <ChevronRight />
        </button>
        <button onClick={() => navigate("achievements")}>
          <Award />
          <div>
            <b>航行日志</b>
            <p>查看已经解锁的航行成就</p>
          </div>
          <ChevronRight />
        </button>
        <button
          className="danger-row"
          onClick={async () => {
            navigate("feed/recommend");
            await logout();
          }}
        >
          <Lock />
          <div>
            <b>退出登录</b>
          </div>
        </button>
      </section>
    </>
  );
}

export function FeedbackScreen({ navigate, history = false }: { navigate: Navigate; history?: boolean }) {
  const feedbackHistory = useLoad(() => api.feedbackHistory(), []);
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const imagePreview = useMemo(() => image ? URL.createObjectURL(image) : "", [image]);
  useEffect(() => () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }, [imagePreview]);
  const items = list(feedbackHistory.data, "feedback");
  if (history) return <>
    <PageHeader title="历史反馈" back onBack={() => navigate("feedback")} />
    <section className="feedback-history-list">
      {feedbackHistory.loading ? <Loading/> : !items.length ? <Empty title="还没有提交过反馈"/> : items.map((item: any) => {
        const open = expanded === item.id;
        return <button className={cx("feedback-history-card", open && "expanded")} key={item.id} onClick={() => setExpanded(open ? null : item.id)}>
          <div className="feedback-history-meta">
            <time>{formatTime(item.createdAt || item.created_at)}</time>
            <span className={item.reviewedAt ? "feedback-status reviewed" : "feedback-status pending"}>{item.reviewedAt ? "已查看" : "未查看"}</span>
            {item.replyContent && <span className="feedback-status replied">已回复</span>}
          </div>
          <p>{item.content}</p>
          {item.imageUrl && (
            <img src={item.imageUrl} alt="反馈附件" onClick={(event) => { event.stopPropagation(); setViewerUrl(item.imageUrl); }}/>
          )}
          {open && item.replyContent && <blockquote><b>肆度官方回复</b><span>{item.replyContent}</span></blockquote>}
          {open && !item.replyContent && <small>{item.reviewedAt ? "管理团队已查看，暂未回复。" : "管理团队尚未查看这条反馈。"}</small>}
        </button>;
      })}
    </section>
    {viewerUrl && (
      <ImageViewer images={[viewerUrl]} index={0} onIndex={() => {}} onClose={() => setViewerUrl(null)}/>
    )}
  </>;
  return (
    <>
      <PageHeader title="我要反馈" back onBack={() => window.history.back()} action={<button className="soft-button" onClick={() => navigate("feedback/history")}>历史反馈</button>} />
      <section className="panel form feedback-form">
        <label>
          你的意见
          <textarea
            className="textarea tall"
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={feedbackHistory.data?.canSubmitToday === false ? "今天已经提交过反馈了" : "请告诉我们你的想法或遇到的问题"}
            disabled={sending || feedbackHistory.data?.canSubmitToday === false}
          />
          <small className="feedback-count">{text.length}/2000</small>
        </label>
        {imagePreview ? <div className="feedback-image-preview"><img src={imagePreview} alt="待提交反馈图片"/><button type="button" aria-label="移除图片" onClick={() => setImage(null)}><X size={17}/></button></div> : <label className="feedback-image-picker"><ImageIcon size={23}/><span>添加一张图片</span><input type="file" accept="image/*" disabled={sending || feedbackHistory.data?.canSubmitToday === false} onChange={(event) => setImage(event.target.files?.[0] || null)}/></label>}
        <p className="feedback-limit">每个账号每天可提交一次反馈</p>
        {error && <p className="error"><CircleAlert size={15}/>{error}</p>}
        <button
          className="primary"
          disabled={sending || !text.trim() || feedbackHistory.data?.canSubmitToday === false}
          onClick={async () => {
            setSending(true); setError(""); setSent(false);
            try {
              const uploaded = image ? await uploadFile(image, "f") : null;
              await api.feedback(text.trim(), uploaded?.url);
              setText(""); setImage(null); setSent(true);
              await feedbackHistory.refresh();
            } catch (err: any) {
              setError(err?.message || "提交失败，请稍后重试");
            } finally { setSending(false); }
          }}
        >
          {sending ? "正在提交…" : "提交反馈"}
        </button>
        {sent && <p className="success">反馈已送达，感谢你的认真表达。</p>}
      </section>
    </>
  );
}
export function BlockedScreen() {
  const state = useLoad(() => api.blocked(), []);
  return (
    <>
      <PageHeader title="黑名单" back onBack={() => history.back()} />
      <section className="panel list-panel">
        {list(state.data, "users").map((item: any) => (
          <div className="conversation" key={item.id}>
            <Avatar src={item.avatar} name={item.nickname} />
            <div>
              <b>{item.nickname || item.username}</b>
              <p>UID {item.id}</p>
            </div>
            <button
              className="soft-button"
              onClick={async () => {
                await api.block(item.id, false);
                await state.refresh();
              }}
            >
              移除
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
export function LegalScreen({ document }: { document: string }) {
  const legalDocument = LEGAL_DOCUMENTS[document];
  const title = legalDocument?.title || "法律文件";
  return (
    <>
      <PageHeader title={title} back onBack={() => history.back()} />
      <article className="panel legal-page">
        {legalDocument ? (
          <>
            <p className="legal-date">更新日期：{legalDocument.updatedAt}</p>
            <p className="legal-intro">{legalDocument.intro}</p>
            {legalDocument.sections.map((section) => (
              <section key={section.heading}>
                <h2>{section.heading}</h2>
                <p>{section.body}</p>
              </section>
            ))}
            <footer>{LEGAL_OPERATOR}</footer>
          </>
        ) : (
          <Empty title="未找到该法律文件" />
        )}
      </article>
    </>
  );
}
