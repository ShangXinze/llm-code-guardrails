# 可读性配方

"极强的可读性"不是形容词，是可以被检查的东西。本文件给出：能自动检查的规则（lint 配置配方）、
不能被自动检查但必须遵守的惯例、以及差 → 好对照。

判定标准只有一条：**一个不熟悉这个项目的工程师，10 分钟内能说清这段代码在做什么、边界在哪。**

---

## 一、能被 lint 强制的部分

不要把这些写进 Markdown 当口号 —— 写进配置，让工具去骂人。

### ESLint / TypeScript

```jsonc
// eslint.config.js 关键规则（阈值按项目调整，但必须有）
{
  "rules": {
    "max-depth": ["error", 3],                    // 嵌套 ≤ 3
    "max-lines-per-function": ["error", { "max": 80, "skipBlankLines": true, "skipComments": true }],
    "max-lines": ["error", { "max": 600, "skipBlankLines": true }],
    "complexity": ["error", 10],                  // 圈复杂度
    "max-params": ["error", 4],
    "no-else-return": "error",                    // 早返回优先
    "no-lonely-if": "error",
    "no-param-reassign": "error",
    "no-nested-ternary": "error",
    "no-unused-vars": "error",
    "no-warning-comments": ["error", { "terms": ["todo"], "location": "anywhere" }] // TODO 必须带 ID，配合下方自定义检查
  }
}
```

### Ruff（Python）

```toml
[tool.ruff.lint]
select = ["E", "F", "PLR", "C90", "SIM", "RET", "ARG", "N"]
ignore = ["E501"]

[tool.ruff.lint.pylint]
max-args = 4
max-branches = 10

[tool.ruff.lint.mccabe]
max-complexity = 10
```

### golangci-lint（Go）

```yaml
linters:
  enable: [gocyclo, funlen, nestif, gocognit, dupl, revive]
linters-settings:
  gocyclo: { min-complexity: 10 }
  funlen: { lines: 80, statements: 50 }
  nestif: { min-complexity: 4 }
```

### Clippy / rustfmt（Rust）

Rust 的阈值**必须显式写**，且**只写已经量到 0 违规的规则**：`too_many_lines` 默认 100 行、
`cognitive_complexity` 默认 25 都偏松，但"偏松"不是当场开 `deny` 的理由（有违规就开任务卡去收敛）。
写在 workspace 级 lints，各 crate 用一行挂上：

```toml
# Cargo.toml（workspace 根）
[workspace.lints.clippy]
too_many_lines = "deny"          # 先量到 0 再写进来，见下方"先测量"
too_many_arguments = "deny"
cognitive_complexity = "deny"    # 口径见下方说明，别拿它当嵌套检查用
excessive_nesting = "deny"       # 管深层嵌套的是它；需要较新的 clippy
dbg_macro = "deny"
todo = "deny"                    # 待办不许进主干
# unwrap_used = "deny"           # 同样：量到 0 之后再取消注释；本仓库门禁用 --deny warnings
                                 # 时，连 "warn" 都不能先挂 —— 挂上当天门禁就红

[workspace.lints.rust]
unsafe_code = "deny"

# crates/*/Cargo.toml（每个 crate 一行，否则 workspace lints 不生效）
[lints]
workspace = true
```

```toml
# rustfmt.toml
max_width = 100
use_field_init_shorthand = true
```

**已有代码库不要直接开 deny**，先用命令行量一遍真实违规数再决定（口径要写进估数旁边，
"生产目标"与 `--all-targets` 差很多：实测过一个 9 crate 仓库生产 63 处 / 全目标另外 249 处，
混用口径会直接导致任务拆分判断错）：

```bash
cargo clippy --workspace --all-targets -- \
  -W clippy::too_many_lines -W clippy::too_many_arguments \
  -W clippy::cognitive_complexity -W clippy::excessive_nesting \
  -W clippy::unwrap_used 2>&1 | grep -c '^warning'
```

量出来是 0 的规则才写进 `Cargo.toml` 判失败；有违规的**开任务卡**（进 `ROADMAP.md` 队列），
不要为了当场变绿去调高阈值或长期挂 `warn`（挂着的 warn 等于没有）。
注意 `cargo clippy -- --deny warnings` 会把新加的 `warn` 级规则也变成失败 ——
所以"先测量"这一步不是可选项，是前置条件。

**`cognitive_complexity` 的计数口径与直觉不同（clippy 1.98 实测）**：它**不累加嵌套层级**，
只数"决策点 + 布尔序列"。一个"4 层 `for` 嵌套 + `if` + `match` + 臂内 `if/else` + `while`
+ 布尔序列"的函数只得到 **9 分**；要凑到 25 分得有 25 个决策点（已经是巨型函数）。
所以：①它兜住的是"极端长"的函数，不能替代嵌套深度检查（嵌套用 `excessive_nesting` /
eslint `max-depth` / pylint `too-many-nested-blocks`）；②看到"阈值 25 太松"就手动往下调是不划算的，
真正管结构的是函数行数与嵌套深度。

Rust 侧还有一条 lint 覆盖不到的：**`#[allow(clippy::…)]` 必须带任务 ID 与理由**，
和禁止无理由 `eslint-disable` 是同一条规则。

### 空词命名（任何语言）

`consistency-audit.mjs` 会检查函数名与文件名是否落在
`data / info / handle / process / manager / util / utils / temp / tmp / helper / common / misc` 里。
这类词不是"简洁"，是**没写名字**。

---

## 二、不能自动检查、但必须遵守的部分

### 控制流：线性优先

