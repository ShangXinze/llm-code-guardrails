#!/usr/bin/env node
// doctor.mjs 自测：不依赖真实仓库结构，用临时目录造最小场景。
// 运行: node --test scripts/doctor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'doctor.mjs');
const configLoader = join(here, 'guardrails-config.mjs');
const scopeCheck = join(here, 'scope-check.mjs');

function readSelf(p) {
  return readFileSync(p, 'utf8');
}

function seed(dir, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
}

function runDoctor(dir) {
  try {
    const stdout = execFileSync(process.execPath, [script, '--root', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: String(e.stdout ?? '') };
  }
}

test('无配置时回退默认并给 warn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'));
  seed(dir, {
    'scripts/guardrails-config.mjs': readSelf(configLoader),
    'scripts/scope-check.mjs': readSelf(scopeCheck),
    'scripts/doctor.mjs': readSelf(script),
  });
  const r = runDoctor(dir);
  assert.match(r.stdout, /配置=default/);
  assert.match(r.stdout, /未找到 \.guardrails\.json/);
});

test('完整配置 + 路径齐全时 config 为 ok 且 exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'));
  seed(dir, {
    '.guardrails.json': JSON.stringify(
      {
        version: 1,
        level: 'scope-only',
        roadmap: 'ROADMAP.md',
        tasks: 'docs/tasks',
        evidence: 'var',
        taskFile: 'TASK.md',
      },
      null,
      2
    ),
    'TASK.md': '# t\n',
    'ROADMAP.md': '# r\n',
    'docs/tasks/.keep': '',
    'scripts/guardrails-config.mjs': readSelf(configLoader),
    'scripts/scope-check.mjs': readSelf(scopeCheck),
  });
  const r = runDoctor(dir);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /配置=config/);
  assert.match(r.stdout, /✓ config/);
});

test('JSON 无效时 error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'));
  seed(dir, {
    '.guardrails.json': '{ not json',
    'scripts/guardrails-config.mjs': readSelf(configLoader),
    'scripts/scope-check.mjs': readSelf(scopeCheck),
  });
  const r = runDoctor(dir);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /JSON 无效/);
});

test('lint-only 不要求门禁', () => {
  const dir = mkdtempSync(join(tmpdir(), 'doc-'));
  seed(dir, {
    '.guardrails.json': JSON.stringify({ version: 1, level: 'lint-only' }, null, 2),
    'scripts/guardrails-config.mjs': readSelf(configLoader),
  });
  const r = runDoctor(dir);
  assert.match(r.stdout, /档位=lint-only/);
  assert.match(r.stdout, /✓ gates/);
});
