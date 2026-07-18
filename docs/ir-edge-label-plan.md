# 方案：为推理链的边加上「AI 自由描述的关系标签」

## 1. 目标与「为什么」

真相图谱的推理链现在用文字树 + 箭头呈现,每条箭头旁标注两个节点的关系。
当前标签来自边的**结构关系类型**(`implies` / `depends_on` / `refines` /
`resolves` / `supersedes` / `contradicts`),前端把它们翻译成「依赖于 / 解答 /
细化自 / 推出自 / 取代 / 冲突」。

问题:这六种类型是**结构信号**(图谱靠它判断父子方向),表达力有限。很多关系
更复杂(例如「先合并 PR 才能触发」「只有在 A 成立时才依赖」),六个词说不全。

**根因**:关系的「结构方向」和「人类可读的描述」是两件事,被压在同一个字段里。

**结论**:不要动 `relation`(它决定父子方向,改了会破坏图结构),而是**新增一个
可空的自由文本字段 `label`**,由生成这条边的 AI 顺手写一句简短描述。前端优先显示
`label`,没有时回退到关系类型词。

> 前端已经改好:`IREdge.label` 已加进类型,推理链已经会「有 `label` 就显示 `label`,
> 否则显示关系类型词」。所以后端只需要「把 `label` 填进去」。

---

## 2. 改动清单(从数据库到 AI)

### 2.1 数据库迁移(新增一列)

`ir_edges` 加一个可空列 `label`。

- Drizzle schema:`lib/db/schema.ts` 的 `irEdge`(约 430–448 行),在 `relation`
  下加一行:

  ```ts
  relation: text("relation").notNull(),
  label: text("label"), // 可空:AI 写的自由关系描述
  ```

- 生成迁移:`pnpm drizzle-kit generate`(项目用 drizzle,配置见
  `drizzle.config.ts`),再 `pnpm db:migrate` / 走 `lib/db/migrate`。
- SQL 等价物(如果手写):
  `ALTER TABLE ir_edges ADD COLUMN label text;`
- **兼容性**:可空、无默认值,存量行为 `NULL` → 前端自动回退,零破坏。

### 2.2 读取路径(把 label 带到前端)

- `lib/ir/queries.ts` → `mapIREdge`(约 152 行):加
  `label: toNullableString(row.label),`
- 其余 `select` 若用 `select("*")` 则自动带上;若是显式列清单,记得加 `label`。
- `IREdge` 类型:**已完成**(`lib/ir/types.ts`,`label?: string | null`)。

### 2.3 写入路径(插入边时带上 label)

- `lib/ir/queries.ts` 的 `ir_edges` 插入(约 575–588 行),在 map 里加:
  ```ts
  label: relation.label ?? null,
  ```
- `IRRelationInput`(`lib/ir/types.ts` 约 99 行)加可选 `label?: string | null`。
- `lib/ir/api.ts` 的 `irRelationInputSchema` 加 `label: z.string().max(80).nullish()`,
  并在 `normalizeRelationInput` 里透传 `label`。

### 2.4 生成路径(让 AI 写 label)—— 核心

边在多处被创建,按优先级改**产生边的那几处**的 schema + prompt:

1. **Sweep 抽取(主要来源)** `lib/ir/sweep.ts`
   - `sweepRelationSchema`(约 44 行)加:
     `label: z.string().max(80).nullish(),`
   - 对应的抽取 prompt 里,要求模型对每条 relation 额外输出一个 `label`
     (见 §3 的写作规范)。
2. **内联标记** `lib/ir/inline-markers.ts`(约 19、170、295 行)
   - 若内联语法要支持自定义描述,扩展标记解析;否则这条路径先留空(回退关系词)。
3. **导入抽取** `lib/ir/import-extraction-prompt.ts` + `import-validation.ts`
   - 同样在 relation 结构里加 `label`,prompt 里要求输出。
4. **手动建边 API** `app/api/ir/edges/route.ts`
   - 允许调用方(或 UI)传 `label`;透传到插入。
