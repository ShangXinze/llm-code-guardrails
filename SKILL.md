---
name: llm-code-guardrails
description: 为代码仓库建立"LLM 可遵守、且能被脚本强制"的开发规范，让 Agent 写出的代码可读、任务不偏移、沿计划逐项完成、充分验证，且全部模块做完后整体一致。当需要新建项目规范、给已有仓库补 AGENTS.md / CLAUDE.md 类规则、定项目宪法与路线图、拆分并跟踪开发任务、审核或升级现有 AI 协作规范、给已有上位治理体系（上级 AGENTS.md、外部决议登记表、扁平 docs 且不新开文档）的仓库只补可执行门禁而不建平行文档、或 LLM 写代码出现跑偏（改测试骗绿、越界改文件、顺手重构、忘记上下文、越做越野、模块越多越不像一个项目）时使用。支持 Node / Python / Go / Rust（含 clippy 阈值配方与 cargo workspace 命令）。关键词：AGENTS.md、CLAUDE.md、代码规范、项目宪法、constitution、roadmap、AI 协作规范、范围锁、scope lock、一致性审计、架构适应度函数、fitness function、逐项完成、任务漂移、上下文连续性、可读性、clippy、cargo workspace、spec-driven、TDD、vibe coding 治理。
agent_created: true
---

# 码矩（LLM 代码护栏 · 可执行版）

中文名：**码矩** —— 矩，规矩之矩。给 LLM 写代码立下能被执行的规矩。

## 用途

给一个代码仓库装上"LLM 能遵守、并且违规时会失败退出"的开发规范。五个目标各有对应的机制：

| 目标 | 机制 | 谁来强制 |
|---|---|---|
| **极强可读性** | 可自动检查的（嵌套/函数长度/复杂度/空词命名）落 lint；不可检查的写成对照示例 | lint + `consistency-audit` 的命名检查 |
| **不偏移** | 唯一计划源 `ROADMAP.md` + 范围白名单哨兵块 + 复述门禁 + 计划外事项必须留痕 | `scope-check.mjs` |
| **沿规划逐项完成** | 任务队列；一次只有一张任务卡；完成 → 评审 → 归档 → 再取下一个 | `consistency-audit` 的归档/证据检查 |
| **充分验证** | 红绿证据 + 分层验证（单步 fast / 收尾 full）+ 证据落盘 + DoD 清单 | `verify.*` 全量模式 |
| **整体一致性** | 项目宪法 + 跨模块契约 + 术语表 + 一致性审计（逐项清单见脚本输出，不在此复述） | `consistency-audit.mjs` |

核心判断：**规则能写成脚本的，就不要只写成文档。** 只写在 Markdown 里的约束对 LLM 是建议，不是约束。

## 何时使用

- 用户要"给项目立规矩 / 定代码规范 / 让 AI 写代码别乱来"。
- 用户要做多模块项目，担心"模块一多就不像一个项目"。
- 仓库已有 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules`，但形同虚设或只是一堆复制的文字。
- LLM 反复出现：改测试让测试变绿、改范围外文件、顺手重构、越做越偏、新会话重复问项目结构、跳着做任务。
- 用户提供了一套 AI 协作规范文档，要求审核或落地。

## 使用流程

### 步骤 1：判断场景

| 场景 | 做法 |
|---|---|
| 空仓库 / 新项目 | 走步骤 2 铺全套脚手架 |
| 已有仓库、无任何规则文件 | 同新项目，但先读目录结构与构建文件，再填 `ARCHITECTURE.md` |
| 已有 `AGENTS.md` 类文件 | **先读原文**，保留项目特有内容，只补门禁（scope-check + consistency-audit）并把量化规则迁到 lint |
| **已有上位治理体系** | 见下方专节 —— 只补门禁，不并行立宪 |
| 只想审核不落地 | 只做步骤 6 的检查，输出问题清单，不写任何文件 |

#### 场景：仓库已有上位治理体系

判断特征：仓库所在的工作区/上级目录已有 `AGENTS.md`、`CLAUDE.md`、决议登记表（ADR 或
"D-xx 只由某人登记"这类外部权威）、扁平 `docs/` + "变更追加进主文档变更表、不新开文档"的写侧纪律。

这类仓库**不要**铺全套脚手架：并行的 `AGENTS.md`/`CONSTITUTION.md`/`ROADMAP.md`/`docs/decisions/`
会变成第二个真相源，而这正是本套规范最反对的东西（两处定义必然漂移）。做法：

1. 用 `--minimal --verify=none` 只铺门禁与任务卡：
   `node scripts/init_repo.mjs <仓库> --stack=<栈> --minimal --verify=none`
2. **不新建决议目录**。`ARCHITECTURE.md` 的「关键决策」指向既有的决议源，并写明"新决议按既有渠道登记"。
3. **模块文档合并成一份**。仓库若禁止为每个模块新建 md，就把它们放进一份聚合文档
   （每个模块一个 `## <模块ID> <名字>` 块），注册表 `doc` 列全部指向它 ——
   审计按模块 ID 限定小节作用域，不会串味（配方见 `references/planning-and-consistency.md`）。
