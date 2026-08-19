# Audit Task A04 — `状态展示与运行契约`

> **职责**：本文件定义本轮要扫描什么，不保存最终 Finding 正文。执行证据写入 [对应 Result](../results/A04-status-runtime-contracts.md)，全局 Finding 写入 [Findings.md](../Findings.md)，运行状态写入 [Dashboard.md](../Dashboard.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)
- [Task Result](../results/A04-status-runtime-contracts.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run | `codews-20260819-705aff0` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Task Status | `completed` |

## Scope

- **Behavior domain**: Commander action 的错误/成功语义，list/show/status/status -e、switch summary、版本来源和 package 验证契约。
- **In-scope paths**: `bin/codews.js`, `src/cli.js`, `src/git.js:179-275`, `package.json`。
- **Audit questions**: 输出是否反映真实 workspace 状态；错误是否被吞并或误报；版本和验证入口是否漂移；嵌套仓覆盖是否与产品声明一致。

## Why This Scope Exists

- Context 将 CLI 入口和 switch summary 放在主调用链末端，并明确记录版本重复与验证命令缺失候选。

## Entry Points

- `bin/codews.js:5` — 可执行入口。
- `src/cli.js:34` — Commander 定义。
- `src/git.js:179` — status 输出。
- `src/git.js:246` — switch summary。
- `package.json:3`, `9` — 版本和脚本契约。

## Important Boundaries

| Boundary | This Side | Other Side | Related Task |
|---|---|---|---|
| execution result → user claim | A03 state | A04 output | [A03](A03-switch-execution-lifecycle.md) |
| resolved config → expected status | A01 producer | A04 comparator | [A01](A01-configuration-resolution.md) |

## Exclusions

- 远端 Git 可用性和文档内容质量；配置解析/写操作根因分别归 A01/A03。

## Evidence

### Partition Evidence

- `AGENTS.md` 自动识别候选、核心入口和日志规范；`HARNESS.md` 验证缺口。

### Evidence Strategy

1. 跟踪每个 Commander action 到输出和 exit 行为。
2. 核对 status/summary 的 repository discovery、branch/commit/dirty 比较和异常处理。
3. 搜索版本单一来源、真实测试/CI、递归状态实现和替代命令。
4. 仅运行 Context 已确认的非破坏性入口或受控探针。

### Required Counter-evidence

- 动态版本读取、递归状态扫描、错误 exit code、测试/CI/fixture、summary 前状态核验。

## Dependencies / Related Tasks

- **Depends on**: A01, A03
- **Provides to**: cross-module review
- **Open questions**: 输出层是否暴露 A01/A03 的部分或不安全状态，还是掩盖它们？

## Completion Gate

- [x] Planned scope and exclusions are accounted for.
- [x] Result records actual coverage, Evidence and gaps.
- [x] Candidates follow the Finding state contract.
- [x] Boundary inputs are ready for cross-module reconciliation.
- [x] Snapshot remains valid at checkpoint.
