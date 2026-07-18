---
name: db-migration
description: >-
  ZENO 项目的 Drizzle 数据库 schema 变更与迁移流程。当需要修改数据库表结构、
  在 lib/db/schema.ts 中增删字段或表、生成或执行 migration、处理 drizzle-kit
  相关操作(db:generate / db:migrate / db:push)时使用。纯查询代码改动
  (queries.ts)不涉及 schema 变更时不需要本 skill。
---

# ZENO 数据库迁移流程

本项目用 Drizzle ORM + Postgres(Supabase)。schema 唯一来源是
`lib/db/schema.ts`,迁移文件在 `lib/db/migrations/`,连接串来自
`.env.local` 的 `POSTGRES_URL`。

## 标准流程

1. 只改 `lib/db/schema.ts`,**永远不要手写或手改 migrations/ 里的 SQL 文件**
   ——它们是 drizzle-kit 的生成产物,手改会导致 meta 快照与 SQL 不一致。
2. 运行 `pnpm db:generate` 生成迁移文件,检查生成的 SQL 是否符合预期
   (特别注意:drizzle 对列改名的判断可能生成 DROP + ADD,会丢数据)。
3. 运行 `pnpm db:migrate` 应用到数据库。
4. 如果改动涉及 `queries.ts` / `queries.supabase.ts` 中的查询,同步更新。

## 硬性约束

- **禁止 `db:push` 用于生产**:push 跳过迁移历史直接同步 schema,只允许本地
  快速原型时使用。默认一律走 generate → migrate。
- **迁移文件不可回改**:已提交的 migration 不修改,需要变更就生成新的。
- 生成的 SQL 若包含 `DROP COLUMN` / `DROP TABLE`,先停下来向用户确认,
  不要自行执行。
- `build` 脚本会先跑 migrate 再 build(见 package.json),所以迁移失败会
  阻断部署——迁移必须在本地验证通过后再提交。

## 排错

- 报 `POSTGRES_URL not defined`:检查 `.env.local` 是否存在且包含该变量,
  migrate.ts 在缺失时会静默跳过(exit 0),不要误以为迁移成功。
- 迁移状态与数据库不一致:用 `pnpm db:check` 检查迁移文件一致性,不要
  直接删 `meta/` 目录。
