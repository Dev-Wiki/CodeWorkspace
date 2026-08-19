# Audit Task A03 — `切换执行生命周期`

> **职责**：本文件定义本轮要扫描什么，不保存最终 Finding 正文。执行证据写入 [对应 Result](../results/A03-switch-execution-lifecycle.md)，全局 Finding 写入 [Findings.md](../Findings.md)，运行状态写入 [Dashboard.md](../Dashboard.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)
- [Task Result](../results/A03-switch-execution-lifecycle.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run | `codews-20260819-705aff0` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Task Status | `completed` |

## Scope

- **Behavior domain**: 顺序处理多个仓库时的 clone/fetch/checkout/pull、commit/depth 分支、targeted fallback、post_hooks、异常和完成状态。
- **In-scope paths**: `src/git.js:76-177` 及 `src/cli.js:56-70`。
- **Audit questions**: 各配置变体能否构造有效 Git 命令；失败是否留下未声明的部分切换；hook 和 fallback 的所有权/清理是否闭合。

## Why This Scope Exists

- [AGENTS §5–8](../../../AGENTS.md) 把 `src/git.js`、子进程、删除、hooks 和多版本字段标为核心高风险边界。

## Entry Points

- `src/cli.js:57` — preflight 到 mutation 的门禁。
- `src/git.js:76` — checkoutWorkspace 生命周期入口。
- `src/git.js:122`, `138`, `147`, `169` — targeted clone、普通 clone、existing repo、hooks 分支。

## Important Boundaries

| Boundary | This Side | Other Side | Related Task |
|---|---|---|---|
| resolved fields → shell command | A01 config | A03 Git subprocess | [A01](A01-configuration-resolution.md) |
| dirty gate → sequential writes | A02 preflight | A03 executor | [A02](A02-workspace-safety-boundary.md) |
| executor → user success/summary | A03 completion | A04 reporting | [A04](A04-status-runtime-contracts.md) |

## Exclusions

- 配置发现本身归 A01；无 env 的扫描展示归 A04；真实远端服务行为不在范围。

## Evidence

### Partition Evidence

- `AGENTS.md` 核心调用链和高风险文件 → `src/git.js:76-177`。

### Evidence Strategy

1. 枚举 commit/branch/depth/existing/missing/hook 分支及所有 runCommand sink。
2. 跟踪循环中的 mutation 顺序、异常传播、cleanup 和成功输出。
3. 搜索 rollback、补偿、二次状态核验与替代实现。
4. 用本地 `/tmp` Git 仓库验证关键命令构造和失败后的可观察状态。

### Required Counter-evidence

- rollback/transaction、commit-only clone 分支、shell 参数转义、hook 信任声明、失败后总结或状态检查。

## Dependencies / Related Tasks

- **Depends on**: A01, A02
- **Provides to**: A04, cross-module review
- **Open questions**: A04 是否会把部分成功误报为完整成功，或提供可恢复信息？

## Completion Gate

- [x] Planned scope and exclusions are accounted for.
- [x] Result records actual coverage, Evidence and gaps.
- [x] Candidates follow the Finding state contract.
- [x] Boundary inputs are ready for cross-module reconciliation.
- [x] Snapshot remains valid at checkpoint.
