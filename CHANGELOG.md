# 变更记录（用出来的坑）

本文件记录**来自真实使用**的修改：症状 → 改法。不写设计推演（那是 `references/design-rationale.md` 的地盘）。
收尾时问一句：有没有撞到规则 / 模板 / 门禁脚本自身的毛病？有就追加一条。

```
## <日期> <一句话标题>
- 症状：谁在什么场景下看到什么（要能复现）
- 改法：改了哪个文件、改成什么
- 来源：<场景简述>
```

---

## 2026-09-17 verify 证据日志仍写死 var/（P0）

- 症状：`.guardrails.json` 的 `evidence` 已传给 audit，但 `verify.sh|ps1` 仍创建 `var/` 并把
  日志写成 `var/verify-*.log`。自定义 evidence 时审计找配置目录、verify 写 `var/`，证据检查会假失败或漏检。
- 改法：日志目录改为 `$EVIDENCE_REL`（与 audit 同一路径），ps1 用 `Join-Path`。
- 来源：外部评审指出的配置单点未闭合

## 2026-09-17 配置单点 + doctor + init 档位（阶段 1）

- 症状：路径仍靠 `verify.*` 变量 + 手工 CLI 三参数，假错误风险未根除；新仓库冷启动过重；
  英文/自定义文档小节名写死在审计里；自测数字写死进文档会腐化。
- 改法：① 新增 `.guardrails.json` 与 `scripts/guardrails-config.mjs`，
  `scope-check` / `consistency-audit` / `verify.*` / `doctor` 统一读配置，CLI 只覆盖；
  ② 新增 `scripts/doctor.mjs`（只读体检）及自测；③ `init_repo --level=full|scope-only|lint-only|minimal`
  （`--minimal` 仍兼容）；④ 审计 `docSections` 可配置；⑤ scope-check 的 git 集成用例在无 git 时 skip。
- 来源：配置单点与 doctor 落地

## 2026-09-16 归档目录改名后门禁假红（P0）

- 症状：仓库把归档目录本地化成 `docs/任务归档/` 后，全量门禁报
  「已标 done，但 `docs/tasks/` 下找不到归档任务卡」。
  真实原因是 `verify.*` 调审计时不传路径参数，审计用的是模板默认 `docs/tasks`。
  危险性在于它**看起来像「真缺卡片」**，最容易把人推向造假卡片或放宽审计规则。
- 改法：路径写入 `.guardrails.json`（或 verify 顶部变量）作为单一来源；审计在归档目录不存在
  时打印诊断与候选目录，判定仍 fail-closed。
- 来源：多模块仓库启用本地化目录名

## 2026-09-16 DENY 优先于 CREATE，白名单可写出「死信」（P0）

- 症状：卡面 `SCOPE:DENY` 写了整目录 `docs/`、`SCOPE:CREATE` 写了 `docs/任务归档/`，
  归档卡一落盘就被判禁止修改。判定顺序是 DENY 优先，CREATE 项是死信。
- 改法：`scope-check.mjs` 在 DENY 目录覆盖 CREATE/MODIFY 时打印死信警告（判定不变）；
  glob 项不参与目录重叠误报；`rules-task.md` 补差→好写法对照。
- 来源：中文目录名仓库的白名单填写错误

## 2026-09-16 clippy 配方自相矛盾 + 复杂度计数口径（P1）

- 症状：示例里写 `unwrap_used = "warn"`，同页又说明 `--deny warnings` 会把新加 warn 变失败。
  `cognitive_complexity` 不累加嵌套层级，不能当嵌套检查用。
- 改法：示例改为「先量到 0 再写进来」；补计数口径与「先测量」步骤。
- 来源：Rust workspace 启用 workspace lints

## 2026-09-16 缺四类配方：重构证据、取数口径、共享工作区、子代理（P1）

- 症状：纯重构没有「红」可看；卡面记数不带命令口径导致任务拆错；
  `pkill -f` 误杀他人长时验证进程；一张卡内并行子代理与「一次一张卡」易被读成冲突。
- 改法：`verification.md` 增等价性证据与数字口径；AGENTS 模板增共享工作区纪律与子代理约束；
  `rules-task.md` / `TASK.md` 模板同步。
- 来源：多子代理并行重构 + 共享开发机

## 2026-09-16 脚手架不铺 .gitignore，第一次 verify 就红（P0）

- 症状：`verify` 自己落盘 `var/` 证据日志，范围锁把这个新目录判成越界。
- 改法：模板增加 `.gitignore` 忽略证据目录。
- 来源：新仓库首次全量验证

## 2026-09-16 流程偏差无处记录（P2）

- 症状：复述块晚于代码改动等偏差只能塞进「风险」，容易被读成事后补记。
- 改法：`TASK.md` 增「流程偏差申报」；`finish.md` 收尾追问一步。
- 来源：长任务卡收口

## 2026-09-16 缺少回流机制（P2）

- 症状：技能在真实仓库连续使用后，修补只留在仓库侧，技能本体无变更记录。
- 改法：新增本文件；`finish.md` 增收尾必问。
- 来源：长周期使用收口

## 2026-09-16 工作树放 /tmp 会撑爆 tmpfs（P1）

- 症状：并发隔离时把 git 工作树建在 `/tmp`，构建产物写满 tmpfs，测试以
  `No space left on device` 失败，门禁报红却像代码问题。
- 改法：AGENTS 模板规定工作树/构建目录放仓库同盘，不要放小 tmpfs。
- 来源：共享机器并发开发

## 待办（本轮没做，别假装完整）

- 测试诚信检查（新增 skip/only/无 ID allow 且未申报）仍未落地。
- pre-commit MVP（复述时间戳 + SCOPE 基线哈希）未实现。
- 多活跃任务卡 / 文件 claim 未做（并发仍靠分支隔离）。
- 决策/契约文档结构本地化未参数化。
- 复述门禁仍是散文，宿主侧 hook 未实现。
