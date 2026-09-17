# 统一验证入口（Windows）。用法: scripts\verify.ps1 [-Mode fast|full]
#   fast : 范围门禁 + 一致性巡检(仅报告) + 格式 + lint + 类型   （每完成一步跑）
#   full : 再加全量测试 + 一致性审计(判失败) + 门禁自测          （任务/模块收尾跑，默认）
param([ValidateSet('fast', 'full')][string]$Mode = 'full')

$ErrorActionPreference = 'Stop'

# ↓↓↓ 换技术栈时只改这一段（init_repo.mjs 已按 --stack 填好）↓↓↓
$MANIFEST = '{{MANIFEST}}'
$cmdFormat = '{{CMD_FORMAT}}'
$cmdLint = '{{CMD_LINT}}'
$cmdTypecheck = '{{CMD_TYPECHECK}}'
$cmdTest = '{{CMD_TEST}}'
# ↑↑↑ 以上四条命令必须真实存在，否则验证会假通过 ↑↑↑

# 路径的唯一声明源是 .guardrails.json；下方变量是 init 写入的回退默认值。
$ROADMAP_REL = '{{ROADMAP_REL}}'
$TASKS_REL = '{{TASKS_REL}}'
$EVIDENCE_REL = '{{EVIDENCE_REL}}'
$TASK_FILE = 'TASK.md'
if (Test-Path '.guardrails.json') {
  $cfg = Get-Content '.guardrails.json' -Raw | ConvertFrom-Json
  if ($cfg.roadmap) { $ROADMAP_REL = [string]$cfg.roadmap }
  if ($cfg.tasks) { $TASKS_REL = [string]$cfg.tasks }
  if ($cfg.evidence) { $EVIDENCE_REL = [string]$cfg.evidence }
  if ($cfg.taskFile) { $TASK_FILE = [string]$cfg.taskFile }
}
$auditArgs = "--roadmap `"$ROADMAP_REL`" --tasks `"$TASKS_REL`" --evidence `"$EVIDENCE_REL`""
Write-Host "guardrails: 计划源=$ROADMAP_REL 归档=$TASKS_REL/ 证据=$EVIDENCE_REL/ 任务卡=$TASK_FILE"

$root = (git rev-parse --show-toplevel 2>$null)
if (-not $root) { $root = (Get-Location).Path }
Set-Location $root
# 证据日志必须落在配置声明的 evidence 目录（与 consistency-audit 同一路径）
if (-not $EVIDENCE_REL) { $EVIDENCE_REL = 'var' }
New-Item -ItemType Directory -Force -Path $EVIDENCE_REL | Out-Null
$log = Join-Path $EVIDENCE_REL "verify-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
Write-Host "verify mode=$Mode root=$root log=$log"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '前置检查失败：缺少 node（scope-check / consistency-audit 需要）'; exit 2
}
if (-not (Test-Path $MANIFEST)) {
  Write-Host "前置检查失败：找不到 $MANIFEST，验证会假通过，请先修正命令"; exit 2
}

# 注意：步骤执行期间必须用 Continue。PowerShell 5.1 在 ErrorActionPreference=Stop 下，
# 子进程写 stderr 会被当成终止性错误抛出，导致正常失败被误报成脚本异常。
$ErrorActionPreference = 'Continue'

function Invoke-Step([string]$name, [string]$cmd) {
  Write-Host "== $name =="
  $output = Invoke-Expression $cmd 2>&1
  $code = $LASTEXITCODE
  if ($null -ne $output) { $output | Tee-Object -FilePath $log -Append }
  if ($code -ne 0) { Write-Host "FAILED: $name -> $cmd"; exit 1 }
}

# 门禁与审计始终在最前：范围不对、结构不一致，后面跑再多测试也没意义
Invoke-Step 'scope-check' "node scripts/scope-check.mjs $TASK_FILE"
if (Test-Path 'scripts/consistency-audit.mjs') {
  if ($Mode -eq 'full') {
    Invoke-Step 'consistency-audit' "node scripts/consistency-audit.mjs $auditArgs"
  } else {
    Invoke-Step 'consistency-audit-report' "node scripts/consistency-audit.mjs $auditArgs --report"
  }
}

Invoke-Step 'format' $cmdFormat
Invoke-Step 'lint' $cmdLint
Invoke-Step 'typecheck' $cmdTypecheck

if ($Mode -eq 'full') {
  Invoke-Step 'test' $cmdTest
  foreach ($t in @('scope-check', 'consistency-audit')) {
    if (Test-Path "scripts/$t.test.mjs") { Invoke-Step "gate-self-test:$t" "node --test scripts/$t.test.mjs" }
  }
} else {
  Write-Host '== test (fast 模式跳过) =='
  Write-Host '提醒：请已运行与本次改动相关的测试；任务收尾必须跑 full。'
}

Write-Host "verify OK ($Mode) — 日志: $log"
