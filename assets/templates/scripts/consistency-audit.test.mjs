#!/usr/bin/env node
// consistency-audit 的自测：用临时仓库夹具覆盖每一类不一致。
// 运行: node --test scripts/consistency-audit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'consistency-audit.mjs');

const ROADMAP = `# ROADMAP.md — demo

<!-- MODULES:BEGIN
M1 | src/modules/order | docs/modules/order.md | done | -
MODULES:END -->
`;

const MODULE_DOC = `# 模块：order

> 最后核验日期：2099-01-01

## 职责

负责订单创建。

## 入口

- \`src/modules/order/index.mjs\`

## 依赖

- 无

## 对外接口

\`\`\`
createOrder(input): Promise<Order>
\`\`\`

## 测试命令

\`\`\`bash
node --test
\`\`\`
`;

const MODULE_CODE = `export function createOrder(input) {
  return { id: '1', ...input };
}
`;

/** 造一个"全绿"的仓库，再按 mutate 破坏其中一处。 */
function makeRepo(mutate = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'audit-'));
  const write = (rel, text) => {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
  };
  write('ROADMAP.md', ROADMAP);
  write('docs/modules/order.md', MODULE_DOC);
  write('docs/tasks/T1-1-order-init.md', '# T1-1 M1 初始化订单模块\n');
  write('src/modules/order/index.mjs', MODULE_CODE);
  write('var/verify-20990101-000000.log', 'verify OK (full)\n');
  mutate({ dir, write, remove: (rel) => unlinkSync(join(dir, rel)) });
  return dir;
}

