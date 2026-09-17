# 模块：<name>

> 最后核验日期：{{DATE}}。文档与代码不符视为 bug，请立即修正或在 `TASK.md` 记录。
> 本文件只写局部判断，不要抄代码、不要抄 `ARCHITECTURE.md` 已有的内容。

## 职责

一到三句话，只说"这个模块负责什么"。

## 入口

- `src/modules/<name>/index.ts`

## 依赖

- `modules/xxx`
- `infra/db`
- `shared/validation`

## 数据流

```
请求 -> <name>.controller -> <name>.service -> <name>.repository -> DB
```

## 对外接口

```
createXxx(input: CreateXxxInput): Promise<Xxx>
getXxx(id: string): Promise<Xxx | null>
```

## 测试命令

```bash
npm test -- <name>
```

## 非目标

- 不处理 ……
- 不处理 ……

## 已知约束 / 坑

- （为什么这么写、哪个调用顺序不能改、哪个字段有历史包袱）
