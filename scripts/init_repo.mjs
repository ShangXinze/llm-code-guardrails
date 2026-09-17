#!/usr/bin/env node
// 把 LLM 协作规范脚手架铺进目标仓库（幂等：默认不覆盖已存在文件）。
//
// 用法:
//   node scripts/init_repo.mjs <目标目录> --name="项目名" --stack=node|python|go|rust [--force] [--dry-run]
//                                          [--level=full|scope-only|lint-only|minimal] [--minimal]
//                                          [--verify=new|none]
//                                          [--taskdir=<目录>] [--roadmap=<文件>] [--evidence=<目录>]
//   --level       full（默认）全套；scope-only 只铺范围锁与任务卡；
//                 lint-only 只写 .guardrails.json 与 lint 配方提示（不铺门禁）；
//                 minimal 等价旧 --minimal（已有上位治理体系时）。
//   --minimal     等价 --level=minimal（兼容旧命令）。
//   --verify      new（默认）铺 scripts/verify.sh|ps1；none 不铺，改为把门禁接进既有验证入口，
//                 避免出现第二条验证路径（两条必然漂移，见 references/tool-integration.md §5）
//   --taskdir     归档任务卡目录（默认 docs/tasks）。仓库已有自己的目录名（如 docs/任务归档）时
//                 用它改名：目录会被铺到该路径，并写入 .guardrails.json（单一来源）。
//   --roadmap     计划源文件（默认 ROADMAP.md）；--evidence 验证日志目录（默认 var）
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = resolve(here, '..', 'assets', 'templates');

const STACKS = {
  node: {
    manifest: 'package.json',
    format: 'npm run fmt:check',
    lint: 'npm run lint',
    typecheck: 'npm run typecheck',
    test: 'npm test',
  },
  python: {
    manifest: 'pyproject.toml',
    format: 'ruff format --check',
    lint: 'ruff check .',
    typecheck: 'mypy .',
    test: 'pytest',
  },
  go: {
    manifest: 'go.mod',
    format: 'test -z "$(gofmt -l .)"',
    lint: 'golangci-lint run',
    typecheck: 'go vet ./...',
    test: 'go test ./...',
  },
  rust: {
    manifest: 'Cargo.toml',
    // 必须带 --workspace：多 crate workspace 里不带它只检查当前目录那一个 crate，
    // 其余 crate 静默漏检，而输出看上去是全绿。
    format: 'cargo fmt --all -- --check',
    lint: 'cargo clippy --workspace --all-targets -- --deny warnings',
    typecheck: 'cargo check --workspace --all-targets',
    test: 'cargo test --workspace',
  },
};

// --minimal：只放"能拦人的东西"，不放规则文档（仓库已有 AGENTS.md/CLAUDE.md 类文件时用）。
const MINIMAL_KEEP = new Set([
  'TASK.md',
  '.gitignore',
  '.guardrails.json',
  'scripts/guardrails-config.mjs',
  'scripts/scope-check.mjs',
  'scripts/scope-check.test.mjs',
  'scripts/consistency-audit.mjs',
  'scripts/consistency-audit.test.mjs',
  'scripts/doctor.mjs',
  'scripts/doctor.test.mjs',
  '.agents/prompts/start.md',
  '.agents/prompts/continue.md',
  '.agents/prompts/finish.md',
  '.agents/checklists/pre-commit.md',
  '.agents/checklists/task-review.md',
]);
// scope-only：能锁范围、能记卡，但不要求宪法/路线图全套（探索期或已有计划源时）
const SCOPE_ONLY_KEEP = new Set([
  ...MINIMAL_KEEP,
  'AGENTS.md',
  'ROADMAP.md',
  'docs/tasks/README.md',
  'docs/tasks/_TEMPLATE.md',
  'docs/notes/README.md',
]);
// lint-only：几乎不铺，只留配置声明与说明，避免装半套又跑不起来
const LINT_ONLY_KEEP = new Set(['.guardrails.json', '.gitignore']);
const VERIFY_TEMPLATES = new Set(['scripts/verify.sh', 'scripts/verify.ps1']);

