import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Bookmark,
  ChevronRight,
  CircleAlert,
  Heart,
  Image as ImageIcon,
  LoaderCircle,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Send,
  Smile,
  X,
} from "lucide-react";
import { api, uploadFile } from "./api";
import { EMOJI_GROUPS } from "./emoji-data";
import { useSession } from "./session";
import logoDay from "../../community-app/assets/images/logo_day.png";
import logoNight from "../../community-app/assets/images/logo_night.png";

let openModalCount = 0;
let previousBodyOverflow = "";

export function cx(...values: (string | false | null | undefined)[]) {
  return values.filter(Boolean).join(" ");
}

export function TemperatureIceIcon({ size = 18 }: { size?: number }) {
  return <svg className="temperature-symbol" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 7L54 19.5V44.5L32 57L10 44.5V19.5L32 7Z" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/><path d="M10.8 19.8L32 31.7L53.2 19.8M32 31.7V56M20 16L32 22.7L44 16" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function TemperatureWaterIcon({ size = 18 }: { size?: number }) {
  return <svg className="temperature-symbol" width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="M32 6C27.5 14.2 14 27.6 14 40.1C14 50.4 22 58 32 58C42 58 50 50.4 50 40.1C50 27.6 36.5 14.2 32 6Z" fill="currentColor" fillOpacity=".08" stroke="currentColor" strokeWidth="3.5" strokeLinejoin="round"/><path d="M23 41.5C23.4 47 27.2 50.2 32.5 50.5M25 27.5C27.3 23.5 30 19.7 32 16.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"/></svg>;
}

export function CoolingIcon({ size = 18, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <span
      className="app-snowflake-icon"
      style={{ width: size, height: size, fontSize: size }}
      aria-hidden="true"
    >
      {filled ? "\uF589" : "\uF58A"}
    </span>
  );
}

export function RefrigerantIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.1 3.6h5.8v2H9.1z" fill="currentColor"/><rect x="6.6" y="5.2" width="10.8" height="16" rx="3.3" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeWidth="1.65"/><path d="M7.5 15.6h9v2.8a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2z" fill="currentColor" fillOpacity=".2"/><path d="M12 8.3v6.5M9.2 9.9l5.6 3.3M9.2 13.2l5.6-3.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>;
}

export function GenderBadge({ gender }: { gender: "male" | "female" }) {
  const male = gender === "male";
  return <span className={cx("web-gender-badge", gender)} aria-label={male ? "男性" : "女性"}>
    <span aria-hidden="true">{male ? "♂" : "♀"}</span>
  </span>;
}