function run(dir, extraArgs = []) {
  try {
    const out = execFileSync(process.execPath, [script, '--root', dir, ...extraArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('干净项目：通过', () => {
  const dir = makeRepo();
  const r = run(dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 error/);
});

test('模块代码路径不存在 → 失败', () => {
  const r = run(makeRepo(({ write }) => write('ROADMAP.md', ROADMAP.replace('src/modules/order', 'src/modules/nope'))));
  assert.equal(r.code, 1);
  assert.match(r.out, /modules-exist/);
});

test('done 模块文档缺少「最后核验日期」→ 失败', () => {
  const r = run(makeRepo(({ write }) => write('docs/modules/order.md', MODULE_DOC.replace('> 最后核验日期：2099-01-01', '> 没有日期'))));
  assert.equal(r.code, 1);
  assert.match(r.out, /最后核验日期/);
});

test('文档声明的接口在代码里不存在 → 失败', () => {
  const r = run(makeRepo(({ write }) => write('src/modules/order/index.mjs', 'export function somethingElse() {}\n')));
  assert.equal(r.code, 1);
  assert.match(r.out, /doc-symbol-sync/);
});

test('引用未声明依赖的模块 → 失败', () => {
  const roadmap = ROADMAP.replace('M1 | src/modules/order | docs/modules/order.md | done | -', `M1 | src/modules/order | docs/modules/order.md | done | -
M2 | src/modules/user | docs/modules/user.md | todo | -`);
  const r = run(
    makeRepo(({ write }) => {
      write('ROADMAP.md', roadmap);
      write('src/modules/user/index.mjs', "import { createOrder } from '../order/index.mjs';\n");
    })
  );
  assert.equal(r.code, 1);
  assert.match(r.out, /dependency-direction/);
});

test('深引已声明依赖模块的内部文件 → 警告但不失败', () => {
  const roadmap = ROADMAP.replace('M1 | src/modules/order | docs/modules/order.md | done | -', `M1 | src/modules/order | docs/modules/order.md | done | -
M2 | src/modules/user | docs/modules/user.md | todo | M1`);
  const r = run(
    makeRepo(({ write }) => {
      write('ROADMAP.md', roadmap);
      write('src/modules/user/index.mjs', "import { x } from '../order/internal/deep.mjs';\n");
    })
  );
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /public-entry/);
});

test('空词命名 → 失败', () => {
  const r = run(makeRepo(({ write }) => write('src/modules/order/index.mjs', 'export function createOrder() {}\nexport function handle(a) { return a; }\n')));
  assert.equal(r.code, 1);
  assert.match(r.out, /naming/);
});

test('TODO 缺任务 ID → 失败', () => {
  const r = run(makeRepo(({ write }) => write('src/modules/order/index.mjs', `${MODULE_CODE}\n// TODO 补边界处理\n`)));
  assert.equal(r.code, 1);
  assert.match(r.out, /todo-task-id/);
});

test('TODO 带任务 ID → 通过', () => {
  const r = run(makeRepo(({ write }) => write('src/modules/order/index.mjs', `${MODULE_CODE}\n// TODO(T1-2): 补边界处理\n`)));
  assert.equal(r.code, 0, r.out);
});

test('残留模板占位符 → 失败', () => {
  // 拼出来而不是写字面量：避免本文件本身被当成"含占位符的模板"处理
  const open = '{' + '{';
  const close = '}' + '}';
  const r = run(makeRepo(({ write }) => write('scripts/verify.sh', `CMD_TEST="${open}CMD_TEST${close}"\n`)));
  assert.equal(r.code, 1);
  assert.match(r.out, /placeholders/);
});

test('done 模块缺归档任务卡 → 失败', () => {
  const r = run(makeRepo(({ write }) => write('docs/tasks/T1-1-order-init.md', '# 与模块编号无关的卡片\n')));
  assert.equal(r.code, 1);
  assert.match(r.out, /done-has-archive/);
});

test('done 模块没有任何验证日志 → 失败', () => {
  const r = run(makeRepo(({ remove }) => remove('var/verify-20990101-000000.log')));
  assert.equal(r.code, 1);
  assert.match(r.out, /verify-evidence|没有验证日志/);
});

test('缺少 ROADMAP.md → 环境错误 exit 2', () => {
  const r = run(makeRepo(({ write }) => write('ROADMAP.md', '# 没有 MODULES 块\n')));
  assert.equal(r.code, 2);
});

test('--report 模式下有 error 也返回 0', () => {
  const dir = makeRepo(({ write }) => write('src/modules/order/index.mjs', 'export function handle() {}\n'));
  const r = run(dir, ['--report']);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /error/);
});

// ── Rust 夹具 ─────────────────────────────────────────────────────
// Rust 的引用写的是 crate 标识符而不是路径，且 crate 名可能与目录名/包名都不同
// （[lib] name 可覆盖），所以必须单独覆盖：否则这些检查对 Rust 仓库是静默不跑的。

const rustRoadmap = (netDeps) => `# ROADMAP.md — demo-rust

<!-- MODULES:BEGIN
M1 | crates/core-lib | docs/模块清单.md | done | -
M2 | crates/net-lib | docs/模块清单.md | done | ${netDeps}
MODULES:END -->
`;

// 两个模块共用一份聚合文档：这是"不新开文档"仓库的唯一可行形态，
// 也因此强制要求按模块 ID 限定小节作用域。
const RUST_AGG_DOC = `# 模块清单

## M1 core-lib

> 最后核验日期：2099-01-01

### 职责

路由核心。

### 入口

- \`crates/core-lib/src/lib.rs\`

### 依赖

- 无

### 对外接口

\`\`\`
build_engine(capacity): Engine
\`\`\`

## M2 net-lib

> 最后核验日期：2099-01-01

### 职责

QUIC 通道层。

### 入口

- \`crates/net-lib/src/lib.rs\`

### 依赖

- M1

### 对外接口

\`\`\`
open_channel(): Channel
\`\`\`
`;

// 目录叫 core-lib，包名却是 core-logic —— 用来证明 crate 名是读清单得来的，
// 而不是拿目录名猜的。
const RUST_CORE_LIB = `pub struct Engine {
    capacity: usize,
}

pub fn build_engine(capacity: usize) -> Engine {
    Engine { capacity }
}
`;

const RUST_NET_LIB = `use core_logic::Engine;

pub fn open_channel() -> Engine {
    core_logic::build_engine(8)
}
`;

function makeRustRepo(mutate = () => {}, netDeps = 'M1') {
  return makeRepo(({ write, remove }) => {
    write('ROADMAP.md', rustRoadmap(netDeps));
    write('docs/模块清单.md', RUST_AGG_DOC);
    write('docs/tasks/T0-1-rust-baseline.md', '# 基线卡：M1 M2 既有代码\n');
    write('crates/core-lib/Cargo.toml', '[package]\nname = "core-logic"\n');
    write('crates/core-lib/src/lib.rs', RUST_CORE_LIB);
    write('crates/net-lib/Cargo.toml', '[package]\nname = "net-lib"\n');
    write('crates/net-lib/src/lib.rs', RUST_NET_LIB);
    mutate({ write, remove });
  });
}

test('Rust 干净仓库：通过（聚合模块文档 + 依赖方向已声明）', () => {
  const r = run(makeRustRepo());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 error/);
  // Rust 不做文本深引检查，但必须把这件事说出来，而不是静静显示"无警告"
  assert.match(r.out, /public-entry\(rust\)/);
});

test('Rust：引用未声明依赖的 crate → 失败', () => {
  const r = run(makeRustRepo(() => {}, '-'));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /dependency-direction/);
  assert.match(r.out, /M2 引用了未声明依赖的模块 M1/);
  assert.match(r.out, /core_logic/);
});

test('Rust：crate 名读自 Cargo.toml，[lib] name 覆盖包名', () => {
  const r = run(
    makeRustRepo(({ write }) => {
      // 包名 net-lib，lib 名 net_logic；引用方写 net_logic:: 也必须被认出来
      write('crates/net-lib/Cargo.toml', '[package]\nname = "net-lib"\n\n[lib]\nname = "net_logic"\n');
      write('crates/core-lib/src/lib.rs', `${RUST_CORE_LIB}\nuse net_logic::Channel;\n`);
    })
  );
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /M1 引用了未声明依赖的模块 M2/);
  assert.match(r.out, /net_logic/);
});