const argv = process.argv.slice(2);
function flag(name, fallback) {
  const i = argv.findIndex((a) => a === `--${name}`);
  if (i >= 0) {
    const next = argv[i + 1];
    return next && !next.startsWith('--') ? next : true;
  }
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  return fallback;
}

const positional = argv.find((a) => !a.startsWith('--'));
const target = resolve(positional ?? '.');
const projectName = String(flag('name', target.split(/[\\/]/).filter(Boolean).pop() ?? 'project'));
const stack = String(flag('stack', 'custom'));
const force = flag('force', false) === true;
const dryRun = flag('dry-run', false) === true;
const minimalFlag = flag('minimal', false) === true;
let level = String(flag('level', minimalFlag ? 'minimal' : 'full'));
if (minimalFlag && flag('level', null) === null) level = 'minimal';
if (!['full', 'scope-only', 'lint-only', 'minimal'].includes(level)) {
  console.error(`init_repo: --level 只接受 full | scope-only | lint-only | minimal（收到 ${level}）`);
  process.exit(2);
}
const minimal = level === 'minimal';
const verifyMode = String(flag('verify', level === 'lint-only' ? 'none' : 'new'));
if (!['new', 'none'].includes(verifyMode)) {
  console.error(`init_repo: --verify 只接受 new | none（收到 ${verifyMode}）`);
  process.exit(2);
}

// 三个"规则文档路径"参数：模板里的默认值写死为 docs/tasks / ROADMAP.md / var，
// 而仓库常有本地化目录名（docs/任务归档 等）。改名必须只在一个地方发生，
// 否则审计脚本按默认路径找不到归档卡 → 报一堆看着像"真缺卡片"的假错误。
const normRel = (s) => String(s).split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '');
const TASK_DIR_TPL = 'docs/tasks';
const taskDir = normRel(flag('taskdir', TASK_DIR_TPL));
const roadmapRel = normRel(flag('roadmap', 'ROADMAP.md'));
const evidenceRel = normRel(flag('evidence', 'var'));
if (taskDir === '') {
  console.error('init_repo: --taskdir 不能为空');
  process.exit(2);
}

if (!existsSync(TEMPLATE_ROOT)) {
  console.error(`init_repo: 找不到模板目录 ${TEMPLATE_ROOT}`);
  process.exit(2);
}