4. **契约指向既有权威文档**，不要为 `docs/contracts/` 再造一份。
5. 既有验证入口（`scripts/check.sh`、`Makefile`、`justfile`）用**包装**而不是新开 `verify.sh`：
   门禁命令接进去，`--report` 用于日常、判失败用于收尾与 pre-push。
   证据日志从既有入口落盘（`var/verify-<时间戳>.log`），否则 `verify-evidence` 会持续报错。

> 这类仓库第一天就要处理"既存未提交改动"：门禁比较的是 `git status`，工作区里别人的在制改动
> 会被算作越界。先把它们提交/收口，或在基线任务卡的白名单里如实登记，并在「未决问题」写清
> 这段期间白名单的保护是打折的。

### 步骤 2：铺脚手架

```bash
node scripts/init_repo.mjs <目标目录> --name="<项目名>" --stack=node|python|go|rust \
     [--level=full|scope-only|lint-only|minimal] [--minimal] \
     [--verify=new|none] [--force] [--dry-run] \
     [--taskdir=docs/任务归档] [--roadmap=<计划源文件>] [--evidence=<日志目录>]
```

- 默认**不覆盖**已存在的文件，只列出 skipped；确认要覆盖才加 `--force`。
- `--stack` 决定 `verify` 的四条命令与前置检查的清单文件。栈不在表里用 `--stack=custom`，再手工填 `scripts/verify.*` 顶部的四个命令变量。
- **`--level` 档位**（路径与小节名的唯一声明源是目标仓库的 `.guardrails.json`）：
  | 档位 | 铺什么 | 何时用 |
  |---|---|---|
  | `full`（默认） | 规则文档 + 门禁 + 审计 + doctor + verify | 多模块正式开发 |
  | `scope-only` | 门禁 + TASK + prompts + ROADMAP 骨架；不铺宪法/契约 | 探索期或已有计划源 |
  | `lint-only` | 仅 `.guardrails.json` + `.gitignore` | 只想先配 lint |
  | `minimal` | 门禁 + TASK + prompts（旧 `--minimal`） | 已有上位治理体系 |
- **`--taskdir` / `--roadmap` / `--evidence` 写入 `.guardrails.json`**（单一来源）。
  仓库已有自己的目录名时**必须用它**。`scope-check` / `consistency-audit` / `verify.*` / `doctor`
  都读这份配置；CLI 参数只作临时覆盖。配置缺失时回退默认路径，但会打印 `配置=default`。
- `--verify=none` 不铺 `scripts/verify.sh|ps1`，改为把门禁接进既有验证入口 ——
  目标仓库已有验证入口时**必须**用它：两条验证路径必然漂移，最后没人知道哪条才算数。
- 铺完先跑 `node scripts/doctor.mjs`：只读体检，打印生效配置与路径，比直接跑审计更容易看出「路径没对上」。
- Rust 仓库注意：workspace 项目里 `cargo clippy`/`cargo test` 必须带 `--workspace`（否则只检查当前目录那一个 crate，
  其余静默漏检且输出看着是全绿）；`--stack=rust` 填的已经是带 `--workspace --all-targets` 的版本。
- 先 `--dry-run` 给用户看将创建哪些文件，再实跑。

### 步骤 3：一次性定"宪法 + 路线图"（必须人类签字）

这两件事是整个体系的地基，**不要替用户编**：

1. `CONSTITUTION.md`：逐条过一遍，让用户确认可读性阈值、依赖方向、DoD 是否接受。
2. `ROADMAP.md`：填模块注册表（`id | 路径 | 文档 | 状态 | 依赖`）与任务队列。
   依赖关系决定开发顺序；每个任务要能在一次会话内做完并有独立可验证的产出。
3. `ARCHITECTURE.md`：读代码后填真实情况，不要照抄模板示例。
4. `TASK.md`：把队首任务复制成一张任务卡，填 AC（每条可判定）、`SCOPE:` 白名单、分步计划。

> 白名单为空时任何改动都算越界（刻意 fail-closed）。
> 单模块项目可以只留一个模块条目，但不要省掉 ROADMAP —— 它是防偏移的锚。

### 步骤 4：逐项开发循环（每个任务重复）

```
取 ROADMAP 队首 → 生成 TASK.md → 复述并等确认 → 红→绿→重构
   → 两阶段评审（先规格、后质量）→ verify --full → 归档 → 更新 ROADMAP → 下一个
```

