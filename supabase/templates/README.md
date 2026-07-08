# ZENO 登录邮件 — Supabase 配置步骤

## 问题

登录 UI 走 6 位验证码（`signInWithOtp` → `verifyOtp(type: "email")`），但 Supabase
默认邮件模板只包含确认链接（`{{ .ConfirmationURL }}`），不包含 `{{ .Token }}`。
结果：用户等验证码，收到的却是 "Confirm your signup" 链接。

注意有**两个**模板在起作用：`signInWithOtp` 对**新用户**发送 "Confirm signup"
模板，对**老用户**发送 "Magic Link" 模板。两个都要改。

## 步骤（Supabase Dashboard）

### 1. 替换邮件模板（修验证码问题）

Dashboard → 项目 → **Authentication → Email Templates**：

- **Confirm signup**：Subject 改为 `{{ .Token }} — 你的 ZENO 登录验证码`，
  Body 整体替换为 `otp-login.html` 的内容。
- **Magic Link**：同样处理（同一份模板）。

### 2. 验证码有效期（与文案一致）

**Authentication → Providers → Email**：`Email OTP Expiration` 设为 `600`
（10 分钟，模板文案写的是 10 分钟）。

### 3. 发件人品牌（修 "Supabase Auth <noreply@mail.app.supabase.io>"）

内置发件人**无法改名**，且限速约每小时 2 封，只适合开发。生产必须配自定义 SMTP：

**Project Settings → Authentication → SMTP Settings** → Enable Custom SMTP：

- Sender name: `ZENO`
- Sender email: `login@<你的域名>`（域名需在 SMTP 服务商处完成 SPF/DKIM 验证）
- SMTP 服务商任选：Resend / Postmark / AWS SES 都有免费或低价档。

### 4. 验证

改完后走一遍登录：新邮箱 + 老邮箱各一次（覆盖两个模板），确认收到的都是
6 位验证码、发件人显示 ZENO。