const tpl = STACKS[stack] ?? null;
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
  now.getDate()
).padStart(2, '0')}`;

const vars = {
  PROJECT: projectName,
  DATE: today,
  STACK: stack,
  LEVEL: level,
  MANIFEST: tpl?.manifest ?? '{{MANIFEST}}',
  CMD_FORMAT: tpl?.format ?? '{{CMD_FORMAT}}',
  CMD_LINT: tpl?.lint ?? '{{CMD_LINT}}',
  CMD_TYPECHECK: tpl?.typecheck ?? '{{CMD_TYPECHECK}}',
  CMD_TEST: tpl?.test ?? '{{CMD_TEST}}',
  ROADMAP_REL: roadmapRel,
  TASKS_REL: taskDir,
  EVIDENCE_REL: evidenceRel,
};

const render = (text) => text.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));

// 只有下列文件参与占位符替换。其余文件原样复制 ——
// 否则测试夹具、示例代码里出现的占位符字面量会被误替换（踩过一次）。
const RENDER_ALLOWLIST = new Set([
  'AGENTS.md',
  'CONSTITUTION.md',
  'ROADMAP.md',
  'TASK.md',
  'ARCHITECTURE.md',
  '.guardrails.json',
  'docs/modules/_TEMPLATE.md',
  'docs/tasks/_TEMPLATE.md',
  'docs/tasks/README.md',
  'docs/decisions/README.md',
  'docs/decisions/ADR-0001-template.md',
  'docs/contracts/README.md',
  'scripts/verify.sh',
  'scripts/verify.ps1',
  '.agents/prompts/finish.md',
  '.agents/checklists/pre-commit.md',
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const created = [];
const skipped = [];
const filtered = [];

// 归档目录改名时，模板按 docs/tasks/ 铺，落到目标仓库时要映射到 --taskdir 指定的路径。
// 只映射这一个目录：其余目录名（决议/契约/模块）由仓库自己的文档结构决定，不在这里猜。
function destRelOf(relPosix) {
  if (taskDir === TASK_DIR_TPL) return relPosix;
  if (relPosix === TASK_DIR_TPL) return taskDir;
  if (relPosix.startsWith(`${TASK_DIR_TPL}/`)) return taskDir + relPosix.slice(TASK_DIR_TPL.length);
  return relPosix;
}

// 反向映射：占位符残留检查拿到的路径是目标侧的，比对 RENDER_ALLOWLIST 要换回模板侧
function isRenderTemplate(relOut) {
  if (taskDir !== TASK_DIR_TPL && (relOut === taskDir || relOut.startsWith(`${taskDir}/`))) {
    return RENDER_ALLOWLIST.has(TASK_DIR_TPL + relOut.slice(taskDir.length));
  }
  return RENDER_ALLOWLIST.has(relOut);
}

for (const file of walk(TEMPLATE_ROOT)) {
  const rel = relative(TEMPLATE_ROOT, file);
  const relPosix = rel.split('\\').join('/');
  const relOut = destRelOf(relPosix);
  const dest = join(target, relOut);
  if (minimal && !MINIMAL_KEEP.has(relPosix)) {
    filtered.push(relPosix);
    continue;
  }
  if (level === 'scope-only' && !SCOPE_ONLY_KEEP.has(relPosix)) {
    filtered.push(relPosix);
    continue;
  }
  if (level === 'lint-only' && !LINT_ONLY_KEEP.has(relPosix)) {
    filtered.push(relPosix);
    continue;
  }
  if (verifyMode === 'none' && VERIFY_TEMPLATES.has(relPosix)) {
    filtered.push(relPosix);
    continue;
  }
  if (existsSync(dest) && !force) {
    skipped.push(relOut);
    continue;
  }
  if (!dryRun) {
    mkdirSync(dirname(dest), { recursive: true });
    const raw = readFileSync(file, 'utf8');
    writeFileSync(dest, RENDER_ALLOWLIST.has(relPosix) ? render(raw) : raw, 'utf8');
    if (/\.(sh|mjs)$/.test(dest)) {
      try {
        chmodSync(dest, 0o755);
      } catch {
        /* Windows 上无意义，忽略 */
      }
    }
  }
  created.push(relOut);
}

const modeNote = [
  level,
  verifyMode === 'none' ? 'verify=none' : 'verify=new',
].join(' ');
console.log(
  `${dryRun ? '[dry-run] ' : ''}init_repo → ${target}  (project=${projectName} stack=${stack} ${modeNote})`
);
if (taskDir !== TASK_DIR_TPL) {
  console.log(`  归档目录：${TASK_DIR_TPL}/ → ${taskDir}/（已写进 verify.* 与模板引用）`);
}
created.forEach((f) => console.log(`  + ${f}`));
skipped.forEach((f) => console.log(`  = 已存在，跳过: ${f}`));
if (filtered.length) {
  console.log(`  - 本次按模式未铺设（${filtered.length} 个）：${filtered.join(', ')}`);
}

if (!dryRun) {
  const leftInRender = [];
  const leftOutside = [];
  for (const rel of created) {
    const text = readFileSync(join(target, rel), 'utf8');
    if (!/\{\{[A-Z_]+\}\}/.test(text)) continue;
    // created 里存的是**目标侧**相对路径（归档目录可能已改名），比对白名单要换回模板侧
    (isRenderTemplate(rel) ? leftInRender : leftOutside).push(rel);
  }
  if (leftInRender.length) {
    console.log(`\n注意：以下文件替换后仍有占位符（通常是 --stack 未识别），需手工填写：`);
    leftInRender.forEach((f) => console.log(`  ! ${f}`));
  }
  if (leftOutside.length) {
    console.log(`\n注意：以下文件含占位符但不在替换白名单里，若是模板请加入 init_repo 的 RENDER_ALLOWLIST：`);
    leftOutside.forEach((f) => console.log(`  ! ${f}`));
  }
}

if (!tpl) {
  console.log('\n注意：未识别的技术栈，以下占位符需要手工填写：');
  console.log(
    '  {{MANIFEST}} {{CMD_FORMAT}} {{CMD_LINT}} {{CMD_TYPECHECK}} {{CMD_TEST}} {{ROADMAP_REL}} {{TASKS_REL}} {{EVIDENCE_REL}}'
  );
  console.log(
    verifyMode === 'none'
      ? '  位置：你接门禁的那个既有脚本（本次没有铺 scripts/verify.*）；路径变量也要在那边传给审计'
      : '  位置：scripts/verify.sh 与 scripts/verify.ps1 顶部变量。'
  );
}

const bootSteps = [];
const bootStep = (title, ...details) => bootSteps.push({ title, details });
if (level === 'lint-only') {
  bootStep(
    '档位=lint-only：只铺了 .guardrails.json 与 .gitignore。',
    '按 references/readability.md 配置 lint 并先测量违规数；',
    '需要锁范围时再 init --level=scope-only 或 full（可加 --force 覆盖，或换空目录）'
  );
  bootStep('把 .guardrails.json 的 level 保持为 lint-only（Agent 不得自行改档）');
} else {
  bootStep('填 TASK.md 的 SCOPE:MODIFY / SCOPE:CREATE 白名单（空着 = 任何改动都算越界）');
  bootStep('填 TASK.md 的验收标准（每条要能对应一条命令或明确的人工判定）');
  bootStep('核对 .gitignore 忽略了证据日志目录（本仓库的 var/）—— 否则第一次 verify 会因日志本身被判越界');
  if (!minimal) {
    bootStep('读代码后填 ARCHITECTURE.md 的目录地图与依赖方向（不要照抄模板示例）');
    bootStep('填 ROADMAP.md 的模块注册表与任务队列 —— 它是防偏移的锚，不能省');
    bootStep('把 AGENTS.md §0 的最小内联块贴进实际使用的工具（见 references/tool-integration.md）');
  }
  if (verifyMode === 'none') {
    bootStep(
      '把门禁接进**已有**的那个验证入口，不要新增第二条路径（路径以 .guardrails.json 为准）：',
      'node scripts/scope-check.mjs TASK.md',
      'node scripts/consistency-audit.mjs',
      '  ↑ 审计会自动读 .guardrails.json；手工带 --roadmap/--tasks/--evidence 仅作临时覆盖',
      '  ↑ 日常用 --report，收尾判失败'
    );
  } else {
    bootStep('核对 scripts/verify.sh|ps1 顶部的四条命令真实存在（否则验证会假通过）');
    if (taskDir !== TASK_DIR_TPL) {
      bootStep(`核对 .guardrails.json 的 tasks=${taskDir}（归档目录已改名，verify 会从配置读取）`);
    }
  }
  bootStep(
    '自测门禁（未经自测的护栏等于没有护栏）：',
    'node --test scripts/scope-check.test.mjs         → 期望全部 passed / 0 failed',
    'node --test scripts/consistency-audit.test.mjs   → 期望全部 passed / 0 failed',
    'node scripts/scope-check.mjs TASK.md             → 期望 exit 0',
    'node scripts/doctor.mjs                          → 只读体检（先看配置与路径那一行）',
    'node scripts/consistency-audit.mjs --report      → 路径以配置为准'
  );
}

console.log('\n下一步（必须做完再交给 LLM 干活）：');
bootSteps.forEach((s, i) => {
  console.log(`  ${i + 1}. ${s.title}`);
  s.details.forEach((d) => console.log(`       ${d}`));
});

if (minimal) {
  console.log(`
注意：--minimal 没有铺 AGENTS.md / CONSTITUTION.md。.agents/prompts/*.md 里第一行引用的
就是这两个文件，请按本仓库已有的规则文件（AGENTS.md / CLAUDE.md / docs/规范.md）改那一行引用，
否则 prompts 会指向不存在的文件。`);
}