```js
// 差：多层缩进，读者要在脑子里维护"当前在哪个条件里"
function shipOrder(order) {
  if (order) {
    if (order.paid) {
      if (order.items.length > 0) {
        return doShip(order);
      }
    }
  }
  return null;
}

// 好：卫语句 + 早返回，主干在最外层，边界条件提前挡掉
function shipOrder(order) {
  if (!order) throw new Error('order required');
  if (!order.paid) throw new Error('order not paid');
  if (order.items.length === 0) throw new Error('order has no items');
  return doShip(order);
}
```

### 控制流：Rust 用卫语句与 let-else，把错误路径放在最外层

```rust
// 差：嵌套金字塔 + unwrap。读者要自己记住"现在在哪个条件里"，且崩溃点没有上下文
fn load_rule(path: &Path) -> Rule {
    let text = std::fs::read_to_string(path).unwrap();
    match serde_yaml::from_str::<Option<Config>>(&text).unwrap() {
        Some(cfg) => {
            if cfg.enabled {
                if !cfg.rules.is_empty() {
                    return build_rule(&cfg);
                }
            }
            Rule::default()
        }
        None => Rule::default(),
    }
}

// 好：`?` 带上下文、let-else 挡掉边界，主干平铺在最外层
fn load_rule(path: &Path) -> Result<Rule, RuleError> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| RuleError::Read { path: path.into(), source: e })?;
    let parsed = serde_yaml::from_str::<Option<Config>>(&text).map_err(RuleError::Parse)?;
    let Some(cfg) = parsed else { return Ok(Rule::default()) };
    if !cfg.enabled || cfg.rules.is_empty() {
        return Ok(Rule::default());
    }
    Ok(build_rule(&cfg))
}
```

判据和 JS 一致：读第一行就能看出主干，条件反过来写（提前 `return`）。
Rust 特有的两点：能用 `?` 就别 `match`；`unwrap()` 只允许出现在"不变量已由上一行保证"或测试里。

### 命名：Rust 的方法名天生比自由函数名短

```rust
// 差：名字要在读完实现之后才看得懂
pub struct ConfigManager;              // 管什么？
pub fn process(data: &[u8])            // 处理成什么？
// 好：意图写在名字里
pub struct ChainConfigStore;
pub fn decode_port_datagram(raw: &[u8]) -> PortCommand
```

判定尺度和别处一样，只有一个例外要知道：`frame.data()` / `actor.handle(ev)` 这类**方法名**
由接收者补上了名词，严重程度低于同名自由函数（`fn handle(ev)` 才是真的没写名字）。
`consistency-audit` 按这个区别分级：方法降为警告，自由函数与类型名判失败。

### 抽象：不要为抽象而抽象

```js
// 差：三层单行转发，没有任何一层做额外的事。改一个字段要翻三个文件
class UserService {
  getUser(id) { return this.userRepository.getUserById(id); }
}
class UserRepository {
  getUserById(id) { return this.db.query('select * from users where id = ?', [id]); }
}

// 好：只在真的需要隔离变化时才分层；这里直接调用，等第二个实现出现再抽
async function findUser(db, id) {
  const rows = await db.query('select * from users where id = ?', [id]);
  return rows[0] ?? null;
}
```

判据：抽掉这一层，调用处会不会变难读？不会 → 抽掉它。
反过来的判据：重复第三次再抽。

### 命名：动词 + 名词，一次说清做什么

| 差 | 好 | 为什么 |
|---|---|---|
| `handle(data)` | `applyDiscount(cart, coupon)` | 第一个没说做什么，也没说操作对象 |
| `process()` | `publishPendingArticles()` | 同上 |
| `checkUser()` | `isUserActive(user)` / `assertUserExists(id)` | 布尔用 `is/has`，断言用 `assert` |
| `getData2()` | `fetchLatestOrders(since)` | 数字后缀等于放弃命名 |
| `flag` | `isArchived` | 意图写在名字里 |

### 注释：只写 why

```js
// 差：复述代码
// 把 total 加上 tax
total += tax;

// 好：解释约束和坑
// 税必须最后加：上游金额是含税报价，提前加会让优惠券的折扣基数算错（见 ADR-0007）
total += tax;
```

`TODO` 必须带任务 ID，否则审计会失败：`// TODO(M2-3): 并发写入需要加锁`。

### 文件与目录：就近放置

- 一个函数只用一个地方，就别为它单独建文件；塞进最近的、语义合适的模块里。
- 相关的东西放一起（按功能/领域分目录），而不是按技术类型分（`controllers/`、`services/`、`models/` 三张皮会逼着人跳文件）。
- 文件超过 600 行、模块目录超过 10 个文件时，是拆分的信号，不是继续堆的信号。
- 新增文件前先问：现有文件里有没有更合适的位置？先找，再建。

### 一致性：模仿最像的老模块

新模块开工前，**先找最像的那个既有模块，抄它的目录结构、命名、错误处理、测试组织**。
自创风格是最大的可读性杀手 —— 读者需要为新模块重新建立一次心理模型。

---

## 三、自查清单（提交前过一遍）

- [ ] `scripts/verify.* --full` 的 lint / 复杂度规则全绿（不是靠 `eslint-disable` / `#[allow(clippy::…)]` 过的）
- [ ] 随机挑一个函数，能一句话说清"输入什么、输出什么、什么情况报错"
- [ ] 没有任何一层只做转发
- [ ] 没有任何名字需要读实现才能理解
- [ ] 新增文件都能回答"为什么不能放进已有文件"
- [ ] 注释数量少于代码行数的 1/5，且每条都在讲"为什么"
- [ ] 新代码的风格与同目录既有代码无法区分
