// 读取仓库根的 .guardrails.json，作为路径与文档小节的唯一声明源。
// CLI 参数仍可覆盖（手工调试用）；配置缺失时回退到既有默认值，保证老仓库不装配置也能跑。
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const DEFAULTS = {
  version: 1,
  level: 'full',
  stack: null,
  roadmap: 'ROADMAP.md',
  tasks: 'docs/tasks',
  evidence: 'var',
  taskFile: 'TASK.md',
  docSections: ['职责', '入口', '依赖', '对外接口'],
};

export const CONFIG_FILENAME = '.guardrails.json';

/** 从 root 读取配置；文件不存在或 JSON 坏时返回默认并标 source。 */
export function loadGuardrailsConfig(root = process.cwd()) {
  const abs = resolve(root);
  const file = join(abs, CONFIG_FILENAME);
  if (!existsSync(file)) {
    return { ...DEFAULTS, source: 'default', configFile: null, root: abs };
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return {
      ...DEFAULTS,
      source: 'invalid',
      configFile: file,
      root: abs,
      parseError: e.message,
    };
  }
  const merged = {
    ...DEFAULTS,
    ...pick(raw, Object.keys(DEFAULTS)),
    source: 'config',
    configFile: file,
    root: abs,
  };
  // 文档小节必须是非空字符串数组，否则审计会静默全跳过
  if (!Array.isArray(merged.docSections) || merged.docSections.some((s) => typeof s !== 'string' || !s.trim())) {
    merged.docSections = DEFAULTS.docSections;
    merged.docSectionsInvalid = true;
  }
  return merged;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (obj && typeof obj === 'object' && k in obj) out[k] = obj[k];
  }
  return out;
}

/** 打印一行生效配置，供诊断（路径假错误时先看这行）。 */
export function describeConfig(cfg) {
  const src = cfg.source === 'config' ? 'config' : cfg.source === 'invalid' ? 'invalid→default' : 'default';
  return `配置=${src}${cfg.configFile ? `(${cfg.configFile})` : ''} 档位=${cfg.level} 计划源=${cfg.roadmap} 归档=${cfg.tasks}/ 证据=${cfg.evidence}/ 任务卡=${cfg.taskFile}`;
}