5. **决策系统(旧路径,可选)** `lib/decision-extraction.ts` 的
   `suggested_edges[].type` 已是自由字符串;若这条链路仍在用,可把 `type` 兼作
   `label` 或另加 `label` 字段,并在 `lib/candidate-actions.ts` 的
   `applyConfirmedEdge` 里落库。

> 最小可用范围:只做 **§2.1 + §2.2 + §2.3 + §2.4 的第 1 项(sweep)**,就能让
> 新抽取的边带上 AI 描述;其余路径回退到关系类型词,不影响正确性。

---

## 3. label 的写作规范(给 prompt 的约束)

让 AI「自由发挥」但**受控**,写进 prompt:

- **视角**:从「子节点(结论)→ 父节点(前提)」方向描述,即「结论**如何**用到这个
  前提」。例:结论「上线成功」← 前提「PR 合并」,label = 「先合并 PR 才能触发」。
- **长度**:≤ ~12 个汉字 / ~6 个英文词。太长会撑破推理链的一行。硬上限
  `max(80)` 字符,并在 prompt 里要求「短语,别写整句」。
- **内容**:描述**关系本身**,不要重复节点标题;能具体就具体(条件、顺序、依赖强度)。
- **语言**:跟随节点语言(中/英),或跟随项目语言设置。
- **可空**:说不清就返回 `null`,前端回退到关系类型词——**宁缺毋滥**,别硬凑。
- **不改方向**:`relation` 仍必须是六种结构类型之一(决定父子方向);`label` 只是
  它的人类可读注释。二者一起输出。

Prompt 片段示例(并入现有抽取 prompt 的 relation 部分):

```
对每条关系,除给出 relation(结构类型)外,再给一个 label:
- 用一句 ≤12 字的短语,从结论回看前提,说明"结论怎样用到这个前提"。
- 只描述关系,不复述节点标题;能写出条件/顺序/依赖强度就写。
- 说不清就给 null。示例:
  { "to_node": "...", "relation": "depends_on", "label": "先合并 PR 才能触发" }
  { "to_node": "...", "relation": "resolves",   "label": "回答了阈值怎么定" }
```

---

## 4. 存量数据回填(可选,一次性)

新列对老边是 `NULL`(前端已回退,不做也能用)。若想让老边也有描述:

- 写一个一次性脚本(参考 `scripts/`),批量取每条边的两端节点标题 + relation,
  调模型按 §3 规范生成 label 回写。
- 建议**限流 + 幂等**(只填 `label IS NULL` 的行),避免整库重跑。

---

## 5. 验证与风险

- **迁移**:先在本地 / staging 的 Supabase 跑迁移,确认可空列加成功、无锁表风险
  (加可空列一般是元数据操作,很快)。
- **抽取质量**:label 是新输出,可能拉低抽取稳定性或变慢。建议:
  - 先只在 sweep 加,灰度观察;
  - 给 `label` 设 `nullish`,模型偷懒返回 null 也不报错;
  - 复用现有 eval(见 `lib/ir` 里的 quote-gate / extraction 测试)加一条:
    label 存在时长度 ≤ 上限、不等于任一端标题。
- **前端**:无需再改;`label` 一旦有值就自动显示,空则显示关系词。
- **回退**:任何一步没做,系统仍工作(回退到关系类型词)。可分步上线。

---

## 6. 建议的推进顺序

1. §2.1 迁移 + §2.2 读取 + §2.3 写入透传(纯管道,低风险)。
2. §2.4 第 1 项:sweep 的 schema + prompt(让新边开始带 label)。
3. 灰度观察抽取质量 → 再铺到 import / manual / inline 路径。
4. (可选)§4 回填老边。

> 前端(分支树 + 有 label 显示 label / 无则显示关系词)已经就绪,后端按上面顺序
> 逐步「把 label 填进去」即可,每一步都可独立上线、随时回退。
