#!/usr/bin/env node
// 只读体检：在不改任何文件的前提下，回答「这套护栏现在能不能用、卡在哪」。
//
// 用法:
//   node scripts/doctor.mjs [--root <目录>] [--json]
// 退出码: 0 = 通过（可有 warn），1 = 有 error，2 = 环境无法评估
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadGuardrailsConfig, describeConfig, CONFIG_FILENAME } from './guardrails-config.mjs';

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
const AS_JSON = flagValue('json', false) === true;

const results = [];
function ok(name, note) {
  results.push({ name, level: 'ok', items: note ? [note] : [] });
}
function warn(name, items) {
  results.push({ name, level: items.length ? 'warn' : 'ok', items });
}
function fail(name, items) {
  results.push({ name, level: items.length ? 'error' : 'ok', items });
}

function run(cmd, cmdArgs, opts = {}) {
  // 不要对带空格的绝对路径（如 ...\Xiaomi MiMo\...\node.exe）开 shell:true：
  // Windows 下会被按空格拆开，表现为「不是内部或外部命令」，自测全假红。
  return spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    ...opts,
  });
}

function hasCmd(name) {
  try {
    const r = spawnSync(name, ['--version'], { encoding: 'utf8', shell: true });
    return r.status === 0;
  } catch {
    return false;
  }
}

// ── 1. 配置 ──────────────────────────────────────────────────────
const cfg = loadGuardrailsConfig(ROOT);
if (cfg.source === 'invalid') {
  fail('config', [`${cfg.configFile} JSON 无效：${cfg.parseError}`]);
} else if (cfg.source === 'default') {
  warn('config', [
    `未找到 ${CONFIG_FILENAME}（使用默认路径：${cfg.roadmap} / ${cfg.tasks} / ${cfg.evidence}）`,
    '若仓库用了本地化目录名，请让 init_repo 生成配置，避免审计假错误',
  ]);
} else {
  ok('config', describeConfig(cfg));
}
if (cfg.docSectionsInvalid) {
  warn('docSections', ['docSections 非法，已回退默认中文小节名']);
}

const LEVEL = String(cfg.level || 'full');
const expectGates = LEVEL !== 'lint-only';

