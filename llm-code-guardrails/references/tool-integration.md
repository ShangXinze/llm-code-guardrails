# 接入宿主工具 & 日常怎么发指令

## 一、把"最高规则"放进宿主

原则：**引用，不要复制**。复制一份规则就等于埋下一个漂移源。

| 工具 | 落点 | 写法 |
|---|---|---|
| ZCode | 项目根 `AGENTS.md` | 已就位即可；技能装在 `~/.agents/skills/`（通用）或 `<项目>/.agents/skills/`（随仓库共享） |
| Claude Code | 项目根 `CLAUDE.md` | 写 `@AGENTS.md`（导入语法）或一行"本仓库规则以 AGENTS.md 为准，每轮先读它" |
| Codex / 通用 Agent | 根目录 `AGENTS.md` | 已就位，无需额外配置 |
| Cursor | `.cursor/rules/agents.mdc` | frontmatter 后写一行指向 `AGENTS.md` |
| GitHub Copilot | `.github/copilot-instructions.md` | 同上 |
| 其他 Agent 宿主 | 项目内 `AGENTS.md` | 已就位；对话开头显式说"按 `.agents/prompts/start.md` 执行" |

**注意"同一规则两份文件"的陷阱**：`CLAUDE.md` 与 `AGENTS.md` 各写一份规则时，
两份必然漂移，冲突时 Agent 会挑对自己有利的那份遵守。所以选一份做正本，
另一份只留一行指针（`@AGENTS.md` 或"以 AGENTS.md 为准"）—— 落地过程中最常见的返工就是这里。

任何情况下都建议把 `AGENTS.md` §0 的**最小内联块**贴进系统提示 / 项目规则：
系统提示不会被上下文压缩挤掉，而文件会被。这是防"规则在长任务里失效"的唯一办法。

## 二、三段指令怎么发

### 开始一个任务

```
请按 .agents/prompts/start.md 执行。
当前任务见 TASK.md。
```

不要只说"帮我改一下 X" —— 没有范围、没有验收，门禁就无从执行。

### 继续

```
请按 .agents/prompts/continue.md 继续。
```

### 收尾

```
请按 .agents/prompts/finish.md 收尾。
```

## 三、人类这边要守的三件事

1. **先写 `TASK.md` 再发指令**：目标、非目标、验收标准（可判定）、`SCOPE:` 白名单。
   验收标准写不出可判定形式，说明任务本身还没想清楚 —— 这时应该走 recon 模式。
2. **复述块没出现就不让它改代码**。看到复述不对（比如白名单被放大、非目标被删）就当场纠正。
3. **验收看三样**：`TASK.md` 的进度日志、`git diff`、`var/verify-<时间戳>.log`。
   只看模型自己的总结等于没验证。

## 四、并发与分工

`TASK.md` 是单写入者文件。多人 / 多 Agent 并行时必须二选一：

- 按模块拆：每个并行任务一个 `docs/tasks/<编号>-<主题>.md`，`TASK.md` 只做索引（谁在改哪个模块）；
- 或者一人一分支，`TASK.md` 随分支走，合并时人工对齐。

不要让两个 Agent 同时改同一个 `TASK.md` —— 冲突会放大成范围失控。

## 五、与技能/自动化脚本共存

若仓库已有自己的 skill / 脚本体系（如自定义 CLI），把它们的入口写进 `ARCHITECTURE.md` §7，
并把验证命令统一收进 `scripts/verify.*`。**不要新增第二条验证路径** —— 两条路径必然漂移，
最终没人知道哪条才算数。

### 目标仓库已有验证入口时：包装，不要复制

`scripts/check.sh`、`Makefile`、`justfile`、`npm run gate` 都算已有入口。
这时用 `init_repo.mjs --minimal --verify=none`（或 `--level=scope-only`），**不要**再铺一个 `scripts/verify.sh`。
接法是把两条门禁插到既有入口的最前面（顺序理由：范围不对，后面跑再多测试也没意义）：

```bash
# 既有入口里加这两段（fast 模式用 --report，收尾/pre-push 用判失败）
# 路径以 .guardrails.json 为唯一声明源，脚本自动读取，无需每次手写 --tasks
node scripts/scope-check.mjs TASK.md
node scripts/consistency-audit.mjs --report
```

两个容易漏的点：

1. **证据日志要从既有入口落盘**（配置里的 `evidence` 目录，默认 `var/verify-<时间戳>.log`）——
   `verify-evidence` 检查的是这个文件是否存在，只把门禁接进去而日志仍散在终端输出里，
   审计会一直说"完成没有证据"。
2. **别把门禁写成"有 node 才跑"**。缺 node 就退出、并打印安装提示；
   静默跳过的门禁比没有门禁更糟（它让人以为检查过了）。
3. **改目录名只改 `.guardrails.json`**。`init_repo --taskdir/--roadmap/--evidence` 写入这份配置；
   审计、doctor、verify 都读它。CLI 的 `--tasks` 等仅作临时覆盖，不要当成第二处声明。
