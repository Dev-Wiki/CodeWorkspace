# Audit Result A02 — `工作区路径与脏状态安全边界`

> **职责**：本文件记录 [对应 Task](../tasks/A02-workspace-safety-boundary.md) 的检查范围、Evidence、candidate、反证和缺口。它不是最终报告；稳定 Finding 维护在 [Findings.md](../Findings.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Audit Task](../tasks/A02-workspace-safety-boundary.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run / Task | `codews-20260819-705aff0` / `A02` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Drift Status | `valid` |
| Result Status | `completed` |

## Coverage Executed

- **Entry points followed**: `adjustWorkspaceRoot`, `getRealDirtyStatus`, `checkDirty`; all `repoPath` construction sites inspected.
- **Call chains / data flows**: `config.path → path.resolve(workspaceRoot, path) → git cwd`; dirty status → force/stash/default branch → boolean gate.
- **Boundaries examined**: workspace containment, nested-repo exception, missing targets, reset/stash behavior, post-action recheck.
- **Excluded or unread scope**: actual checkout sinks deferred to A03; no real user repository was mutated.

## Evidence

| Evidence ID | Path / Command / Artifact | Observation | Supports / Contradicts | Snapshot |
|---|---|---|---|---|
| `E-A02-00` | `runtime.py verify-workspace` | Snapshot valid before task | task execution | `705aff0/91941f7e` |
| `E-A02-01` | `src/git.js:42-73` | `repoPath` uses unconstrained `path.resolve`; force runs reset only and has no `newStatus` check, unlike stash. | A02-C01, A02-C02 | `705aff0/91941f7e` |
| `E-A02-02` | `src/git.js:81-88` | checkout reconstructs the same unconstrained absolute path. | A02-C01 | `705aff0/91941f7e` |
| `E-A02-03` | `/tmp` path probe | `../outside` resolved to `/tmp/codews-audit-A02/outside`, and the dirty checker operated there. | A02-C01 | `705aff0/91941f7e` |
| `E-A02-04` | `/tmp` force probe | Logged hard reset, returned `forceCheckDirty=true`, then `git status --porcelain` still printed `?? untracked.txt`. | A02-C02 | `705aff0/91941f7e` |
| `E-A02-05` | `src/cli.js:56-64` | A true dirty-check result immediately enables checkout. | A02-C02 | `705aff0/91941f7e` |
| `E-A02-06` | `ARCHITECTURE.md:65-70`, `src/cli.js:43-45` | Product/CLI contract says force cleans changes and architecture names `git clean -xdf`. | A02-C02 | `705aff0/91941f7e` |

## Candidate Outcomes

| Local ID | Status | Claim | Evidence | Counter-evidence | Registry Mapping |
|---|---|---|---|---|---|
| `A02-C01` | `confirmed` | A configured relative path can escape workspaceRoot and become the cwd/target for downstream Git operations. | E-A02-01..03, A03 E-A03-05 | No realpath/relative/isAbsolute/containment guard or downstream identity check found; A03 confirmed clone outside the workspace. | `AUD-002` |
| `A02-C02` | `confirmed` | `--force` reports the workspace clean after reset while untracked files remain because clean and post-reset recheck are absent. | E-A02-01, E-A02-04..06 | Stash does recheck; no force-specific clean/recheck or alternate implementation exists. | `AUD-003` |

## Counter-evidence and Alternatives

- Searched all source for canonicalization, `realpath`, `relative`, `isAbsolute`, containment checks and Git top-level identity checks; none were found.
- The default path blocks a dirty escaped repo, but a clean escaped repo passes; `--force` can also reset it. This narrows but does not eliminate AUD-002.
- Nested repository filtering affects only untracked status entries and is not a workspace containment guard.
- Stash performs a second dirty check at `src/git.js:58-61`; force has no equivalent, providing a direct counter-comparison for AUD-003.

## Evidence Gaps / Blockers

- No repository-level automated test command is available.

## Cross-module Inputs

| Boundary / Claim | Related Task | Question to Reconcile | Evidence Link |
|---|---|---|---|
| escaped `repoPath` → mutation | A03 | Resolved: clone created the target outside workspace; all later branches reuse the same repoPath. | E-A02-01..03; A03 E-A03-05 |
| force `true` with dirty tree → checkout | A03 | Resolved: CLI immediately enters the executor and no downstream dirty recheck exists. | E-A02-04, E-A02-05; `src/git.js:76-88` |

### Reconciliation Outcome

- `A02-C01` and A03 `A03-C05` merge into `AUD-002`; containment and spaced-path tokenization (`AUD-006`) remain separate repair boundaries.
- `AUD-003` remains P2: it violates the clean gate and can cause failure/contamination, but it requires explicit `--force`.

## Checkpoint

- **Last durable stage**: A02 completed
- **Next action**: A03 switch lifecycle and mutation sinks
- **Snapshot validation**: valid at task start; controlled repositories were under `/tmp`, and only allowed audit outputs changed in the target repo.
