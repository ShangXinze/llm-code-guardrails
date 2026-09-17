#!/usr/bin/env node
// 一致性审计：检查「计划 / 文档 / 代码 / 证据」四者是否仍然一致。
//
// 这是架构适应度函数（fitness function），不是 lint 的替代品：
// lint 管单个文件写得好不好，本脚本管**多个模块合在一起**是否还像同一个项目。
//
// 用法:
//   node scripts/consistency-audit.mjs [--root <目录>] [--report] [--json]
//                                      [--roadmap <路径>] [--tasks <目录>] [--evidence <目录>]
//   --report    只报告不判失败（项目初期或按需巡检时用）
//   --json      机器可读输出
//   --roadmap   计划源文件，默认 ROADMAP.md（仓库已有自己的计划文档时指向它）
//   --tasks     归档任务卡目录，默认 docs/tasks
//   --evidence  验证日志目录，默认 var
// 退出码: 0 = 无 error, 1 = 有 error, 2 = 环境/配置问题
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadGuardrailsConfig, describeConfig } from './guardrails-config.mjs';

const args = process.argv.slice(2);
function flagValue(name, fallback) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0) {
    const next = args[i + 1];
    return next && !next.startsWith('--') ? next : true;
  }
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

const ROOT = resolve(String(flagValue('root', '.')));
const REPORT_ONLY = flagValue('report', false) === true;
const AS_JSON = flagValue('json', false) === true;
// 配置文件是路径与文档小节的唯一声明源；CLI 只做覆盖（手工/CI 临时用）。
const cfg = loadGuardrailsConfig(ROOT);
const ROADMAP_REL = String(flagValue('roadmap', cfg.roadmap));
const TASKS_REL = String(flagValue('tasks', cfg.tasks));
const EVIDENCE_REL = String(flagValue('evidence', cfg.evidence));

const SRC_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs',
  '.java', '.kt', '.cs', '.rb', '.php', '.swift', '.cpp', '.c', '.h',
]);
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'venv', '.venv',
  '__pycache__', 'vendor', 'coverage', 'var', '.next', '.nuxt', '.idea',
  '.vscode', '.gradle', 'Pods', '.workbuddy', '.agents', '.zcode', '.claude',
]);
const BANNED_NAMES = new Set([
  'data', 'info', 'handle', 'process', 'manager', 'util', 'utils',
  'temp', 'tmp', 'helper', 'common', 'misc',
]);
// Rust/Python 里这些是语言与惯例规定的名字（Iterator::next、From::from、main…），
// 跨模块重名是正常的，不是"同一能力写了两遍"。
const IDIOMATIC_DECL_NAMES = new Set([
  'new', 'default', 'main', 'from', 'into', 'try_from', 'try_into', 'fmt',
  'drop', 'clone', 'eq', 'cmp', 'hash', 'next', 'poll', 'call', 'run', 'spawn',
  'serve', 'start', 'stop', 'build', 'parse', 'load', 'open', 'close', 'send',
  'recv', 'len', 'is_empty', 'init', 'setup', 'teardown', 'name', 'id',
]);
const STATUSES = new Set(['todo', 'doing', 'done', 'blocked', 'dropped']);
// 文档小节名可在 .guardrails.json 的 docSections 里本地化（英文仓库不必改脚本）
const DOC_SECTIONS = cfg.docSections;
const TAG_DOCS = ['AGENTS.md', 'CONSTITUTION.md', 'ROADMAP.md', 'ARCHITECTURE.md'];
// 这些目录里的源文件按语言规则跳过"文本深引"检查；Rust 的 pub / pub(crate) 隐私系统
// 本身就在执行这条边界，再扫一遍只会对每个合法 use 刷警告。
const RUST_EXT = '.rs';

const results = [];
function record(name, items, level) {
  results.push({ name, level, items });
}
function ok(name, note) {
  record(name, note ? [note] : [], 'ok');
}
function warn(name, items) {
  record(name, items, items.length ? 'warn' : 'ok');
}
function fail(name, items) {
  record(name, items, items.length ? 'error' : 'ok');
}

function walkFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function filesUnder(relPath) {
  const abs = join(ROOT, relPath);
  if (!existsSync(abs)) return [];
  return statSync(abs).isDirectory() ? walkFiles(abs) : [abs];
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const toPosix = (p) => p.split(sep).join('/').replace(/^\.\//, '').replace(/\/+$/, '');
const relTo = (abs) => toPosix(relative(ROOT, abs));
const isTemplateFile = (rel) =>
  /(^|\/)_[^/]*\.md$/i.test(rel) || /-template\.md$/i.test(rel);

const GATE_FILES = new Set([
  'scripts/scope-check.mjs',
  'scripts/scope-check.test.mjs',
  'scripts/consistency-audit.mjs',
  'scripts/consistency-audit.test.mjs',
]);
const isTestFile = (rel) =>
  /\.(test|spec)\.[a-z]+$/i.test(rel) ||
  /(^|\/)(tests?|__tests__|spec)\//i.test(rel) ||
  /(^|\/)test_[^/]+\.py$/i.test(rel);

// 测试夹具与门禁脚本自身会合法地包含反例（空词命名、坏 TODO、故意越界的路径），
// 对这些文件只做占位符检查，否则审计会一辈子在骂自己。
const skipContentChecks = (rel) => GATE_FILES.has(rel) || isTestFile(rel);

/** 取 markdown 里某个二级/三级标题下的正文（到下一个同级或更高级标题为止）。 */
function docSection(text, title) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && l.includes(title));
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{2,3}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 取「以模块 ID 开头的标题」所辖的那一段（到下一个同级或更高级标题为止）。
 *
 * 为什么要它：仓库纪律常常是"不新开文档"，一个模块一份 md 是不被允许的。此时
 * 多份模块共用一个聚合文档，每个模块占一个 `## <模块ID> <名字>` 块。若直接用 docSection
 * 在全文档里找「职责」，永远只会命中第一个模块的块 —— 检查会静默失效（对每个模块都
 * 说"通过"，因为第一节确实存在）。所以聚合文档必须按 ID 限定作用域。
 *
 * 单模块文档（一份文档只讲一个模块、没有 ID 标题）返回 null，调用方退回全文，行为不变。
 */
function docScope(text, scopeId) {
  if (!scopeId) return null;
  const lines = text.split('\n');
  const re = new RegExp(`^#{1,6}\\s+${escapeRe(scopeId)}(?![A-Za-z0-9_])`);
  const start = lines.findIndex((l) => re.test(l));
  if (start < 0) return null;
  const level = (lines[start].match(/^#+/) ?? ['#'])[0].length;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    const hit = lines[i].match(/^(#+)\s/);
    if (hit && hit[1].length <= level) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * Rust 源文件里 `#[cfg(test)]` 之后的部分（含 `mod tests`）不参与命名/TODO 检查：
 * Rust 惯例就是把单元测试放在文件尾部，测试夹具会合法地包含反例。
 * 非 Rust 文件原样返回。代价是这些测试里的空词命名不会被发现（见 design-rationale.md）。
 */
function productionPart(text, ext) {
  if (ext !== RUST_EXT) return text;
  const lines = text.split('\n');
  const cut = lines.findIndex(
    (l) => /^\s*#\[cfg\(test\)\]\s*$/.test(l) || /^\s*(?:pub\s+)?mod\s+tests\b/.test(l)
  );
  return cut < 0 ? text : lines.slice(0, cut).join('\n');
}

/**
 * 读 Cargo.toml 的一个 section 正文（用于把模块路径映射到 crate 名）。
 *
 * 按行扫描而不是用正则：`^\[section\]\s*$([\s\S]*?)` 里的 `$` 在 `m` 标志下每行行尾都成立，
 * 非贪婪体因此当场匹配空串，section 永远读不到内容，crate 名全变 null、检查静默失效。
 * 与上面 markdown 分节是同一类坑（见 references/design-rationale.md）。
 */
function tomlSection(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `[${name}]`);
  if (start < 0) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/**
 * 模块路径 → Rust crate 标识符。Cargo 的 crate 名可以用 `-`（example-core），
 * 代码里写的是 `_`（example_core），`[lib] name` 还可能改过（example-py → example_rs），
 * 所以必须读清单，不能只按目录名猜。非 Rust 模块返回 null。
 */
function crateNameOf(modulePath) {
  if (!modulePath) return null;
  const manifest = join(ROOT, modulePath, 'Cargo.toml');
  if (!existsSync(manifest)) return null;
  const text = read(manifest);
  const declared = tomlSection(text, 'lib')?.match(/^\s*name\s*=\s*"([^"]+)"/m);
  const pkg = tomlSection(text, 'package')?.match(/^\s*name\s*=\s*"([^"]+)"/m);
  const raw = declared?.[1] ?? pkg?.[1];
  return raw ? raw.replace(/-/g, '_') : null;
}

let gitReady = true;
try {
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' });
} catch {
  gitReady = false;
}

function lastCommitDate(relPath) {
  if (!gitReady) return null;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cd', '--date=short', '--', relPath], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// ── 1. 模块注册表 ────────────────────────────────────────────────
function parseModuleRegistry() {
  const file = join(ROOT, ROADMAP_REL);
  if (!existsSync(file)) {
    return { fatal: `${ROADMAP_REL} 不存在：本套规范要求它作为唯一的计划源`, modules: [] };
  }
  const text = read(file);
  const block = text.match(/<!--\s*MODULES:BEGIN([\s\S]*?)MODULES:END\s*-->/);
  if (!block) {
    return { fatal: `${ROADMAP_REL} 缺少 MODULES 声明块（见 ROADMAP.md 模板）`, modules: [] };
  }
  const modules = [];
  const problems = [];
  for (const raw of block[1].split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('|').map((c) => c.trim());
    if (cols.length < 5) {
      problems.push(`模块行字段不足（应为 id | path | doc | status | deps）：${line}`);
      continue;
    }
    const [id, path, doc, status, deps] = cols;
    if (!STATUSES.has(status)) problems.push(`模块 ${id} 的状态非法：${status}`);
    if (!path) problems.push(`模块 ${id} 缺少代码路径`);
    modules.push({
      id,
      path: toPosix(path),
      doc: toPosix(doc),
      status,
      deps: deps === '-' ? [] : deps.split(',').map((d) => d.trim()).filter(Boolean),
    });
  }
  const seen = new Set();
  for (const m of modules) {
    if (seen.has(m.id)) problems.push(`模块 ID 重复：${m.id}`);
    seen.add(m.id);
  }
  for (const m of modules) {
    for (const d of m.deps) {
      if (!seen.has(d)) problems.push(`模块 ${m.id} 依赖了不存在的模块 ${d}`);
    }
  }
  return { problems, modules };
}

const registry = parseModuleRegistry();
if (registry.fatal) {
  console.error(`consistency-audit: ${registry.fatal}`);
  console.error('  可在仓库根目录运行，或用 --root <目录> 指定仓库位置。');
  process.exit(2);
}
const modules = registry.modules;
if (registry.problems?.length) fail('module-registry', registry.problems);
else ok('module-registry', `${modules.length} 个模块`);

const moduleById = new Map(modules.map((m) => [m.id, m]));
const allSourceFiles = walkFiles(ROOT).filter((f) => SRC_EXTS.has(extOf(f)));

// Rust 的跨 crate 引用写的是 crate 名（example_core::…），不是文件路径，
// 所以要先把每个模块的 crate 名读出来，依赖方向检查才能落地。
for (const m of modules) {
  m.crate = crateNameOf(m.path);
}
const rustModules = modules.filter((m) => m.crate);

/**
 * 读模块文档，并返回"该模块实际生效的那一段"：聚合文档（多模块共用一份 md）里
 * 按模块 ID 限定作用域，单模块文档退回全文。返回 null 表示文档不存在。
 */
function readModuleDoc(m) {
  if (!m.doc) return null;
  const abs = join(ROOT, m.doc);
  if (!existsSync(abs)) return null;
  const text = read(abs);
  return { text, body: docScope(text, m.id) ?? text };
}

function extOf(p) {
  const i = p.lastIndexOf('.');
  return i < 0 ? '' : p.slice(i).toLowerCase();
}

// ── 2. 模块路径存在（todo 模块允许还没建目录，只提示）────────────
const absentPaths = modules.filter((m) => m.path && !existsSync(join(ROOT, m.path)));
fail(
  'modules-exist',
  absentPaths.filter((m) => m.status !== 'todo').map((m) => `${m.id}[${m.status}]: 代码路径不存在 ${m.path}`)
);
warn(
  'modules-exist(todo)',
  absentPaths.filter((m) => m.status === 'todo').map((m) => `${m.id}: 待建 ${m.path}`)
);

// ── 3. 模块文档存在 + 必需小节 + 核验日期 ────────────────────────
const docProblems = [];
const staleProblems = [];
const sectionWarnings = [];
for (const m of modules) {
  if (!m.doc) continue;
  const isDone = m.status === 'done';
  const found = readModuleDoc(m);
  if (found === null) {
    (isDone ? docProblems : sectionWarnings).push(`${m.id}: 缺少模块文档 ${m.doc}`);
    continue;
  }
  const body = found.body;
  const missing = DOC_SECTIONS.filter((s) => docSection(body, s) === null);
  if (missing.length) {
    (isDone ? docProblems : sectionWarnings).push(`${m.id}: ${m.doc} 缺少小节 ${missing.join(' / ')}`);
  }
  const dateHit = body.match(/最后核验日期[：:]\s*(\d{4}-\d{2}-\d{2})/);
  if (!dateHit) {
    (isDone ? docProblems : sectionWarnings).push(`${m.id}: ${m.doc} 缺少「最后核验日期」`);
  } else if (gitReady) {
    const codeDate = lastCommitDate(m.path);
    if (codeDate && dateHit[1] < codeDate) {
      staleProblems.push(`${m.id}: ${m.doc} 核验日期 ${dateHit[1]} 早于代码最后修改 ${codeDate}`);
    }
  }
}
fail('module-docs', docProblems);
fail('doc-freshness', staleProblems);
warn('doc-sections(未完成模块)', sectionWarnings);

// ── 4. 文档「对外接口」的符号必须在代码里存在 ────────────────────
const symbolProblems = [];
for (const m of modules) {
  const found = readModuleDoc(m);
  if (found === null) continue;
  const sec = docSection(found.body, '对外接口');
  if (!sec) continue;
  const names = new Set();
  for (const hit of sec.matchAll(/([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/g)) names.add(hit[1]);
  if (!names.size) continue;
  const pool = filesUnder(m.path).map(read).join('\n');
  for (const name of names) {
    if (!new RegExp(`\\b${name}\\b`).test(pool)) {
      symbolProblems.push(`${m.id}: 文档声明了 ${name}()，但 ${m.path} 下找不到该符号`);
    }
  }
}
fail('doc-symbol-sync', symbolProblems);

// ── 5. 跨模块引用（依赖方向 + 是否走公开入口）────────────────────
//
// 两种生态的引用写法完全不同，必须分开扫：
//   - JS/Python/Go 等：`import x from '../other/index.mjs'` —— 路径字符串，能据此判断是否深引；
//   - Rust：`use example_core::engine::RouteActor;` —— 写的是 crate 标识符，没有路径字符串。
//     早先只扫带引号的路径，导致 Rust 仓库这条检查**静默地什么都不做**（不是通过，是没跑）。
//     Rust 的"是否深引"由 pub / pub(crate) / pub(super) 隐私系统在执行，文本层不再重复判断。
const importProblems = new Set();
const deepImportWarnings = [];
const importLineRe = /^\s*(?:import|export|from|use|using|const\s+\w+\s*=\s*require\s*\(|require\s*\()/;

for (const m of modules) {
  for (const file of filesUnder(m.path)) {
    if (!SRC_EXTS.has(extOf(file))) continue;
    const relFile = relTo(file);
    const ext = extOf(file);

    if (ext === RUST_EXT) {
      // 扫全文而不是只扫 use 行：`example_core::engine::send()` 这种全限定路径同样建立依赖。
      // 只认注册表里的 crate 名，所以 std/tokio/第三方 crate 天然被忽略。
      const body = productionPart(read(file), RUST_EXT);
      for (const other of rustModules) {
        if (other.id === m.id) continue;
        if (!new RegExp(`\\b${other.crate}::`).test(body)) continue;
        if (!m.deps.includes(other.id)) {
          importProblems.add(
            `${m.id} 引用了未声明依赖的模块 ${other.id}（${relFile} → ${other.crate}::…）`
          );
        }
      }
      continue;
    }

    for (const line of read(file).split('\n')) {
      if (!importLineRe.test(line)) continue;
      for (const hit of line.matchAll(/['"]([^'"]+)['"]/g)) {
        const spec = hit[1];
        if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
        const targetRel = spec.startsWith('@/')
          ? toPosix(spec.slice(2))
          : toPosix(relative(ROOT, resolve(dirname(file), spec)));
        for (const other of modules) {
          if (other.id === m.id) continue;
          if (!other.path) continue;
          if (targetRel === other.path || targetRel.startsWith(`${other.path}/`)) {
            if (!m.deps.includes(other.id)) {
              importProblems.add(
                `${m.id} 引用了未声明依赖的模块 ${other.id}（${relFile} → ${spec}）`
              );
            } else {
              const rest = targetRel.slice(other.path.length).replace(/^\//, '');
              if (rest && !/^index\./.test(rest) && !/^(__init__|mod|lib|api)\./.test(rest)) {
                deepImportWarnings.push(
                  `${m.id} 深引 ${other.id} 的内部文件（${relFile} → ${spec}），应走对方公开入口`
                );
              }
            }
          }
        }
      }
    }
  }
}
fail('dependency-direction', [...importProblems]);
if (rustModules.length) {
  ok(
    'public-entry(rust)',
    `Rust ${rustModules.length} 个 crate：跨 crate 可见性由 pub / pub(crate) 隐私系统强制，不做文本深引检查`
  );
}
warn('public-entry', [...new Set(deepImportWarnings)]);

// ── 6. 宪法禁止的空词命名 ────────────────────────────────────────
//
// 分语言判定，因为"空词"的严重程度取决于**名字周围有没有上下文**：
//   - JS/Python 的自由函数与 Rust 的 fn/struct/trait/mod：名字是唯一的上下文 → 空词=错误；
//   - Rust 方法（签名里有 self）：`frame.data()` / `actor.handle(ev)` 由接收者补上了名词，
//     这类名字是 trait 与消息协议规定的动词（同 Iterator::next、Future::poll）→ 只警告。
//     不放成"静默通过"：每次审计都打印出来，让人看得见、可以选择改名。
const namingProblems = [];
const namingIdiomWarnings = [];
const declRe = /(?:^|\s)(?:function|def|func|fn|void|public|private|static)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const assignRe = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:\(|function)/;
const rustFnRe = /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]([^)]*)/;
const rustDeclRe =
  /^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait|union|type|mod)\s+([A-Za-z_][A-Za-z0-9_]*)\b/;

for (const file of allSourceFiles) {
  const rel = relTo(file);
  if (skipContentChecks(rel)) continue;
  const ext = extOf(file);
  const base = ext === '' ? file : file.slice(0, -ext.length);
  const stem = base.split(/[\\/]/).pop().toLowerCase();
  if (BANNED_NAMES.has(stem)) {
    namingProblems.push(`${rel}: 文件名是空词，请用动词+名词表达职责`);
  }
  productionPart(read(file), ext)
    .split('\n')
    .forEach((line, i) => {
      if (ext === RUST_EXT) {
        const fnHit = line.match(rustFnRe);
        if (fnHit) {
          if (!BANNED_NAMES.has(fnHit[1].toLowerCase())) return;
          const isMethod = /(^|[^\w])self([^\w]|$)/.test(fnHit[2]);
          if (isMethod) {
            namingIdiomWarnings.push(
              `${rel}:${i + 1}: 方法名 ${fnHit[1]} 是空词（接收者提供了上下文，仅警告；改名更清晰）`
            );
          } else {
            namingProblems.push(`${rel}:${i + 1}: 函数名 ${fnHit[1]} 是空词`);
          }
          return;
        }
        const declHit = line.match(rustDeclRe);
        if (declHit && BANNED_NAMES.has(declHit[1].toLowerCase())) {
          namingProblems.push(`${rel}:${i + 1}: 类型/模块名 ${declHit[1]} 是空词`);
        }
        return;
      }
      const hit = line.match(declRe) ?? line.match(assignRe);
      if (hit && BANNED_NAMES.has(hit[1].toLowerCase())) {
        namingProblems.push(`${rel}:${i + 1}: 函数名 ${hit[1]} 是空词`);
      }
    });
}
fail('naming', namingProblems);
warn('naming(rust 方法惯用)', namingIdiomWarnings);

// ── 7. TODO 必须带任务 ID ────────────────────────────────────────
const todoProblems = [];
for (const file of allSourceFiles) {
  const rel = relTo(file);
  if (skipContentChecks(rel)) continue;
  productionPart(read(file), extOf(file))
    .split('\n')
    .forEach((line, i) => {
      if (!/\bTODO\b/.test(line)) return;
      if (!/TODO\((?:task-)?[A-Za-z0-9][\w-]*\)/.test(line)) {
        todoProblems.push(`${rel}:${i + 1}: TODO 缺少任务 ID，应为 TODO(T1-2): 原因`);
      }
    });
}
fail('todo-task-id', todoProblems);

// ── 8. 模板占位符残留 ────────────────────────────────────────────
const placeholderProblems = [];
const leftTodoWarnings = [];
for (const file of walkFiles(ROOT)) {
  const rel = relTo(file);
  if (isTemplateFile(rel)) continue;
  const ext = extOf(file);
  if (!SRC_EXTS.has(ext) && ext !== '.md' && ext !== '.sh' && ext !== '.ps1' && ext !== '.json') continue;
  const text = read(file);
  if (/\{\{[A-Z_]+\}\}/.test(text)) {
    placeholderProblems.push(`${rel}: 残留模板占位符（init_repo 未替换或栈未识别，请手工填写）`);
  }
  if (TAG_DOCS.includes(rel) && /^\s*TODO:/m.test(text)) {
    leftTodoWarnings.push(`${rel}: 仍有 TODO: 待填内容`);
  }
}
fail('placeholders', placeholderProblems);
warn('tag-docs-todo', leftTodoWarnings);

// ── 9. done 模块必须有归档任务卡与验证证据 ───────────────────────
const archiveProblems = [];
const taskDir = join(ROOT, TASKS_REL);
const taskDirExists = existsSync(taskDir);
const archiveText = taskDirExists
  ? walkFiles(taskDir).filter((f) => extOf(f) === '.md').map(read).join('\n')
  : '';
for (const m of modules) {
  if (m.status !== 'done') continue;
  if (!archiveText.includes(m.id)) {
    archiveProblems.push(`${m.id} 已标 done，但 ${TASKS_REL}/ 下找不到包含该模块 ID 的归档任务卡`);
  }
}
if (archiveProblems.length && !archiveText) {
  // 归档目录不存在或为空时（目录名被本地化成 `docs/任务归档/` 之类），上面每条"找不到归档卡"
  // 都是路径没对上，不是真缺卡片 —— 而它看起来像"真缺卡片"，最容易把人推向造假卡片或放宽审计。
  // 这里只加诊断（仍然 fail-closed，不自动改路径）：把候选目录摆出来，让人一眼看出是路径问题。
  const parentRel = toPosix(dirname(TASKS_REL));
  const parentAbs = join(ROOT, parentRel === '.' ? '' : parentRel);
  const candidates = existsSync(parentAbs)
    ? readdirSync(parentAbs, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => {
          const rel = parentRel === '.' ? e.name : `${parentRel}/${e.name}`;
          const mds = walkFiles(join(parentAbs, e.name)).filter((f) => extOf(f) === '.md');
          // 排序按"像不像任务卡目录"：卡片必然写出模块 ID（M1 / G-3b 这类词元），
          // 只数 md 数量会把 docs/contracts、docs/decisions 排到真归档目录前面（实测过）。
          const hits = mds.filter((f) => /\b[A-Z]\d+(-\d+)?\b/.test(read(f))).length;
          return { rel, md: mds.length, hits };
        })
        .filter((c) => c.md > 0)
        .sort((a, b) => b.hits - a.hits || b.md - a.md || a.rel.localeCompare(b.rel))
        .slice(0, 3)
    : [];
  archiveProblems.unshift(
    `注意：${TASKS_REL}/ 不存在或没有 .md —— 若本仓库改过归档目录名，上面的"找不到归档卡"全是路径没对上。` +
      (candidates.length
        ? ` 候选：${candidates.map((c) => `${c.rel}/（${c.md} 个 md）`).join('、')}。`
        : '') +
      ` 修法：把验证入口里的 --tasks 改成实际目录（单一来源），不要靠每次手工带参数。`
  );
}
fail('done-has-archive', archiveProblems);

const evidenceDir = join(ROOT, EVIDENCE_REL);
const evidenceFiles = existsSync(evidenceDir)
  ? walkFiles(evidenceDir).filter((f) => /verify-.*\.log$/.test(f))
  : [];
const doneModules = modules.filter((m) => m.status === 'done');
if (doneModules.length && !evidenceFiles.length) {
  fail('verify-evidence', [`有模块已 done，但 ${EVIDENCE_REL}/ 下没有任何 verify 日志：完成必须有证据`]);
} else {
  ok('verify-evidence', `${evidenceFiles.length} 份验证日志`);
}

// ── 10. 跨模块重复实现（提示级）──────────────────────────────────
// 各语言的定义形态都列上；语言与惯例规定的名字（new/from/main…）跳过，
// 否则 Rust 里每个 crate 的 `pub fn new` 都会报一次，警告会被当噪音关掉。
const exportSites = new Map();
const exportRe =
  /^\s*(?:export\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]{3,})\b|^\s*def\s+([A-Za-z_][A-Za-z0-9_]{3,})\s*\(|^\s*func\s+([A-Za-z_][A-Za-z0-9_]{3,})\s*\(|^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]{3,})\s*[<(]|^\s*(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_][A-Za-z0-9_]{3,})\b/;
for (const m of modules) {
  for (const file of filesUnder(m.path)) {
    if (!SRC_EXTS.has(extOf(file))) continue;
    if (skipContentChecks(relTo(file))) continue;
    const ext = extOf(file);
    productionPart(read(file), ext)
      .split('\n')
      .forEach((line) => {
        const hit = line.match(exportRe);
        const name = hit?.[1] ?? hit?.[2] ?? hit?.[3] ?? hit?.[4] ?? hit?.[5];
        if (!name || IDIOMATIC_DECL_NAMES.has(name)) return;
        // Rust 上还要再排两类，否则警告全是噪音（实测一个 9 crate 仓库报了 33 条，全是假阳性）：
        //   - 方法（签名含 self）：trait 声明与它在各模块的实现本来就同名，那是**同一个**函数；
        //   - 构造器（`-> Self`）：名字由返回类型限定，不同模块的 `bench()` 是不同东西。
        // 剩下的才是真信号：同名类型、同名自由函数。
        if (ext === RUST_EXT) {
          const afterName = line.slice(line.indexOf(name) + name.length);
          if (/(^|[^\w])self([^\w]|$)/.test(afterName) || /->\s*Self\b/.test(line)) return;
        }
        if (!exportSites.has(name)) exportSites.set(name, new Set());
        exportSites.get(name).add(m.id);
      });
  }
}
const dupWarnings = [...exportSites.entries()]
  .filter(([, set]) => set.size > 1)
  .map(([name, set]) => `${name} 在多个模块中定义：${[...set].join(', ')}（确认不是重复实现）`);
warn('duplicate-implementations', dupWarnings);

// ── 汇总 ─────────────────────────────────────────────────────────
const errors = results.filter((r) => r.level === 'error');
const warns = results.filter((r) => r.level === 'warn');

if (AS_JSON) {
  console.log(JSON.stringify({ root: ROOT, results, errors: errors.length, warns: warns.length }, null, 2));
} else {
  console.log(`一致性审计  root=${ROOT}  模块=${modules.length}  git=${gitReady ? 'ok' : '不可用(跳过日期检查)'}`);
  // 把解析用的路径打出来：仓库改了归档目录名时，手工跑（没带 --tasks）会误报一堆
  // "找不到归档卡"，这一行让人一眼看出是路径没对上，而不是真缺卡片。
  console.log(`  ${describeConfig({ ...cfg, roadmap: ROADMAP_REL, tasks: TASKS_REL, evidence: EVIDENCE_REL })}`);
  if (cfg.source === 'invalid') {
    console.warn(`  注意：${cfg.configFile} 解析失败（${cfg.parseError}），已回退默认路径`);
  }
  if (cfg.docSectionsInvalid) {
    console.warn('  注意：docSections 非法（须为非空字符串数组），已回退默认小节名');
  }
  for (const r of results) {
    const mark = r.level === 'ok' ? '✓' : r.level === 'warn' ? '⚠' : '✗';
    console.log(`${mark} ${r.name}${r.items.length ? `  (${r.items.length})` : ''}`);
    if (r.level !== 'ok') r.items.forEach((i) => console.log(`    - ${i}`));
  }
  console.log(`\n结果：${errors.length} error / ${warns.length} warn`);
  if (errors.length) {
    console.log('处理方式：修完再提交；若某项暂时无法满足，在 TASK.md 的「未决问题」写明原因与计划，不要静默放过。');
  }
}

if (errors.length && !REPORT_ONLY) process.exit(1);
