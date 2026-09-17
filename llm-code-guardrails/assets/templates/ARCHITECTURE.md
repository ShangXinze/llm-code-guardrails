# ARCHITECTURE.md — {{PROJECT}}

> 最后核验日期：{{DATE}}。文档与代码不符视为 bug。
> 本文件 ≤ 200 行。目录地图能用脚本生成就不要手写；手写部分只保留"判断"，不抄代码细节。
> 模块清单与状态不在本文件维护 —— 唯一权威是 `ROADMAP.md` 的模块注册表。

## 1. 系统边界

本系统负责：

- （一句话一件事）

本系统不负责：

- （明确写出手上不管的部分，防止 LLM 越界补功能）

## 2. 目录地图

```
src/
├── entry/          # 入口，只做参数解析与依赖组装
├── modules/        # 按业务能力划分（每个模块一份 README，登记在 ROADMAP 模块注册表）
│   ├── <module-a>/
│   └── <module-b>/
├── shared/         # 稳定、无业务、纯工具
└── infra/          # 数据库、外部 API、消息队列
```

（按真实结构改写，不要保留示例。）

## 3. 依赖方向

```
entry -> modules -> shared
modules -> infra
infra -> 外部服务
```

禁止反向依赖，禁止循环依赖，跨模块必须走对方公开入口。
模块级依赖在 `ROADMAP.md` 的模块注册表声明，由 `scripts/consistency-audit.mjs` 检查。

## 4. 核心数据流

```
请求 -> 入口校验 -> 应用服务 -> 领域逻辑 -> 仓储/外部 API -> 响应
```

（用真实函数名或文件名替换，让 Agent 能顺着走一遍。）

## 5. 关键模块

> 只写"最容易踩错"的模块，全量清单看 `ROADMAP.md`。每行给出模块文档路径。

| 模块 | 职责 | 入口 | 文档 |
|---|---|---|---|
| <module-a> | 一句话 | `modules/<module-a>/index.*` | `docs/modules/<module-a>.md` |

## 6. 外部依赖

- 数据库：
- 缓存：
- 第三方 API：
- 消息队列：

## 7. 跨模块契约与术语

- 契约索引：`docs/contracts/README.md`（接口、数据模型、错误码、事件）
- 术语表与命名风格：`docs/contracts/glossary.md`（一个概念一个名字）

## 8. 运行与验证

```bash
安装：
运行：
测试：
快速验证：scripts/verify.ps1 -Mode fast     # Windows；其他平台 scripts/verify.sh --fast
全量验证：scripts/verify.ps1                 # 任务/模块收尾必须跑
一致性审计：node scripts/consistency-audit.mjs --tasks {{TASKS_REL}}   # 路径参数与 verify.* 顶部一致
```

## 9. 关键决策

见 `docs/decisions/`（含索引与 ADR 触发判据）。
