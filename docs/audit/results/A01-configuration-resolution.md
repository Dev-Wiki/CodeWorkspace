# Audit Result A01 — `配置发现与继承`

> **职责**：本文件记录 [对应 Task](../tasks/A01-configuration-resolution.md) 的检查范围、Evidence、candidate、反证和缺口。它不是最终报告；稳定 Finding 维护在 [Findings.md](../Findings.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Audit Task](../tasks/A01-configuration-resolution.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run / Task | `codews-20260819-705aff0` / `A01` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Drift Status | `valid` |
| Result Status | `completed` |

## Coverage Executed

- **Entry points followed**: `loadConfig`, `getResolvedWorkspace`, `listConfigs` and all four CLI consumers.
- **Call chains / data flows**: `env → configPath → raw.base → recursive workspace → CLI → checkDirty/checkoutWorkspace`; local/global list enumeration.
- **Boundaries examined**: JSON/filesystem input, recursive ownership, missing/cyclic base behavior, downstream workspace consumers.
- **Excluded or unread scope**: Git mutation effects deferred to A03; remote filesystem/config sources excluded.

## Evidence

| Evidence ID | Path / Command / Artifact | Observation | Supports / Contradicts | Snapshot |
|---|---|---|---|---|
| `E-A01-00` | `runtime.py verify-workspace` | Snapshot valid before task | task execution | `705aff0/91941f7e` |
| `E-A01-01` | `src/config.js:34-42` | Existing base recurses; missing base only warns and continues. | A01-C01 | `705aff0/91941f7e` |
| `E-A01-02` | `src/config.js:45-60` | Overlay repos are returned even when no base repos were resolved. | A01-C01 | `705aff0/91941f7e` |
| `E-A01-03` | `/tmp` probe: missing `does-not-exist.json` | Exit 0; returned a workspace containing only `OnlyOverlay`. | A01-C01 | `705aff0/91941f7e` |
| `E-A01-04` | `/tmp` probe: `a.json ↔ b.json` | Exit 7 with `RangeError: Maximum call stack size exceeded`. | A01-C01 | `705aff0/91941f7e` |
| `E-A01-05` | `src/cli.js:48-66` | `switch` passes the returned workspace directly to dirty check and checkout; warning state is not inspected. | A01-C01 | `705aff0/91941f7e` |

## Candidate Outcomes

| Local ID | Status | Claim | Evidence | Counter-evidence | Registry Mapping |
|---|---|---|---|---|---|
| `A01-C01` | `confirmed` | An invalid base graph does not fail closed: a missing base yields an executable partial workspace, while a cycle overflows recursion. | E-A01-01..05, A03 E-A03-06 | No schema, visited-set, missing-base throw, caller validation, alternate resolver, or test was found; A03 confirmed mutation reachability. | `AUD-001` |

## Counter-evidence and Alternatives

- Searched `src/`, package metadata and callers for schema validation, cycle/visited guards, missing-base rejection and alternate resolvers; none exist.
- `switch` catches thrown errors, so the cycle becomes a failed command instead of process corruption, but this does not protect the missing-base path because it does not throw.
- `show` and `status -e` also consume the partial resolution, confirming there is no caller-specific repair.

## Evidence Gaps / Blockers

- No repository-level automated test command is available.

## Cross-module Inputs

| Boundary / Claim | Related Task | Question to Reconcile | Evidence Link |
|---|---|---|---|
| missing base → partial workspace | A03/A04 | Resolved: only overlay repo mutated; normal return reaches CLI success path. | E-A01-02, E-A01-03, E-A01-05; A03 E-A03-06; A04 E-A04-08 |
| cyclic base → thrown RangeError | A04 | Resolved: switch catch reports failure, but parser still lacks controlled cycle diagnostics. | E-A01-04; `src/cli.js:67-69` |

### Reconciliation Outcome

- `A01-C01` and A03 `A03-C04` are one root cause and remain `AUD-001`; no duplicate ID was created.
- Severity remains P1 because the non-throwing missing-base path is reachable through mutation and success output.
- Remote Git variants were unnecessary to establish the local inheritance and mutation mechanism.

## Checkpoint

- **Last durable stage**: A01 completed
- **Next action**: A02 path and dirty-state boundary
- **Snapshot validation**: `runtime.py verify-workspace` valid at task start; only allowed audit outputs changed.
