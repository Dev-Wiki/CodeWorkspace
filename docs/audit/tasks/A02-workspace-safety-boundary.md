# Audit Task A02 — `工作区路径与脏状态安全边界`

> **职责**：本文件定义本轮要扫描什么，不保存最终 Finding 正文。执行证据写入 [对应 Result](../results/A02-workspace-safety-boundary.md)，全局 Finding 写入 [Findings.md](../Findings.md)，运行状态写入 [Dashboard.md](../Dashboard.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)
- [Task Result](../results/A02-workspace-safety-boundary.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run | `codews-20260819-705aff0` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Task Status | `completed` |

## Scope

- **Behavior domain**: smart root inference、仓库路径解析、嵌套仓识别、脏状态扫描以及 `--force`/`--stash` 预处理。
- **In-scope paths**: `src/cli.js:9-32`, `src/git.js:11-74`，以及 A01 产出的 workspace 数据。
- **Audit questions**: 所有 mutation target 是否受 workspace root 约束；预检是否真实把工作区变为可切换状态；缺失/嵌套仓是否有错误旁路。

## Why This Scope Exists

- [AGENTS §4–7](../../../AGENTS.md) 将路径、reset 和配置派生目标标为高风险边界；项目自述以脏状态阻断作为主要安全承诺。

## Entry Points

- `src/cli.js:9` — workspaceRoot 推断。
- `src/git.js:22` — dirty status 过滤。
- `src/git.js:42` — 所有仓库写操作前的预检。

## Important Boundaries

| Boundary | This Side | Other Side | Related Task |
|---|---|---|---|
| config path → absolute path | A01 producer | A02/A03 filesystem owner | [A01](A01-configuration-resolution.md), [A03](A03-switch-execution-lifecycle.md) |
| preflight → mutation | dirty checker | checkout executor | [A03](A03-switch-execution-lifecycle.md) |

## Exclusions

- clone/fetch/checkout 细节和跨仓失败回滚由 A03 负责。

## Evidence

### Partition Evidence

- `AGENTS.md` 高风险目录与代码安全规范 → `src/cli.js:9-32`, `src/git.js:22-74`。

### Evidence Strategy

1. 搜索 workspaceRoot/repoPath 的全部构造和消费者。
2. 跟踪 config.path 到 `path.resolve`、Git cwd 与文件删除边界。
3. 检查 containment guard、reset/stash 后复检、嵌套仓例外与错误路径。
4. 在 `/tmp` 受控 Git 仓库中做非破坏或可回收探针。

### Required Counter-evidence

- 路径 containment 校验、Git top-level 身份校验、force 后 clean/recheck、下游执行前二次校验。

## Dependencies / Related Tasks

- **Depends on**: A01 的 workspace 字段数据流
- **Provides to**: A03, cross-module review
- **Open questions**: A03 是否对 A02 放行的目标再次确认所有权和干净状态？

## Completion Gate

- [x] Planned scope and exclusions are accounted for.
- [x] Result records actual coverage, Evidence and gaps.
- [x] Candidates follow the Finding state contract.
- [x] Boundary inputs are ready for cross-module reconciliation.
- [x] Snapshot remains valid at checkpoint.
