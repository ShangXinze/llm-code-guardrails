# ROADMAP.md — {{PROJECT}}

> 本文件是**唯一的计划源**：做什么、按什么顺序做、做到哪了，都只在这里看。
> 开工前先看它，收工后更新它。计划变更也要改它，而不是在对话里默默改主意。

## 使用规则

- 状态只允许：`todo` / `doing` / `done` / `blocked` / `dropped`。
- 同一时间只有一个模块是 `doing`，同一时间只有一张任务卡（`TASK.md`）在跑。
- 任务从「任务队列」队首取；上一个任务未 `done` 不得开始下一个。
- 模块 `done` 的条件见 `CONSTITUTION.md` 第七条。
- 模块 ID 一旦分配不再复用；任务 ID 格式 `<模块ID>-<序号>`（如 `M2-3`）。

## 模块注册表

> 下面这个块由 `scripts/consistency-audit.mjs` 解析，字段固定：`id | 代码路径 | 模块文档 | 状态 | 依赖模块`。
> 依赖写模块 ID，多个用逗号分隔，没有依赖写 `-`。改了代码路径或依赖，必须同步这里。

<!-- MODULES:BEGIN
M0 | src/ | docs/modules/m0-skeleton.md | todo | -
MODULES:END -->

## 阶段与顺序

- 阶段 0：地基（目录骨架、共享工具、错误与日志约定、验证脚本可用）
- 阶段 1：（填）
- 阶段 2：（填）

依赖关系决定顺序：先做被依赖的模块；同一层的模块可以并行，但同一人手上仍只跑一个任务。

## 任务队列

> 每个任务要求：能在一次会话内做完、有独立可验证的产出、有明确的验收命令。

| 任务 | 所属模块 | 依赖 | 状态 | 产出文件 | 验收命令 | 归档 |
|---|---|---|---|---|---|---|
| M0-1 | M0 | - | todo | `src/shared/`、`docs/contracts/errors.md` | `scripts/verify.ps1 --fast` | `{{TASKS_REL}}/` |

## 里程碑验收（全部模块 done 后执行）

- [ ] 全局 `scripts/verify.* --full` 全绿
- [ ] `scripts/verify.* --full` 里的一致性审计无 error（**路径参数与归档目录一致**，见 `verify.*` 顶部）
- [ ] `node --test scripts/scope-check.test.mjs` 11 passed
- [ ] `node --test scripts/consistency-audit.test.mjs` 26 passed
      （这两条是变化探测器：数字掉了说明有人删了用例。加了用例就同步改这里。）
- [ ] 端到端主流程跑通（命令：待填）
- [ ] 契约与代码一致：`docs/contracts/` 中每个契约都有对应实现与使用方
- [ ] 每个模块文档的「最后核验日期」已更新到本轮
- [ ] `{{TASKS_REL}}/` 中每个模块都有归档任务卡
- [ ] 无 `blocked` 任务、无未决阻断项
- [ ] 术语表与代码命名一致（抽查 10 个概念）
