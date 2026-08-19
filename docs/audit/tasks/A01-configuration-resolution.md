# Audit Task A01 — `配置发现与继承`

> **职责**：本文件定义本轮要扫描什么，不保存最终 Finding 正文。执行证据写入 [对应 Result](../results/A01-configuration-resolution.md)，全局 Finding 写入 [Findings.md](../Findings.md)，运行状态写入 [Dashboard.md](../Dashboard.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)
- [Task Result](../results/A01-configuration-resolution.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run | `codews-20260819-705aff0` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Task Status | `completed` |

## Scope

- **Behavior domain**: 环境名解析、本地/全局配置发现、递归 base 继承、override/ignore 合并和配置枚举。
- **In-scope paths**: `src/config.js` 及 `src/cli.js` 的 load/list/show/switch 调用端。
- **Audit questions**: 缺失或循环 base 是否 fail closed；配置来源和路径是否局限在声明边界；覆盖语义是否能产生静默部分工作区。

## Why This Scope Exists

- [AGENTS §3](../../../AGENTS.md) 将配置发现和继承归属 `src/config.js`；核心调用链由 [AGENTS §1](../../../AGENTS.md) 绑定到 `loadConfig → getResolvedWorkspace`。

## Entry Points

- `src/config.js:5` — 环境名到配置路径的入口。
- `src/config.js:29` — base 继承和 repos 合并入口。
- `src/config.js:81` — list 的本地/全局枚举入口。
- `src/cli.js:41`, `73`, `91`, `109` — 四类消费者。

## Important Boundaries

| Boundary | This Side | Other Side | Related Task |
|---|---|---|---|
| resolved workspace | config producer | CLI/Git consumers | [A02](A02-workspace-safety-boundary.md), [A03](A03-switch-execution-lifecycle.md) |
| config trust | filesystem JSON | command/path sinks | [A02](A02-workspace-safety-boundary.md), [A03](A03-switch-execution-lifecycle.md) |

## Exclusions

- Git 写操作和失败回滚由 A03 负责；状态格式由 A04 负责。

## Evidence

### Partition Evidence

- `AGENTS.md` 的架构边界、高风险文件和信任模型待确认项 → `src/config.js:5-114`。

### Evidence Strategy

1. 搜索所有 config producer/consumer 与递归入口。
2. 跟踪 env/base/repos/path/branch/commit/depth/post_hooks 的完整数据流。
3. 检查缺失文件、循环、解析失败、重复与旁路实现。
4. 必要时在 `/tmp` 用最小 JSON 探针观察纯配置解析行为。

### Required Counter-evidence

- 配置 schema、循环保护、缺失 base 阻断、调用端二次校验、等价解析实现和现有测试。

## Dependencies / Related Tasks

- **Depends on**: none
- **Provides to**: A02, A03, A04, cross-module review
- **Open questions**: 下游是否会在执行前弥补配置层未验证的路径和目标字段？

## Completion Gate

- [x] Planned scope and exclusions are accounted for.
- [x] Result records actual coverage, Evidence and gaps.
- [x] Candidates follow the Finding state contract.
- [x] Boundary inputs are ready for cross-module reconciliation.
- [x] Snapshot remains valid at checkpoint.
