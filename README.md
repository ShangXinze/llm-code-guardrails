# 码矩 · llm-code-guardrails

给 LLM 写代码立下**能被执行**的规矩：范围锁死、任务不漂、证据落地，模块写完之后仍像同一个项目。

> 核心判断：**规则能写成脚本的，就不要只写成文档。** 只写在 Markdown 里的约束对 LLM 是建议，不是约束。

## 能拦住什么

| 失效 | 机制 |
|---|---|
| 顺手改范围外文件 | `scope-check.mjs` 与 `git status` 做白名单差集 |
| 改测试骗绿 | 禁止 + 显式申报；收尾全量验证 |
| 任务漂移 / 跳任务 | 唯一计划源 `ROADMAP.md` + 单活跃 `TASK.md` |
| 完成无痕迹 | 归档任务卡 + `verify` 证据日志 |
| 模块多了不像一个项目 | 项目宪法 + `consistency-audit.mjs` |

## 快速开始

```bash
# 克隆到本地任意目录后
node scripts/init_repo.mjs ./my-repo \
  --name="my-repo" --stack=node --dry-run

# 实装（默认 full；可选 scope-only / lint-only / minimal）
node scripts/init_repo.mjs ./my-repo \
  --name="my-repo" --stack=node

# 只读体检
node ./my-repo/scripts/doctor.mjs
```

支持栈：`node` / `python` / `go` / `rust`（Rust workspace 已带 `--workspace --all-targets`）。

## 目录

```
SKILL.md                 # 技能说明与使用流程
scripts/init_repo.mjs    # 脚手架
assets/templates/        # 铺进目标仓库的模板与门禁脚本
references/              # 可读性 / 验证 / 任务卡 / 一致性 / 设计依据
CHANGELOG.md             # 真实使用回流的修改记录
```

安装到 Agent 技能目录时，把整个仓库（或 `SKILL.md` 所在目录）放到例如
`~/.agents/skills/llm-code-guardrails/`，目录名即技能 ID。

## 文档地图

- `SKILL.md` — 何时用、怎么铺、怎么跑循环
- `references/design-rationale.md` — 删规则前先读：每条拦住什么失效
- `references/rules-task.md` — 怎么写一张可执行的任务卡
- `references/verification.md` — 红绿证据与分层验证

## 许可

请按你的分发需要自行补充 LICENSE。本仓库内容为方法论与脚本模板，使用前请在目标仓库做门禁自测（`node --test scripts/*.test.mjs`）。
