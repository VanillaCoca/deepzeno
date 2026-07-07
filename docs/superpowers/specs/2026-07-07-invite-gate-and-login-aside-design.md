# 登录邀请码门槛 + 右侧艺术面板 — 设计稿

日期：2026-07-07
状态：已确认，待实现计划

## 背景与目标

Zeno 目前登录页（`app/(auth)`）提供 **Google OAuth** 与 **邮箱一次性验证码（Supabase OTP）** 两种登录方式，右侧为 `<Preview />` 假聊天预览，顶部显示 "Powered by Vercel AI Gateway"。

两个目标：

1. **邀请码门槛**：用户必须先输入正确的邀请码，才能使用任一登录方式。UI 简洁优雅，用恰到好处的（极少）文字让人明白"先过邀请码才能登录"。
2. **右侧改造**：移除 "Powered by Vercel" 与假预览，换成符合 Zeno 气质的、更具艺术性的展示面板。

## 确定的决策

| 项 | 决策 |
| --- | --- |
| 邀请码机制 | 单一共享码，**服务端校验** + httpOnly cookie |
| 邀请码值 | `898989`（放入环境变量 `INVITE_CODES`，逗号分隔可支持多码） |
| 登录方式 | 保持 Google + 邮箱验证码，邀请码作前置门槛 |
| 登录按钮未解锁态 | **变暗 + 锁定**（可见但不可点），而非隐藏 |
| 右侧面板 | **A + B 组合**：上方一句 tagline + 下方"决策星座"图 |
| tagline 默认文案 | "把对话，凝成判断。"（可后续调整，非阻塞） |

## Part 1 — 邀请码门槛

### 交互流程（门在前，近乎零文字）

- 卡片标题保留 `Welcome to ZENO`；副标题换成极简 invite-only 提示：一枚小徽章 `Invite only` + 一行"输入邀请码以继续"。
- 首屏结构（未解锁）：
  1. **邀请码输入框在最上方**（视觉主角，带提交/回车）。
  2. 下方 Google 按钮 + 邮箱表单处于**变暗、不可交互**状态，带一枚极小的锁图标 —— 让人一眼看出"登录方式存在，但被邀请码挡着"。
- 输入正确邀请码并校验通过后：
  - 邀请码行收起为一条 `✓ 邀请码已验证` 的淡提示。
  - 下方登录方式**平滑点亮**（去掉变暗与锁），可正常使用。
- 邀请码错误：输入框下方给一句极短错误提示（如"邀请码不正确"），不弹大段文字。

### 服务端机制

- **环境变量** `INVITE_CODES`：逗号分隔的共享邀请码列表（本期值为 `898989`）。缺省未配置时视为"未开启门槛"（开发/回退友好）——见下方"未配置行为"。
- **签发 cookie 的密钥**：`INVITE_SECRET`，缺省回退到 `SUPABASE_SERVICE_ROLE_KEY`（服务端始终存在）。仅用于对 cookie 做 HMAC 签名，使前端无法伪造。
- **新增路由 `POST /api/invite/verify`**
  - 入参：`{ code: string }`。
  - 校验：`code.trim()` 后与 `INVITE_CODES` 中各项做**忽略大小写、常量时间**比较。
  - 成功：种 cookie `zeno_invite`，值 = `HMAC_SHA256(key = INVITE_SECRET, msg = "zeno-invite:v1")` 的 base64url；属性 `httpOnly`、`secure`（生产）、`sameSite=lax`、`path=/`、`maxAge` 约 30 天。返回 `{ ok: true }`。
  - 失败：返回 `401 { ok: false }`，不种 cookie。
- **服务端强制点（改前端绕不过）**
  - **Google**：`app/(auth)/auth/callback/route.ts` 在 `exchangeCodeForSession` 之前校验 `zeno_invite` cookie 是否等于期望 HMAC；不合法则重定向 `/login?error=invite`，不建立会话。
  - **邮箱验证码**：把"发码"从客户端直接调用改为走**新增路由 `POST /api/invite/otp`**；该路由先校验 `zeno_invite` cookie，再用 Supabase 服务端客户端发送 OTP。未过邀请码则根本收不到验证码。验证码的核对（`verifyOtp`）仍可留在客户端——因为无邀请码时压根拿不到码。
- **换码**：修改 `INVITE_CODES` 环境变量并重部署即可，零代码改动。

### 未配置行为

- 当 `INVITE_CODES` 为空/未设置时：`/api/invite/verify` 直接返回成功并种 cookie（相当于门槛关闭），`callback` 与 `otp` 路由放行。这样本地开发或临时关闭门槛时无需改代码。生产环境务必配置 `INVITE_CODES`。

