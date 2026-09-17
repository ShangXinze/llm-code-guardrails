#!/usr/bin/env bash
# 统一验证入口（Windows 上建议用 scripts/verify.ps1）。
# 用法: scripts/verify.sh [--fast|--full]
#   --fast : 范围门禁 + 一致性巡检(仅报告) + 格式 + lint + 类型   （每完成一步跑）
#   --full : 再加全量测试 + 一致性审计(判失败) + 门禁自测          （任务/模块收尾跑，默认）
set -euo pipefail

MODE="${1:---full}"

# ↓↓↓ 换技术栈时只改这一段（init_repo.mjs 已按 --stack 填好）↓↓↓
MANIFEST="{{MANIFEST}}"
CMD_FORMAT="{{CMD_FORMAT}}"
CMD_LINT="{{CMD_LINT}}"
CMD_TYPECHECK="{{CMD_TYPECHECK}}"
CMD_TEST="{{CMD_TEST}}"
# ↑↑↑ 以上四条命令必须真实存在，否则验证会假通过 ↑↑↑

# 路径与文档小节的唯一声明源是 .guardrails.json；下方变量是 init 写入的回退默认值。
# 审计脚本自己也会读同一份配置；这里显式传参是为了日志里能看出入口用的是哪组路径。
ROADMAP_REL="{{ROADMAP_REL}}"
TASKS_REL="{{TASKS_REL}}"
EVIDENCE_REL="{{EVIDENCE_REL}}"
if [ -f .guardrails.json ]; then
  cfg_get() {
    node -e "const fs=require('fs');const c=JSON.parse(fs.readFileSync('.guardrails.json','utf8'));const v=c[process.argv[1]];if(v)process.stdout.write(String(v))" "$1"
  }
  x="$(cfg_get roadmap)"; [ -n "$x" ] && ROADMAP_REL="$x"
  x="$(cfg_get tasks)"; [ -n "$x" ] && TASKS_REL="$x"
  x="$(cfg_get evidence)"; [ -n "$x" ] && EVIDENCE_REL="$x"
  x="$(cfg_get taskFile)"; [ -n "$x" ] && TASK_FILE="$x"
fi
TASK_FILE="${TASK_FILE:-TASK.md}"
AUDIT_ARGS=(--roadmap "$ROADMAP_REL" --tasks "$TASKS_REL" --evidence "$EVIDENCE_REL")
echo "guardrails: 计划源=$ROADMAP_REL 归档=$TASKS_REL/ 证据=$EVIDENCE_REL/ 任务卡=$TASK_FILE"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
mkdir -p var
LOG="var/verify-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1
echo "verify mode=$MODE root=$ROOT log=$LOG"

command -v node >/dev/null 2>&1 || { echo "前置检查失败：缺少 node（scope-check / consistency-audit 需要）"; exit 2; }
[ -e "$MANIFEST" ] || { echo "前置检查失败：找不到 $MANIFEST，验证会假通过，请先修正命令"; exit 2; }

step() {
  echo "== $1 =="
  eval "$2" || { echo "FAILED: $1 -> $2"; exit 1; }
}

# 门禁与审计始终在最前：范围不对、结构不一致，后面跑再多测试也没意义
step scope-check "node scripts/scope-check.mjs $TASK_FILE"
if [ -f scripts/consistency-audit.mjs ]; then
  if [ "$MODE" = "--full" ]; then
    step consistency-audit "node scripts/consistency-audit.mjs ${AUDIT_ARGS[*]}"
  else
    step consistency-audit-report "node scripts/consistency-audit.mjs ${AUDIT_ARGS[*]} --report"
  fi
fi

step format "$CMD_FORMAT"
step lint "$CMD_LINT"
step typecheck "$CMD_TYPECHECK"

if [ "$MODE" = "--full" ]; then
  step test "$CMD_TEST"
  for t in scope-check consistency-audit; do
    [ -f "scripts/$t.test.mjs" ] && step "gate-self-test:$t" "node --test scripts/$t.test.mjs"
  done
else
  echo "== test (fast 模式跳过) =="
  echo "提醒：请已运行与本次改动相关的测试；任务收尾必须跑 --full。"
fi

echo "verify OK ($MODE) — 日志: $LOG"