给用户的指令模板（见 `references/tool-integration.md`）：

- 开工：`请按 .agents/prompts/start.md 执行。当前任务见 TASK.md。`
- 继续：`请按 .agents/prompts/continue.md 继续。`
- 收尾：`请按 .agents/prompts/finish.md 收尾。`

### 步骤 5：模块与项目收尾

- 模块名下任务全 `done` → 跑该模块的端到端路径 → 更新模块文档核验日期 → 模块标 `done`。
- 全部模块 `done` → 逐项执行 `ROADMAP.md` 的「里程碑验收」清单（含端到端主流程、契约与实现对应、
  术语一致性抽查）。这一步不做，整体一致性就只能靠运气。

### 步骤 6：验证门禁真的能拦住

```bash
node scripts/doctor.mjs                          # 只读体检：配置、路径、自测、git
node --test scripts/scope-check.test.mjs         # 期望全部 passed / 0 failed（无 git 时 2 条 skip）
node --test scripts/consistency-audit.test.mjs   # 期望全部 passed / 0 failed
node scripts/scope-check.mjs TASK.md             # 期望 exit 0
node scripts/consistency-audit.mjs --report      # 项目初期先看报告，不判失败
```

**路径以 `.guardrails.json` 为唯一声明源。** 审计与 doctor 输出的
`配置=config … 计划源=… 归档=… 证据=…` 就是实际生效值，结论可疑时先核对这一行。

无 git 或想在不改仓库的情况下试：`SCOPE_FILES="a.ts,b.ts" node scripts/scope-check.mjs`。
**不要跳过这一步。** 未经自测的护栏等于没有护栏。项目初期用 `--report`，等结构稳定再让 `--full` 判失败。
跑完自测，**还要故意违规一次**验证门禁真的能拦住（临时加一个白名单外的改动、改一处文档与代码不符），
确认 exit code 真的变了 —— "看着能拦住"和"能拦住"是两件事。

## 必须遵守的行为规则（使用本 skill 时对自身生效）

1. 改目标仓库前，先读 `AGENTS.md`、`CONSTITUTION.md`、`ROADMAP.md`（当前模块部分）、`TASK.md`、当前模块 README，
   并复述：目标 / 非目标 / 验收 / 允许修改 / 禁止修改 / 计划文件。
2. 一次只做一张任务卡；只写白名单内的文件；要越界就停下写「范围变更请求」，不自行扩权。
3. 计划外的发现一律记入「未决问题」，**不顺手做**。
4. 任务不明确时用 recon 模式（只读 + 只写 `docs/notes/`），不要为了过门禁而编造范围。
5. 行为变化必须有红 → 绿证据；不得修改、删除、跳过测试让验证变绿。
6. 收尾必须跑全量 `verify` + 一致性审计并输出报告；不得放宽审计规则让检查通过。
7. 不要替用户决定宪法条款和模块拆分 —— 这两件事必须人类确认。

## 参考文件

- `references/readability.md` —— 可读性配方：lint 配置（eslint / ruff / golangci-lint / clippy+rustfmt）+ 差→好代码对照 + 命名与注释惯例。
- `references/verification.md` —— 充分验证配方：AC↔命令映射、红绿证据、分层验证、边界与失败路径、证据留档、失败处置。
- `references/rules-task.md` —— **填写 `TASK.md` 时先读它**：验收标准怎么写才可判定、白名单怎么划、进度日志的规矩。
- `references/planning-and-consistency.md` —— 逐项完成流程与三层一致性机制、一致性审计各项检查说明、何时该改计划。
- `references/tool-integration.md` —— 接入 ZCode / Claude Code / Codex / Cursor / Copilot，三段指令怎么发，已有验证入口怎么接。
- `references/design-rationale.md` —— **要删规则前先读它**：每条规则拦住的真实失效、借鉴来源、已知局限。
- `CHANGELOG.md` —— **来自真实使用的修改记录与待办**：某仓库踩到的症状 → 改法。
  每隔一段时间读一遍；收尾时若撞到规则/模板/脚本自身的毛病，追加一条（`finish.md` 第 9 步会问）。
- `assets/templates/` —— 直接铺进目标仓库的脚手架，由 `init_repo.mjs` 复制并替换占位符（不需要读入上下文）。

## 安装与副本

把本目录放到宿主的**技能搜索路径**下，目录名 `llm-code-guardrails` 即技能 ID。常见约定：

- 用户级（所有项目共用）：`~/.agents/skills/<name>/`
- 项目级（随仓库共享）：`<repo>/.agents/skills/<name>/`

**同名技能以路径为身份**：高优先级路径会遮蔽低优先级，不会报错。同一台机器上不要留两份都想生效的副本。
若宿主另有技能目录，部署副本与本仓库要保持逻辑一致，改完记得同步，避免两边行为分叉。
