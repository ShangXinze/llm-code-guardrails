#!/usr/bin/env node
// 范围锁执行器：把 TASK.md 里声明的白名单与当前工作区变更做差集，越界即失败。
//
// 用法:
//   node scripts/scope-check.mjs [TASK.md]
//   SCOPE_FILES="a.ts,b.ts" node scripts/scope-check.mjs      # 显式指定变更列表（自测 / CI）
//
// 退出码: 0 = 通过, 1 = 越界, 2 = 环境或配置问题
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadGuardrailsConfig } from './guardrails-config.mjs';

const argv = process.argv.slice(2);
const filesFlag = argv.find((a) => a.startsWith('--files='));
const cfg = loadGuardrailsConfig(process.cwd());
const taskFile = argv.find((a) => !a.startsWith('--')) ?? cfg.taskFile;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

let root;
try {
  root = git(['rev-parse', '--show-toplevel']).trim() || process.cwd();
} catch {
  root = process.cwd();
}
process.chdir(root);

let text;
try {
  text = readFileSync(taskFile, 'utf8');
} catch {
  console.error(`scope-check: 读不到 ${taskFile}`);
  process.exit(2);
}

function section(name) {
  const re = new RegExp(
    `<!--\\s*SCOPE:${name}:BEGIN\\s*-->([\\s\\S]*?)<!--\\s*SCOPE:${name}:END\\s*-->`,
    'i'
  );
  const hit = text.match(re);
  if (!hit) return null;
  return hit[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('<!--'));
}

const modify = section('MODIFY');
const create = section('CREATE') ?? [];
const deny = section('DENY');

if (modify === null || deny === null) {
  console.error(`scope-check: ${taskFile} 缺少 SCOPE:MODIFY 或 SCOPE:DENY 声明块。`);
  process.exit(2);
}

function unquote(s) {
  return s.replace(/^"|"$/g, '');
}
function norm(s) {
  return s
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}
function hit(path, list) {
  return list.some((raw) => {
    const x = norm(raw);
    if (x.endsWith('/**')) return path === x.slice(0, -3) || path.startsWith(x.slice(0, -2));
    if (x.endsWith('*')) return path.startsWith(x.slice(0, -1));
    return path === x || path.startsWith(x + '/');
  });
}

function changedFiles() {
  const explicit = process.env.SCOPE_FILES ?? (filesFlag ? filesFlag.slice('--files='.length) : null);
  if (explicit !== null) {
    return explicit
      .split(',')
      .map((s) => norm(unquote(s.trim())))
      .filter(Boolean);
  }
  let status;
  try {
    // 必须带 -z：NUL 分隔且**不做引号与八进制转义**。
    // 默认输出会把非 ASCII 路径写成 "docs/\344\275\277\347\224\250..."，只剥外层引号而不还原转义，
    // 中文文件名就变成乱码路径，白名单永远匹配不上 —— 中文项目必踩。
    status = git(['status', '--porcelain', '-z']);
  } catch {
    console.error('scope-check: 取不到 git 变更列表（不是仓库或未安装 git）。');
    console.error('  本地调试可用 SCOPE_FILES="a.ts,b.ts" 显式传入。');
    process.exit(2);
  }
  const files = [];
  const tokens = status.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i];
    if (!line) continue;
    const xy = line.slice(0, 2);
    // -z 格式：`XY <路径>`，重命名/复制时下一个 token 是原路径。
    files.push(norm(line.slice(3)));
    if (xy.includes('R') || xy.includes('C')) {
      const original = tokens[++i];
      if (original) files.push(norm(original));
    }
  }
  return files;
}

const changed = [...new Set(changedFiles())];

// TASK.md 自身必须可写（Agent 每步都要更新它），所以它不能被门禁拦住。
// 代价是：Agent 理论上能靠改 TASK.md 给自己扩权 —— 因此这里必须显式提醒人类去看这份 diff。
if (changed.includes(norm(taskFile))) {
  console.warn(`注意：${taskFile} 自身被修改 —— 请人工核对白名单有没有被擅自扩大。`);
}

// DENY 优先于 CREATE/MODIFY（见下面的判定顺序）。于是"DENY 写整目录 + 同一目录下写 CREATE"
// 会让那些 CREATE 项变成**死信**：写进去了却永远不可能放行，症状是"我明明申报了还报禁止修改"。
// 只提示、不改判定 —— 白名单写法有问题应当被暴露，而不是被脚本悄悄改写成"能过"。
// 只比较非通配项：`crates/*/Cargo.toml` 这类 glob 按字面量匹配，并不覆盖 `crates/` 整棵树，
// 拿它当目录前缀会误报（实测：MODIFY `crates/example-core/src/lib.rs` 会被误判重叠）。
const dirish = (raw) => {
  const s = String(raw).trim();
  if (s.endsWith('/')) return true; // 填写规则：目录以 / 结尾
  const last = norm(s).split('/').pop() ?? '';
  return last !== '' && !last.includes('.'); // 无扩展名的项同样按目录语义覆盖其子树
};
const covers = (dirEntry, other) => {
  const d = norm(dirEntry);
  const o = norm(other);
  return o === d || o.startsWith(d + '/') || d.startsWith(o + '/');
};
const deadLetters = [];
for (const claimed of [...create, ...modify]) {
  if (String(claimed).includes('*')) continue;
  for (const denied of deny) {
    if (String(denied).includes('*') || !dirish(denied)) continue;
    if (covers(denied, claimed)) {
      deadLetters.push(`${claimed}（被 DENY 的目录项 ${denied} 覆盖 → DENY 优先，它永远不会被放行）`);
    }
  }
}
if (deadLetters.length) {
  console.warn(`警告：白名单里有 ${deadLetters.length} 项被 DENY 覆盖，等于死信（判定不变，仅提示）：`);
  deadLetters.forEach((d) => console.warn(`  - ${d}`));
  console.warn(
    '  改法：把 DENY 里的整目录收窄成具体文件（`docs/` → `docs/使用手册.md`），不要指望 CREATE 能翻案。'
  );
}

const violations = [];
for (const file of changed) {
  if (hit(file, deny)) {
    violations.push(`禁止修改（DENY）: ${file}`);
    continue;
  }
  if (hit(file, create) || hit(file, modify)) continue;
  violations.push(`越界（不在 MODIFY / CREATE 白名单）: ${file}`);
}

if (violations.length) {
  console.error('范围校验失败：');
  violations.forEach((v) => console.error('  - ' + v));
  console.error('处理方式：停止修改，在 TASK.md 写「范围变更请求」（原因 / 文件 / 风险），等待人类确认。');
  process.exit(1);
}

console.log(`范围校验通过：${changed.length} 个变更文件均在白名单内。`);