test('Rust：全限定路径（非 use 行）同样计入依赖方向', () => {
  const r = run(
    makeRustRepo(({ write }) => {
      write(
        'crates/net-lib/src/lib.rs',
        `pub fn open_channel() -> usize {\n    core_logic::build_engine(1).capacity\n}\n`
      );
    }, '-')
  );
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /M2 引用了未声明依赖的模块 M1/);
});

test('Rust：自由函数空词名 → 失败', () => {
  const r = run(
    makeRustRepo(({ write }) =>
      write('crates/core-lib/src/lib.rs', `${RUST_CORE_LIB}\npub fn handle(ev: usize) -> usize {\n    ev\n}\n`)
    )
  );
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /naming/);
  assert.match(r.out, /函数名 handle 是空词/);
});

test('Rust：方法名是空词 → 仅警告，不判失败', () => {
  const r = run(
    makeRustRepo(({ write }) =>
      write(
        'crates/core-lib/src/lib.rs',
        `${RUST_CORE_LIB}\npub struct Router {\n    slots: usize,\n}\n\nimpl Router {\n    pub fn handle(&mut self, ev: usize) -> usize {\n        self.slots + ev\n    }\n}\n`
      )
    )
  );
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /naming\(rust 方法惯用\)/);
  assert.match(r.out, /方法名 handle 是空词/);
});

test('Rust：struct / trait / mod 空词名 → 失败', () => {
  const r = run(
    makeRustRepo(({ write }) =>
      write(
        'crates/core-lib/src/lib.rs',
        `${RUST_CORE_LIB}\npub struct Data;\npub trait Common {}\nmod util;\n`
      )
    )
  );
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /类型\/模块名 Data 是空词/);
  assert.match(r.out, /类型\/模块名 Common 是空词/);
  assert.match(r.out, /类型\/模块名 util 是空词/);
});

test('Rust：#[cfg(test)] 之后的测试代码不参与命名检查', () => {
  const r = run(
    makeRustRepo(({ write }) =>
      write(
        'crates/core-lib/src/lib.rs',
        `${RUST_CORE_LIB}\n#[cfg(test)]\nmod tests {\n    fn handle(ev: usize) -> usize {\n        ev\n    }\n}\n`
      )
    )
  );
  assert.equal(r.code, 0, r.out);
});

test('Rust：聚合文档按模块 ID 限定小节，模块之间不串味', () => {
  const broken = RUST_AGG_DOC.replace('### 职责\n\nQUIC 通道层。', '### 略\n\nQUIC 通道层。');
  const r = run(makeRustRepo(({ write }) => write('docs/模块清单.md', broken)));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /M2: docs\/模块清单\.md 缺少小节 职责/);
  assert.doesNotMatch(r.out, /M1: .*缺少小节/);
});

test('--roadmap / --tasks / --evidence 可指向自定义路径', () => {
  const r = run(
    makeRustRepo(({ write, remove }) => {
      remove('ROADMAP.md');
      remove('var/verify-20990101-000000.log');
      write('docs/计划/唯一计划源.md', rustRoadmap('M1'));
      write('docs/任务归档/T0-1-baseline.md', '# 基线：M1 M2\n');
      write('logs/verify-20990101-000000.log', 'verify OK\n');
    }),
    ['--roadmap', 'docs/计划/唯一计划源.md', '--tasks', 'docs/任务归档', '--evidence', 'logs']
  );
  assert.equal(r.code, 0, r.out);
});

test('归档目录被改名且没传 --tasks → 报错里给出"路径没对上"的诊断与候选目录', () => {
  // 场景：仓库把 docs/tasks 本地化成了 docs/任务归档（本项目真实发生过）。
  // 若诊断只说"找不到归档卡"，看的人会以为是真缺卡片，进而造空卡片或放宽审计 —— 那两条都是硬禁止。
  const mutate = ({ write, remove }) => {
    remove('docs/tasks/T1-1-order-init.md');
    write('docs/任务归档/T1-1-order-init.md', '# T1-1 M1 初始化订单模块\n');
  };
  const r = run(makeRepo(mutate));
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /docs\/tasks\/ 不存在或没有 \.md/);
  assert.match(r.out, /docs\/任务归档\/（1 个 md）/);

  // 传对路径后立刻转绿：证明这是路径问题，不是真缺卡片
  const fixed = run(makeRepo(mutate), ['--tasks', 'docs/任务归档']);
  assert.equal(fixed.code, 0, fixed.out);
});

test('没有 done 模块时，空归档目录不触发诊断（避免新仓库一上来就被误导）', () => {
  // 诊断只在"确有 done 模块找不到卡片"时出现；否则新仓库（还没写归档卡）会被这条提示带偏
  const r = run(
    makeRepo(({ write, remove }) => {
      remove('docs/tasks/T1-1-order-init.md');
      write('ROADMAP.md', ROADMAP.replace('| done |', '| todo |'));
    })
  );
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /不存在或没有 \.md/);
});