// ── 2. 门禁脚本与自测 ────────────────────────────────────────────
if (expectGates) {
  const required = ['scripts/scope-check.mjs', 'scripts/guardrails-config.mjs'];
  if (LEVEL !== 'scope-only') required.push('scripts/consistency-audit.mjs');
  const missing = required.filter((g) => !existsSync(join(ROOT, g)));
  if (missing.length) fail('gates', missing.map((m) => `缺少 ${m}`));
  else if (LEVEL === 'scope-only' && !existsSync(join(ROOT, 'scripts/consistency-audit.mjs'))) {
    ok('gates', 'scope-check / guardrails-config 均在（scope-only 不强制审计）');
  } else {
    ok('gates', 'scope-check / consistency-audit / guardrails-config 均在');
  }

  const tests = ['scripts/scope-check.test.mjs'];
  if (LEVEL !== 'scope-only') tests.push('scripts/consistency-audit.test.mjs');
  for (const t of tests) {
    if (!existsSync(join(ROOT, t))) {
      warn('self-test', [`${t} 不存在（未经自测的护栏等于没有护栏）`]);
      continue;
    }
    const r = run(process.execPath, ['--test', t]);
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // 兼容 node --test 的两种汇总格式：旧版 `# pass 9`、新版 `ℹ pass 9`
    const passed = /(?:#|ℹ)\s*pass\s+(\d+)/.exec(out);
    const failed = /(?:#|ℹ)\s*fail\s+(\d+)/.exec(out);
    const nPass = passed ? Number(passed[1]) : -1;
    const nFail = failed ? Number(failed[1]) : -1;
    if (r.status === 0 && nFail === 0) ok('self-test', `${t}: ${nPass} passed / 0 failed`);
    else fail('self-test', [`${t}: exit=${r.status} pass=${nPass} fail=${nFail}`]);
  }
} else {
  ok('gates', '档位=lint-only，不检查门禁脚本');
}

// ── 3. 规则路径是否落地 ──────────────────────────────────────────
const pathIssues = [];
const pathNotes = [];
if (LEVEL === 'full' || LEVEL === 'minimal' || LEVEL === 'scope-only') {
  if (!existsSync(join(ROOT, cfg.roadmap))) {
    if (LEVEL === 'scope-only') warn('paths', [`${cfg.roadmap} 不存在（scope-only 可暂缓，但 ROADMAP 仍是防偏移锚）`]);
    else pathIssues.push(`计划源不存在：${cfg.roadmap}`);
  } else {
    pathNotes.push(`计划源 ok：${cfg.roadmap}`);
  }
  if (!existsSync(join(ROOT, cfg.taskFile))) pathIssues.push(`任务卡不存在：${cfg.taskFile}`);
  else pathNotes.push(`任务卡 ok：${cfg.taskFile}`);
  if (LEVEL !== 'scope-only' && !existsSync(join(ROOT, cfg.tasks))) {
    pathIssues.push(`归档目录不存在：${cfg.tasks}/`);
  } else if (existsSync(join(ROOT, cfg.tasks))) {
    pathNotes.push(`归档 ok：${cfg.tasks}/`);
  }
  if (pathIssues.length) fail('paths', pathIssues);
  else ok('paths', pathNotes.join('；') || '路径齐全');
}

// ── 4. git ───────────────────────────────────────────────────────
if (hasCmd('git')) {
  const r = run('git', ['rev-parse', '--is-inside-work-tree']);
  if (r.status === 0 && String(r.stdout).trim() === 'true') ok('git', '在 git 工作树内');
  else warn('git', ['git 可用，但当前目录不是工作树（scope-check 将用 SCOPE_FILES 或报环境错）']);
} else {
  warn('git', ['未检测到 git；scope-check 无法读变更列表，需 SCOPE_FILES 显式注入']);
}

// ── 5. node ──────────────────────────────────────────────────────
ok('node', process.version);

// ── 6. verify 入口与命令 ─────────────────────────────────────────
const verifySh = existsSync(join(ROOT, 'scripts/verify.sh'));
const verifyPs1 = existsSync(join(ROOT, 'scripts/verify.ps1'));
if (verifySh || verifyPs1) {
  ok('verify', `verify 入口：${[verifySh && 'verify.sh', verifyPs1 && 'verify.ps1'].filter(Boolean).join(' / ')}`);
} else if (LEVEL === 'lint-only') {
  ok('verify', '档位=lint-only，不要求 verify.*');
} else {
  warn('verify', ['无 scripts/verify.*；若已有 check.sh/Makefile，请确认门禁已接入既有入口']);
}

// 校验入口里声明的 manifest（避免假通过）
for (const vf of ['scripts/verify.sh', 'scripts/verify.ps1']) {
  const abs = join(ROOT, vf);
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, 'utf8');
  const m = /MANIFEST\s*=\s*["']?([^"'\n\r]+)["']?/.exec(text);
  const manifest = m?.[1]?.trim();
  if (manifest && !manifest.startsWith('{{') && !existsSync(join(ROOT, manifest))) {
    fail('verify-manifest', [`${vf} 声明 MANIFEST=${manifest}，但文件不存在（验证会假通过）`]);
  }
}

// ── 7. .gitignore 忽略证据目录 ───────────────────────────────────
if (expectGates && existsSync(join(ROOT, '.gitignore'))) {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  const ev = cfg.evidence.replace(/\/+$/, '');
  if (!gi.split('\n').some((l) => l.trim() === ev || l.trim() === `${ev}/` || l.trim() === `${ev}/*`)) {
    warn('gitignore', [`.gitignore 未忽略证据目录 ${ev}/ —— 第一次 verify 可能被范围锁判成越界`]);
  } else {
    ok('gitignore', `证据目录 ${ev}/ 已忽略`);
  }
}

// ── 8. 档位与人类确认提示 ────────────────────────────────────────
const next = [];
if (LEVEL === 'full' && !existsSync(join(ROOT, 'CONSTITUTION.md'))) {
  next.push('人类签字：CONSTITUTION.md 条款与 ROADMAP 模块注册表（Agent 不得代填后静默开工）');
}
if (LEVEL === 'full' && existsSync(join(ROOT, 'ROADMAP.md'))) {
  const rm = readFileSync(join(ROOT, 'ROADMAP.md'), 'utf8');
  if (/MODULES:BEGIN[\s\S]*?M0\s*\|/.test(rm) && !/\|\s*-\s*$/m.test(rm) === false) {
    /* noop, keep simple */
  }
  if (/^\|?\s*M0\s*\|\s*src\/\s*\|/m.test(rm) || /阶段 1：（填）/.test(rm)) {
    next.push('ROADMAP.md 仍是模板占位内容，需人类填模块与队列');
  }
}
if (next.length) warn('next', next);

// ── 汇总 ─────────────────────────────────────────────────────────
const errors = results.filter((r) => r.level === 'error');
const warns = results.filter((r) => r.level === 'warn');

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        root: ROOT,
        level: LEVEL,
        config: { ...cfg, docSections: undefined },
        results,
        errors: errors.length,
        warns: warns.length,
      },
      null,
      2
    )
  );
} else {
  console.log(`doctor  root=${ROOT}`);
  console.log(`  ${describeConfig(cfg)}`);
  for (const r of results) {
    const mark = r.level === 'ok' ? '✓' : r.level === 'warn' ? '⚠' : '✗';
    console.log(`${mark} ${r.name}${r.items.length ? `  (${r.items.length})` : ''}`);
    if (r.level !== 'ok') r.items.forEach((i) => console.log(`    - ${i}`));
  }
  console.log(`\n结果：${errors.length} error / ${warns.length} warn`);
  if (errors.length) {
    console.log('处理：先修 error。路径类问题优先核对 .guardrails.json，不要改审计默认值或放宽规则。');
  } else if (warns.length) {
    console.log('警告已列出；能修的修掉，暂时不能修的在任务卡「未决问题」写明。');
  } else {
    console.log('护栏体检通过，可交给 Agent 按 TASK.md 开工。');
  }
}

if (errors.length) process.exit(1);