export function FrostShellIcon({ size = 19, cracked = false }: { size?: number; cracked?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <path d="M32 15C18.6 15 9.5 21.9 9.5 31.3C9.5 38.4 18.4 46.5 25.6 49.8V53.4C25.6 55.3 27.4 56.5 29.6 56.5H34.4C36.6 56.5 38.4 55.3 38.4 53.4V49.8C45.6 46.5 54.5 38.4 54.5 31.3C54.5 21.9 45.4 15 32 15Z" fill="currentColor" fillOpacity=".035" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    {cracked ? <path d="M34.5 22.1L30 30.5L34.2 35.1L30.5 42" stroke="currentColor" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/> : <path d="M32 31C28.9 27.2 26.3 25.6 23.9 26.5C20.2 27.9 20.2 34.1 23.9 35.5C26.3 36.4 28.9 34.8 32 31C35.1 27.2 37.7 25.6 40.1 26.5C43.8 27.9 43.8 34.1 40.1 35.5C37.7 36.4 35.1 34.8 32 31Z" fill="none" stroke="currentColor" strokeWidth="2.55" strokeLinecap="round" strokeLinejoin="round"/>}
    <path d="M27.5 49.5C30.5 47.6 33.5 47.6 36.5 49.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>;
}

export function ImageViewer({ images, index, onClose, onIndex }: { images: string[]; index: number; onClose: () => void; onIndex: (index: number) => void }) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && images.length > 1) onIndex((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight" && images.length > 1) onIndex((index + 1) % images.length);
    };
    document.body.classList.add("viewer-open");
    window.addEventListener("keydown", keydown);
    return () => { document.body.classList.remove("viewer-open"); window.removeEventListener("keydown", keydown); };
  }, [images.length, index, onClose, onIndex]);
  if (!images[index]) return null;
  return createPortal(<div className="image-viewer" role="dialog" aria-modal="true" aria-label="图片查看器" onClick={(event) => { event.stopPropagation(); onClose(); }}>
    <div className="image-viewer-count">{index + 1} / {images.length}</div>
    <button className="image-viewer-close" aria-label="关闭图片" onClick={onClose}><X size={25}/></button>
    {images.length > 1 && <button className="image-viewer-nav previous" aria-label="上一张" onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + images.length) % images.length); }}><ChevronRight size={30}/></button>}
    <img src={images[index]} alt={`大图 ${index + 1}`} onClick={(e) => e.stopPropagation()} />
    {images.length > 1 && <button className="image-viewer-nav next" aria-label="下一张" onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % images.length); }}><ChevronRight size={30}/></button>}
  </div>, document.body);
}
export function formatTime(value?: string) {
  if (!value) return "";
  const normalized = value.includes("T")
    ? value
    : value.replace(" ", "T") + "+08:00";
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) return value;
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(time));
}
export function formatChatTime(value?: string, exact = false) {
  if (!value) return "";
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value.replace(" ", "T")}+08:00`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  const pad = (item: number) => String(item).padStart(2, "0");
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (exact) {
    const year = date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`;
    return `${year}${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
  }
  const diff = Math.max(0, now.getTime() - date.getTime());
  if (diff < 60_000) return "刚刚";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const calendarDays = Math.max(0, Math.round((today - day) / 86_400_000));
  if (calendarDays === 0) return clock;
  if (calendarDays === 1) return `昨天 ${clock}`;
  if (calendarDays < 30) return `${calendarDays}天前 ${clock}`;
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}
export function Avatar({
  src,
  name,
  size = 42,
}: {
  src?: string | null;
  name?: string;
  size?: number;
}) {
  const color = useMemo(() => {
    const palette = ["#55b7d8", "#e38ca8", "#6eb99d", "#8e91d8", "#d9a55d"];
    let n = 0;
    for (const c of name || "") n += c.charCodeAt(0);
    return palette[n % palette.length];
  }, [name]);
  return src ? (
    <img
      className="avatar-img"
      src={src}
      alt=""
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      className="avatar"
      style={{ width: size, height: size, background: color }}
    >
      {(name || "肆").slice(0, 1)}
    </span>
  );
}
export function Empty({
  icon = "◇",
  title,
  detail,
}: {
  icon?: string;
  title: string;
  detail?: string;
}) {
  return (
    <div className="empty">
      <span>{icon}</span>
      <h3>{title}</h3>
      {detail && <p>{detail}</p>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} />
      正在抵达…
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  titleAction,
  headerAction,
  children,
  wide = false,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  titleAction?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollbar, setScrollbar] = useState({ top: 0, height: 100, visible: false });
  const syncScrollbar = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const visible = element.scrollHeight > element.clientHeight + 1;
    const height = visible ? Math.max(12, (element.clientHeight / element.scrollHeight) * 100) : 100;
    const progress = element.scrollHeight > element.clientHeight
      ? element.scrollTop / (element.scrollHeight - element.clientHeight)
      : 0;
    setScrollbar({ top: progress * (100 - height), height, visible });
  }, []);
  useEffect(() => {
    if (!open) return;
    if (openModalCount === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModalCount += 1;
    return () => {
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(syncScrollbar);
    const observer = new ResizeObserver(syncScrollbar);
    if (scrollRef.current) {
      observer.observe(scrollRef.current);
      if (scrollRef.current.firstElementChild) observer.observe(scrollRef.current.firstElementChild);
    }
    window.addEventListener("resize", syncScrollbar);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", syncScrollbar);
    };
  }, [open, syncScrollbar, children]);
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.currentTarget === e.target) onClose();
      }}
      onWheel={(e) => {
        if (e.currentTarget === e.target) {
          e.preventDefault();
          scrollRef.current?.scrollBy({ top: e.deltaY });
        }
      }}
    >
      <section
        className={cx("modal", wide && "modal-wide", className)}
        role="dialog"
        aria-modal="true"
      >
        <header>
          <div className="modal-title-row">
            <strong>{title}</strong>
            {titleAction}
          </div>
          {headerAction || (
            <button className="icon-button" onClick={onClose} aria-label="关闭">
              <X size={19} />
            </button>
          )}
        </header>
        <div className="modal-scroll-shell">
          <div className="modal-scroll-area" ref={scrollRef} onScroll={syncScrollbar}>
            {children}
          </div>
          {scrollbar.visible && (
            <div className="modal-scrollbar" aria-hidden="true">
              <i style={{ top: `${scrollbar.top}%`, height: `${scrollbar.height}%` }} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
export function LoginModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { login, register } = useSession();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [age, setAge] = useState(18);
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [customQuestion, setCustomQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [code, setCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const avatarPreview = useMemo(() => avatar ? URL.createObjectURL(avatar) : "", [avatar]);
  useEffect(() => () => { if (avatarPreview) URL.revokeObjectURL(avatarPreview); }, [avatarPreview]);
  const securityQuestions = [
    "你最喜欢的季节是什么？", "你最喜欢的颜色是什么？", "你最喜欢的饮料是什么？",
    "你最喜欢的动物是什么？", "你最喜欢的电影类型是什么？", "你最常用的手机功能是什么？",
    "你最喜欢的休闲活动是什么？", "自定义问题",
  ];
  const phoneValid = /^1[3-9]\d{9}$/.test(phone);
  const registrationValid = phoneValid && password.length >= 10 && nickname.trim() && avatar && gender &&
    securityQuestion && (securityQuestion !== "自定义问题" || customQuestion.trim()) && securityAnswer.trim() &&
    code.length === 6 && agreed;
  const recoveryValid = phoneValid && password.length >= 10 && code.length === 6 && agreed;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
        await login(phone.trim(), password);
      } else if (mode === "register") {
        await register({
          username: `user_${phone}`,
          password,
          phone,
          code,
          nickname: nickname.trim(),
          gender: gender as "male" | "female",
          age,
          security_question: securityQuestion === "自定义问题" ? `自定义：${customQuestion.trim()}` : securityQuestion,
          security_answer: securityAnswer.trim(),
        }, avatar);
      } else {
        await api.resetPassword({ phone, password, verify_code: code });
        setMode("login"); setPassword(""); setCode("");
        return;
      }
      onClose();
    } catch (err: any) {
      setError(err.message || "登录失败");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={mode === "login" ? "登录肆度" : mode === "register" ? "注册肆度" : "重设密码"} wide={mode === "register"} className="auth-modal">
      <form className="form auth-form" onSubmit={submit}>
        <div className="auth-brand">
          <picture><img className="auth-logo-day" src={logoDay} alt="肆度"/><img className="auth-logo-night" src={logoNight} alt="肆度"/></picture>
          <div><b>肆度</b><p>{mode === "register" ? "好好好，又多了一位用户" : mode === "forgot" ? "验证手机号后设置新密码" : "4°C，情绪的最佳保鲜温度"}</p></div>
        </div>
        <label>手机号<input inputMode="numeric" maxLength={11} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} autoComplete="username" placeholder="请输入手机号"/></label>
        <label>密码<input type="password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "请输入密码" : "请设置密码（至少10位）"}/></label>
        {mode === "register" && <>
          <label>昵称<input maxLength={12} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="请输入昵称"/></label>
          <label className="auth-avatar-picker">头像<span>{avatarPreview ? <img src={avatarPreview} alt="待上传头像"/> : <ImageIcon size={22}/>}<i>{avatar ? avatar.name : "选择一张头像"}</i></span><input type="file" accept="image/*" onChange={(e) => setAvatar(e.target.files?.[0] || null)}/></label>
          <fieldset className="auth-gender"><legend>性别（选定后不可修改）</legend><button type="button" className={gender === "male" ? "selected male" : "male"} onClick={() => setGender("male")}>♂ 男</button><button type="button" className={gender === "female" ? "selected female" : "female"} onClick={() => setGender("female")}>♀ 女</button></fieldset>
          <label>年龄<input type="number" min={0} max={444} value={age} onChange={(e) => setAge(Math.max(0, Math.min(444, Number(e.target.value) || 0)))}/></label>
          <label>密保问题<select value={securityQuestion} onChange={(e) => setSecurityQuestion(e.target.value)}><option value="">请选择密保问题</option>{securityQuestions.map((question) => <option key={question}>{question}</option>)}</select></label>
          {securityQuestion === "自定义问题" && <label>自定义密保问题<input maxLength={100} value={customQuestion} onChange={(e) => setCustomQuestion(e.target.value)} placeholder="请输入你的密保问题"/></label>}
          <label>密保答案<input maxLength={200} value={securityAnswer} onChange={(e) => setSecurityAnswer(e.target.value)} placeholder="密保问题答案"/></label>
          <label className="auth-code">验证码<span><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="固定验证码 000000"/><button type="button" disabled={!phoneValid} onClick={async () => { setError(""); try { const result = await api.sendCode(phone, "register"); setCode(String(result.fixedCode || "000000")); } catch (e: any) { setError(e.message || "获取失败"); } }}>填入验证码</button></span></label>
          <label className="auth-agreement"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}/><span>我已阅读并同意 <button type="button" onClick={() => { history.pushState(null, "", `${import.meta.env.BASE_URL}legal/user-agreement`.replace(/\/{2,}/g, "/")); dispatchEvent(new PopStateEvent("popstate")); onClose(); }}>《用户协议》</button>和<button type="button" onClick={() => { history.pushState(null, "", `${import.meta.env.BASE_URL}legal/privacy-policy`.replace(/\/{2,}/g, "/")); dispatchEvent(new PopStateEvent("popstate")); onClose(); }}>《隐私政策》</button></span></label>
        </>}
        {mode !== "register" && <label className="auth-agreement"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}/><span>我已阅读并同意 <button type="button" onClick={() => { history.pushState(null, "", `${import.meta.env.BASE_URL}legal/user-agreement`.replace(/\/{2,}/g, "/")); dispatchEvent(new PopStateEvent("popstate")); onClose(); }}>《用户协议》</button>和<button type="button" onClick={() => { history.pushState(null, "", `${import.meta.env.BASE_URL}legal/privacy-policy`.replace(/\/{2,}/g, "/")); dispatchEvent(new PopStateEvent("popstate")); onClose(); }}>《隐私政策》</button></span></label>}
        {mode === "forgot" && <label className="auth-code">验证码<span><input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="固定验证码 000000"/><button type="button" disabled={!phoneValid} onClick={async () => { setError(""); try { const result = await api.sendCode(phone, "password_reset"); setCode(String(result.fixedCode || "000000")); } catch (e: any) { setError(e.message || "获取失败"); } }}>填入验证码</button></span></label>}
        {error && (
          <p className="error">
            <CircleAlert size={15} />
            {error}
          </p>
        )}
        <button className="primary" disabled={busy || (mode === "login" ? !phoneValid || !password || !agreed : mode === "register" ? !registrationValid : !recoveryValid)}>
          {busy ? "正在处理…" : mode === "login" ? "登录" : mode === "register" ? "注册" : "重设密码"}
        </button>
        <div className="auth-links">
          <button type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "没有账号？点击注册" : "返回登录"}</button>
          {mode === "login" && <button type="button" className="muted" onClick={() => { setMode("forgot"); setPassword(""); setCode(""); setError(""); }}>忘记密码？</button>}
        </div>
      </form>
    </Modal>
  );
}

function postImages(post: any) {
  const live = (post.livePhotos || []).map((item: any) => ({
    url: item.stillUrl,
    live: true,
  }));
  if (post.videoMediaType === "live_photo" && post.videoPoster)
    live.push({ url: post.videoPoster, live: true });
  const images = (
    post.thumbnails?.length ? post.thumbnails : post.images || []
  ).map((url: string) => ({ url, live: false }));
  return [...images, ...live].slice(0, 9);
}
function boardNames(post: any, boards: any[]) {
  let ids: string[] = [];
  try {
    const value = JSON.parse(post.boardId || "[]");
    ids = Array.isArray(value) ? value : [value];
  } catch {
    if (post.boardId) ids = [post.boardId];
  }
  return ids.map((id) => boards.find((b) => b.id === id)).filter(Boolean);
}

function postContentParts(content: unknown) {
  const value = String(content || "");
  const match = value.match(/^(#[^\r\n]+)(?:\r?\n|$)([\s\S]*)$/);
  return match
    ? { topic: match[1].trim(), body: match[2].trimStart() }
    : { topic: "", body: value };
}

export function PostCard({
  post,
  boards = [],
  onOpen,
  onUser,
  onBoard,
  onTopic,
  onBox,
  onChanged,
  requireLogin,
}: {
  post: any;
  boards?: any[];
  onOpen: () => void;
  onUser: (id: string) => void;
  onBoard: (id: string) => void;
  onTopic: (topic: string) => void;
  onBox: (id: string) => void;
  onChanged?: () => void;
  requireLogin: () => boolean;
}) {
  const { user } = useSession();
  const [liked, setLiked] = useState(!!post.liked);
  const [likes, setLikes] = useState(Number(post.likes) || 0);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const media = postImages(post);
  const author = post.nickname || post.author || post.username || "未知航行者";
  const authorId = String(post.userId || post.user_id || post.authorUid || "");
  const currentUserId = String(user?.id || user?.userId || "");
  const canOpenAuthor = !!authorId && authorId !== currentUserId;
  const tags = boardNames(post, boards);
  const content = postContentParts(post.content);
  const isAnnouncement = (() => {
    try {
      const value = JSON.parse(post.boardId || "[]");
      return Array.isArray(value) ? value.includes("announce") : value === "announce";
    } catch {
      return post.boardId === "announce";
    }
  })();
  const temperaturePercent = typeof post.temperature === "number"
    ? Math.max(0, Math.min(100, ((post.temperature + 18) / 44) * 100))
    : 0;
  async function toggleLike(e: React.MouseEvent) {
    e.stopPropagation();
    if (!requireLogin() || busy) return;
    const next = !liked;
    setLiked(next);
    setLikes((v) => Math.max(0, v + (next ? 1 : -1)));
    setBusy(true);
    try {
      const result = await api.cool(post.id, next);
      setLiked(!!result.liked);
      setLikes(Number(result.likes) || 0);
    } catch {
      setLiked(!next);
      setLikes((v) => Math.max(0, v + (next ? -1 : 1)));
    } finally {
      setBusy(false);
    }
  }
  async function useRefrigerant() {
    if (!requireLogin()) return;
    setBusy(true);
    try {
      await api.refrigerant(post.id);
      setMenu(false);
      onChanged?.();
    } catch (err: any) {
      alertInline(err.message);
    } finally {
      setBusy(false);
    }
  }
  const [notice, setNotice] = useState("");
  function alertInline(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2500);
  }
  return (
    <article className="post-card real" onClick={onOpen}>
      <div className="post-head">
        <button
          className="avatar-button"
          aria-label={canOpenAuthor ? `查看${author}的主页` : undefined}
          aria-disabled={!canOpenAuthor}
          onClick={(e) => {
            e.stopPropagation();
            if (canOpenAuthor) onUser(authorId);
          }}
        >
          <Avatar src={post.avatar} name={author} />
        </button>
        <div>
          <button
            type="button"
            className="post-author-button"
            aria-disabled={!canOpenAuthor}
            onClick={(event) => {
              event.stopPropagation();
              if (canOpenAuthor) onUser(authorId);
            }}
          >
            {author}
          </button>
          <p>
            {formatTime(post.createdAt || post.time)}
            {post.ipRegion ? ` · ${post.ipRegion}` : ""}
          </p>
        </div>
        <div className="post-boards">
          {tags.map((b: any) => (
            <button
              key={b.id}
              style={{
                color: b.color,
                borderColor: `${b.color}55`,
                background: `${b.color}12`,
              }}
              onClick={(e) => {
                e.stopPropagation();
                onBoard(b.id);
              }}
            >
              {b.name}
            </button>
          ))}
        </div>
        <button
          className="more"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(true);
          }}
        >
          <MoreHorizontal size={19} />
        </button>
      </div>
      {post.content && (
        <p className="post-copy">
          {content.topic && (
            <button
              type="button"
              className="post-topic"
              onClick={(event) => {
                event.stopPropagation();
                onTopic(content.topic.replace(/^#/, ""));
              }}
            >
              {content.topic}
            </button>
          )}
          {content.body && <span className="post-copy-body">{content.body}</span>}
        </p>
      )}
      {media.length > 0 && (
        <div
          className={cx(
            "media-grid",
            media.length === 1 && "one",
            media.length === 2 && "two",
          )}
        >
          {media.map((item: any, index: number) => (
            <div className="media-cell" key={`${item.url}-${index}`}>
              <img src={item.url} alt="切片媒体" loading="lazy" onClick={(e) => { e.stopPropagation(); setViewerIndex(index); }} />
              {item.live && <span className="live-badge">实况 · 静态预览</span>}
            </div>
          ))}
        </div>
      )}
      {post.reefRoomId && (
        <div className="reef-inline">
          <span>◌</span>
          <div>
            <b>关联礁石</b>
            <p>点击切片详情进入礁石</p>
          </div>
          <ChevronRight size={17} />
        </div>
      )}
      {isAnnouncement ? (
        <div className="constant-temperature">恒温态</div>
      ) : typeof post.temperature === "number" && (
        <div className="temperature">
          <span className="temperature-icon ice"><TemperatureIceIcon size={18} /></span>
          <div className="temperature-scale">
            <div className="temperature-track"><span /></div>
            <i className="temperature-tick" style={{ left: `${temperaturePercent}%` }} />
          </div>
          <span className="temperature-icon water"><TemperatureWaterIcon size={18} /></span>
        </div>
      )}
      <div className="post-footer">
        <button>
          <MessageCircle size={17} />
          {Number(post.comments) || 0}
        </button>
        {post.sliceBox && (
          <button
            className="box-pill"
            onClick={(e) => {
              e.stopPropagation();
              onBox(post.sliceBox.id);
            }}
          >
            <Bookmark size={13} />
            {post.sliceBox.name}
          </button>
        )}
        <button className={cx("cool-action", liked && "liked")} onClick={toggleLike}>
          {likes}
          <CoolingIcon size={18} filled={liked} />
        </button>
      </div>
      {notice && <div className="toast-inline">{notice}</div>}
      <Modal open={menu} onClose={() => setMenu(false)} title="切片操作">
        <div className="action-list">
          <button onClick={useRefrigerant}>使用一枚制冷剂</button>
          <button
            onClick={() => {
              setMenu(false);
              setReport(true);
            }}
          >
            举报此切片
          </button>
        </div>
      </Modal>
      <ReportModal
        open={report}
        onClose={() => setReport(false)}
        onSubmit={async (reason, detail) => {
          await api.reportPost(post.id, reason, detail);
          setReport(false);
          alertInline("举报已提交");
        }}
      />
      {viewerIndex !== null && <ImageViewer images={media.map((item: any) => item.url)} index={viewerIndex} onIndex={setViewerIndex} onClose={() => setViewerIndex(null)} />}
    </article>
  );
}

const defaultReportReasons = [
  "违法违规",
  "色情低俗",
  "谩骂攻击",
  "广告引流",
  "虚假信息",
  "其他",
];
export function ReportModal({
  open,
  onClose,
  onSubmit,
  reasons = defaultReportReasons,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string, detail: string) => Promise<void>;
  reasons?: string[];
}) {
  const [reason, setReason] = useState(reasons[0] || "其他");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="选择举报理由">
      <div className="reason-grid">
        {reasons.map((item) => (
          <button
            className={reason === item ? "selected" : ""}
            onClick={() => setReason(item)}
            key={item}
          >
            {item}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        placeholder={
          reason === "其他" ? "请填写具体理由（必填）" : "可补充具体情况"
        }
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button
        className="primary"
        disabled={busy}
        onClick={async () => {
          if (reason === "其他" && !detail.trim()) {
            setError("选择其他时必须填写理由");
            return;
          }
          setBusy(true);
          try {
            await onSubmit(reason, detail.trim());
          } catch (err: any) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在提交…" : "提交举报"}
      </button>
    </Modal>
  );
}

function ComposerPanelGrid({ className, children }: { className: string; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollbar, setScrollbar] = useState({ top: 0, height: 100, visible: false });
  const syncScrollbar = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const visible = element.scrollHeight > element.clientHeight + 1;
    const height = visible ? Math.max(14, (element.clientHeight / element.scrollHeight) * 100) : 100;
    const progress = visible ? element.scrollTop / (element.scrollHeight - element.clientHeight) : 0;
    setScrollbar({ top: progress * (100 - height), height, visible });
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(syncScrollbar);
    const observer = new ResizeObserver(syncScrollbar);
    if (scrollRef.current) {
      observer.observe(scrollRef.current);
      if (scrollRef.current.firstElementChild) observer.observe(scrollRef.current.firstElementChild);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [children, syncScrollbar]);
  return (
    <div className="composer-grid-scroll-shell">
      <div className={className} ref={scrollRef} onScroll={syncScrollbar}>{children}</div>
      {scrollbar.visible && (
        <div className="composer-grid-scrollbar" aria-hidden="true">
          <i style={{ top: `${scrollbar.top}%`, height: `${scrollbar.height}%` }} />
        </div>
      )}
    </div>
  );
}

export function Composer({
  placeholder = "写下想说的话…",
  onSend,
  onImage,
  onSticker,
  mentionUsers = [],
  onRemoveMention,
}: {
  placeholder?: string;
  onSend: (text: string) => Promise<void>;
  onImage?: (file: File) => Promise<void>;
  onSticker?: (url: string) => Promise<void>;
  mentionUsers?: { id: string; name: string }[];
  onRemoveMention?: (id: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelClosing, setPanelClosing] = useState(false);
  const [panelTab, setPanelTab] = useState<"emoji" | "sticker">("emoji");
  const [emojiGroup, setEmojiGroup] = useState(0);
  const [stickers, setStickers] = useState<string[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const panelCloseTimer = useRef<number | null>(null);
  const mediaErrorTimer = useRef<number | null>(null);
  const closePanel = useCallback(() => {
    if (!panelOpen || panelClosing) return;
    setPanelClosing(true);
    if (panelCloseTimer.current) window.clearTimeout(panelCloseTimer.current);
    panelCloseTimer.current = window.setTimeout(() => {
      setPanelOpen(false);
      setPanelClosing(false);
      panelCloseTimer.current = null;
    }, 150);
  }, [panelOpen, panelClosing]);
  useEffect(() => () => {
    if (panelCloseTimer.current) window.clearTimeout(panelCloseTimer.current);
    if (mediaErrorTimer.current) window.clearTimeout(mediaErrorTimer.current);
  }, []);
  useEffect(() => () => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
  }, [pendingImage]);
  useEffect(() => {
    if (panelOpen && onSticker) api.stickers().then((data: any) => setStickers(Array.isArray(data) ? data : data?.stickers || [])).catch(() => setStickers([]));
  }, [panelOpen, onSticker]);
  function showMediaError(message: string) {
    if (mediaErrorTimer.current) window.clearTimeout(mediaErrorTimer.current);
    setMediaError(message);
    mediaErrorTimer.current = window.setTimeout(() => {
      setMediaError("");
      mediaErrorTimer.current = null;
    }, 5000);
  }
  function clearPendingImage() {
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage(null);
  }
  function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !onImage) return;
    setMediaError("");
    if (pendingImage) URL.revokeObjectURL(pendingImage.previewUrl);
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) });
    event.target.value = "";
  }
  async function send() {
    const value = text.trim();
    if ((!value && !pendingImage && !mentionUsers.length) || busy) return;
    closePanel();
    setBusy(true);
    try {
      if (pendingImage && onImage) {
        const image = pendingImage;
        try {
          await onImage(image.file);
          clearPendingImage();
        } catch (error: any) {
          showMediaError(error?.message || "图片发送失败，请稍后重试");
          return;
        }
      }
      if (value || mentionUsers.length) {
        const mentionPrefix = mentionUsers.map((item) => `@${item.name}`).join(" ");
        await onSend([mentionPrefix, value].filter(Boolean).join(" "));
      }
      setText("");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="composer-shell">
      {(panelOpen || panelClosing) && (
        <section className={cx("composer-panel", panelClosing && "closing")}>
          <div className="composer-panel-tabs">
            <button className={panelTab === "emoji" ? "active" : ""} onClick={() => setPanelTab("emoji")}>
              <Smile size={19} />
              Emoji
            </button>
            <button className={panelTab === "sticker" ? "active" : ""} onClick={() => setPanelTab("sticker")}>
              <Heart size={19} />
              表情包
            </button>
          </div>
          {panelTab === "emoji" ? (
            <>
              <div className="emoji-groups">
                {EMOJI_GROUPS.map((group, index) => (
                  <button className={emojiGroup === index ? "active" : ""} key={group.title} onClick={() => setEmojiGroup(index)}>
                    {group.title}
                  </button>
                ))}
              </div>
              <ComposerPanelGrid className="emoji-grid">
                {EMOJI_GROUPS[emojiGroup].emojis.map((emoji, index) => (
                  <button key={`${emoji}-${index}`} onClick={() => setText((value) => value + emoji)}>{emoji}</button>
                ))}
              </ComposerPanelGrid>
            </>
          ) : (
            <ComposerPanelGrid className="sticker-grid">
              {stickers.map((url) => (
                <button
                  key={url}
                  disabled={busy}
                  onClick={async () => {
                    if (!onSticker) return;
                    closePanel();
                    setBusy(true);
                    setMediaError("");
                    try { await onSticker(url); } finally { setBusy(false); }
                  }}
                >
                  <img src={url} alt="表情包" />
                </button>
              ))}
              {onSticker && (
                <label className="add-sticker">
                  <Plus size={23} />
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      setMediaError("");
                      try {
                        const uploaded = await uploadFile(file, "s");
                        await api.addSticker(uploaded.url);
                        setStickers(await api.stickers());
                      } catch (error: any) {
                        setMediaError(error?.message || "表情包添加失败，请稍后重试");
                      } finally {
                        setBusy(false);
                        event.target.value = "";
                      }
                    }}
                  />
                </label>
              )}
              {!stickers.length && <p>点击加号，从本地添加表情包</p>}
            </ComposerPanelGrid>
          )}
        </section>
      )}
      {pendingImage && (
        <div className="composer-pending-image">
          <img src={pendingImage.previewUrl} alt="待发送图片" />
          <button type="button" onClick={clearPendingImage} aria-label="移除待发送图片"><X size={14} /></button>
        </div>
      )}
      {mediaError && <p className="composer-error" role="alert">{mediaError}</p>}
      <div className={cx("composer", !onImage && "without-image", (panelOpen || panelClosing) && "panel-open")}>
        <button
          className={cx("attach", panelOpen && "active")}
          onClick={() => {
            if (panelOpen) {
              closePanel();
              return;
            }
            if (panelCloseTimer.current) window.clearTimeout(panelCloseTimer.current);
            panelCloseTimer.current = null;
            setPanelClosing(false);
            setPanelOpen(true);
          }}
          aria-label={panelOpen ? "关闭表情面板" : "打开表情面板"}
        >
          <Smile size={20} />
        </button>
        {onImage && (
          <label className="attach">
            <ImageIcon size={19} />
            <input type="file" accept="image/*" onChange={selectImage} />
          </label>
        )}
        <div className="composer-input-shell">
          {mentionUsers.map((mention) => <button
            type="button"
            className="composer-mention-token"
            key={mention.id}
            onClick={() => onRemoveMention?.(mention.id)}
            aria-label={`移除@${mention.name}`}
          >@{mention.name}</button>)}
          <textarea
            rows={1}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !text && mentionUsers.length) {
                onRemoveMention?.(mentionUsers.at(-1)!.id);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
        </div>
        <button disabled={busy || (!text.trim() && !pendingImage && !mentionUsers.length)} onClick={send}>
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