### 客户端改动（`components/auth/login-form.tsx`）

- 新增 `unlocked` 状态。**初值由服务端决定**：`app/(auth)/login/page.tsx` 是服务端组件，读取 `zeno_invite` cookie 并校验其 HMAC，把结果作为 `initiallyUnlocked: boolean` 传给 `LoginForm`；这样已验证过邀请码的用户刷新后不必重输。
- 顶部渲染邀请码输入 + 提交；提交调用 `/api/invite/verify`，成功后本地置 `unlocked = true`。
- Google 按钮与邮箱表单在 `!unlocked` 时 `disabled` + 变暗 + 锁标；解锁后恢复。
- 邮箱"发码"改为请求 `/api/invite/otp`（而非直接 `supabase.auth.signInWithOtp`）。

## Part 2 — 右侧艺术面板（A + B）

### 移除

- `app/(auth)/layout.tsx` 中的 "Powered by / Vercel / AI Gateway" 整行。
- 右侧的 `<Preview />` 假聊天预览（`components/chat/preview.tsx` 保留文件，仅在登录布局不再引用；如别处未用可后续清理，不在本期范围）。

### 新增 `components/auth/auth-aside.tsx`

- 满高、灰阶、随明暗主题自适应（用 `--foreground` / `--background` 等 token，不写死颜色）。
- **上方**：一句极简 tagline（默认"把对话，凝成判断。"）+ 极小的 ZENO 字标（复用 `ZenoLogo` 或纯文字）。
- **主体**：**决策星座**图 —— 节点 + 连线组成、向上生长的抽象图；**实心节点 = 已确认真相**，**空心节点 = 候选**。纯内联 SVG。
- **动效**：极轻微的呼吸/渐入（节点淡入、连线缓慢生长），必须遵守 `prefers-reduced-motion: reduce`（关闭动画，回退到静态）。
- 移动端（<xl）右侧本就 `hidden`，行为不变；面板只在 `xl` 及以上出现。

### 布局接线（`app/(auth)/layout.tsx`）

- 右侧容器保留 `hidden xl:flex flex-1`，把内部内容整体替换为 `<AuthAside />`。
- 左侧登录列不变。

## 组件边界

- `AuthAside`：纯展示，无 props（或仅可选 `tagline`）；不依赖登录状态；可独立预览与测试。
- `/api/invite/verify`、`/api/invite/otp`：无状态服务端路由，各自单一职责（验码/发码），只依赖环境变量与 Supabase 服务端客户端。
- `login-form.tsx`：新增邀请码门为其内部状态机的前置一步，不改动已有 OTP/OAuth 逻辑的成功路径。

## 涉及文件

- `app/(auth)/login/page.tsx` — 副标题文案改为 invite-only；服务端读取 `zeno_invite` cookie 并把 `initiallyUnlocked` 传给 `LoginForm`。
- `components/auth/login-form.tsx` — 邀请码门 + 锁定态 + 邮箱改走服务端发码。
- `app/(auth)/auth/callback/route.ts` — OAuth 回调加 cookie 校验。
- `app/api/invite/verify/route.ts` — 新增，校验邀请码 + 种 cookie。
- `app/api/invite/otp/route.ts` — 新增，验 cookie 后发送邮箱 OTP。
- `lib/auth/invite.ts`（新增，可选）— 共享的邀请码/HMAC 工具（读取 `INVITE_CODES`、计算/校验 cookie 值），供 verify、otp、callback 复用。
- `app/(auth)/layout.tsx` — 移除 Powered by + 换成 `<AuthAside />`。
- `components/auth/auth-aside.tsx` — 新增右侧面板。
- `.env.example` — 加 `INVITE_CODES=` 与 `INVITE_SECRET=` 说明；`.env.local` 设 `INVITE_CODES=898989`（并需同步到 Vercel）。

## 非目标（YAGNI）

- 不做邀请码的数据库表、单次使用、发放/追踪。
- 不新增百度或其它 OAuth provider。
- 不改动登录成功后的会话与工作区逻辑。
- 不清理别处可能仍引用 `Preview` 的代码（除非确认无引用）。

## 验证要点

- 未输入/错误邀请码：登录按钮锁定；直接调用 Supabase（绕过前端）走 OAuth 时，回调因缺 cookie 被拒。
- 正确邀请码 `898989`：解锁 → Google 与邮箱两条路径均可登录成功。
- 明暗主题切换：右侧面板颜色随之自适应。
- `prefers-reduced-motion`：动画关闭。
- 移动端：右侧面板隐藏，登录流程正常。
