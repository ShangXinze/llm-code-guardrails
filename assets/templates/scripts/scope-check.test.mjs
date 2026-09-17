#!/usr/bin/env node
// scope-check 的自测：不需要 git，用 SCOPE_FILES 注入变更列表。
// 运行: node --test scripts/scope-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'scope-check.mjs');

const TASK = `# TASK.md

<!-- SCOPE:MODIFY:BEGIN -->
TASK.md
src/modules/order/
tests/order/
<!-- SCOPE:MODIFY:END -->

<!-- SCOPE:CREATE:BEGIN -->
src/modules/order/service.types.ts
<!-- SCOPE:CREATE:END -->

<!-- SCOPE:DENY:BEGIN -->
AGENTS.md
package-lock.json
.github/
<!-- SCOPE:DENY:END -->
`;

function run(files, taskText = TASK) {
  const dir = mkdtempSync(join(tmpdir(), 'scope-'));
  writeFileSync(join(dir, 'TASK.md'), taskText, 'utf8');
  return execFileSync(process.execPath, [script, 'TASK.md'], {
    cwd: dir,
    env: { ...process.env, SCOPE_FILES: files },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function code(files, taskText) {
  try {
    run(files, taskText);
    return 0;
  } catch (e) {
    return e.status;
  }
}

test('白名单内的修改通过', () => {
  assert.match(run('src/modules/order/service.ts,tests/order/original.test.ts'), /范围校验通过/);
});

test('白名单内的新增文件通过', () => {
  assert.equal(code('src/modules/order/service.types.ts'), 0);
});

test('DENY 文件被拦下', () => {
  assert.equal(code('AGENTS.md'), 1);
  assert.equal(code('.github/workflows/ci.yml'), 1);
});

test('白名单外文件被拦下', () => {
  assert.equal(code('src/other/foo.ts'), 1);
});

test('Windows 反斜杠路径也能识别', () => {
  assert.equal(code('src\\modules\\order\\service.ts'), 0);
});

test('缺少 SCOPE 声明块时报环境错误', () => {
  assert.equal(code('a.ts', '# 没有哨兵块的 TASK'), 2);
});

test('无变更时通过', () => {
  assert.match(run(''), /范围校验通过/);
});

// ── DENY 覆盖 CREATE/MODIFY 时的死信告警 ──────────────────────────
// DENY 优先，所以"DENY 写整目录 + 同目录下写 CREATE"里的 CREATE 是死信。
// 这类写法只在归档/新建文件那一步才暴露（症状是"我明明申报了还报禁止修改"），值得提前提示。

function runBoth(files, taskText = TASK) {
  const dir = mkdtempSync(join(tmpdir(), 'scope-'));
  writeFileSync(join(dir, 'TASK.md'), taskText, 'utf8');
  const r = spawnSync(process.execPath, [script, 'TASK.md'], {
    cwd: dir,
    env: { ...process.env, SCOPE_FILES: files },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

const DEAD_LETTER_TASK = `# TASK.md

<!-- SCOPE:MODIFY:BEGIN -->
TASK.md
crates/app/src/lib.rs
<!-- SCOPE:MODIFY:END -->

<!-- SCOPE:CREATE:BEGIN -->
docs/任务归档/
<!-- SCOPE:CREATE:END -->

<!-- SCOPE:DENY:BEGIN -->
docs/
<!-- SCOPE:DENY:END -->
`;

test('DENY 的整目录覆盖 CREATE → 打告警，但判定不变（仍按越界规则报）', () => {
  const r = runBoth('docs/任务归档/G-1-x.md,docs/使用手册.md', DEAD_LETTER_TASK);
  assert.match(r.stderr, /被 DENY 覆盖，等于死信/);
  assert.match(r.stderr, /docs\/任务归档\/（被 DENY 的目录项 docs\/ 覆盖/);
  assert.equal(r.status, 1); // 告警不改判定：docs/ 在 DENY 里，落盘仍然是禁止修改
  assert.match(r.stderr, /禁止修改（DENY）: docs\/任务归档\/G-1-x\.md/);
});

test('DENY 的 glob 项不与 MODIFY 误报重叠', () => {
  // `crates/*/Cargo.toml` 按字面量匹配，不覆盖 crates/ 整棵树 —— 拿它当目录前缀会假报
  const globTask = DEAD_LETTER_TASK.replace('docs/\n<!-- SCOPE:DENY:END -->', 'crates/*/Cargo.toml\n<!-- SCOPE:DENY:END -->');
  const r = runBoth('crates/app/src/lib.rs', globTask);
  assert.doesNotMatch(r.stderr, /死信/);
  assert.equal(r.status, 0, r.stderr);
});

// ── git 集成：路径编码 ────────────────────────────────────────────
// 非 ASCII 路径是中文项目的默认状态，而 `git status --porcelain` 默认把它们
// 引号包裹 + 八进制转义（"docs/\344\275\277..."）。只剥引号不还原转义，白名单就永远匹配不上。

function gitAvailable() {
  try {
    execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}
const hasGit = gitAvailable();

function makeUtf8Repo() {
  const dir = mkdtempSync(join(tmpdir(), 'scope-utf8-'));
  const gitIt = (...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'ignore', 'ignore'] });
  gitIt('init', '-q');
  gitIt('config', 'user.email', 'test@example.com');
  gitIt('config', 'user.name', 'test');
  mkdirSync(join(dir, 'docs'), { recursive: true });
  writeFileSync(join(dir, 'docs/使用手册.md'), 'v1\n', 'utf8');
  gitIt('add', '-A');
  gitIt('commit', '-qm', 'init');
  writeFileSync(join(dir, 'docs/使用手册.md'), 'v2\n', 'utf8');
  return { dir, gitIt };
}

function runInRepo(dir) {
  try {
    return {
      status: 0,
      out: execFileSync(process.execPath, [script, 'TASK.md'], { cwd: dir, encoding: 'utf8' }),
    };
  } catch (e) {
    return { status: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

test('git 非 ASCII 路径：在白名单内时通过', { skip: !hasGit && '本机无 git' }, () => {
  const { dir } = makeUtf8Repo();
  const task = TASK.replace('src/modules/order/', 'docs/');
  writeFileSync(join(dir, 'TASK.md'), task, 'utf8');
  const r = runInRepo(dir);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /范围校验通过/);
});

test('git 非 ASCII 路径：越界时错误信息是可读路径，不是八进制乱码', { skip: !hasGit && '本机无 git' }, () => {
  const { dir } = makeUtf8Repo();
  writeFileSync(join(dir, 'TASK.md'), TASK, 'utf8');
  const r = runInRepo(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /docs\/使用手册\.md/);
  assert.doesNotMatch(r.out, /\\3\d\d/);
});
