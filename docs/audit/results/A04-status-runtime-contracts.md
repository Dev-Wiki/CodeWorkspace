# Audit Result A04 — `状态展示与运行契约`

> **职责**：本文件记录 [对应 Task](../tasks/A04-status-runtime-contracts.md) 的检查范围、Evidence、candidate、反证和缺口。它不是最终报告；稳定 Finding 维护在 [Findings.md](../Findings.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Audit Task](../tasks/A04-status-runtime-contracts.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run / Task | `codews-20260819-705aff0` / `A04` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Drift Status | `valid` |
| Result Status | `completed` |

## Coverage Executed

- **Entry points followed**: executable shim, all Commander actions, config-aware/default status, switch summary, package and lock metadata.
- **Call chains / data flows**: status observation → formatted line → function return/CLI exit; switch executor return/error → success/failure output; package metadata → CLI version/lockfile.
- **Boundaries examined**: nested repository discovery, mismatch/missing/error exit semantics, partial-state reporting, verification command availability, release metadata.
- **Excluded or unread scope**: Commander dependency is not installed; behavior was traced at exported function/caller boundaries rather than installing dependencies.

## Evidence

| Evidence ID | Path / Command / Artifact | Observation | Supports / Contradicts | Snapshot |
|---|---|---|---|---|
| `E-A04-00` | `runtime.py verify-workspace` | Snapshot valid before task | task execution | `705aff0/91941f7e` |
| `E-A04-01` | `src/git.js:179-212`, `src/cli.js:73-88` | Config-aware status prints missing/mismatch/error states but returns no result and CLI sets no failure exit. | A04-C01 | `705aff0/91941f7e` |
| `E-A04-02` | `/tmp` mismatch/missing probe | Printed branch mismatch and `[MISSING]`, then `exitCode=0`. | A04-C01 | `705aff0/91941f7e` |
| `E-A04-03` | `src/git.js:213-242` | Default status checks only current directory and immediate subdirectories. | A04-C02 | `705aff0/91941f7e` |
| `E-A04-04` | `/tmp` nested probe | A valid repo existed at `Level1/Level2`; default scan printed none and exited 0. | A04-C02 | `705aff0/91941f7e` |
| `E-A04-05` | `package.json:9-10`, `HARNESS.md:17-30` | Only test script is an intentional exit 1 placeholder; all verification purposes are Unknown. | A04-C03 | `705aff0/91941f7e` |
| `E-A04-06` | `package.json:2-3,25`, `package-lock.json:2-10` | Lock root says `codeworkspace@1.0.0`/ISC; package says `codews-cli@1.2.0`/MIT. | A04-C04 | `705aff0/91941f7e` |
| `E-A04-07` | `package.json:3`, `src/cli.js:39` | Both current version sources are 1.2.0. | A04-C05 | `705aff0/91941f7e` |
| `E-A04-08` | `src/cli.js:63-69` | Normal A03 return prints success; failure prints only the thrown message and no mutated-repo set. | AUD-001, AUD-005 | `705aff0/91941f7e` |

## Candidate Outcomes

| Local ID | Status | Claim | Evidence | Counter-evidence | Registry Mapping |
|---|---|---|---|---|---|
| `A04-C01` | `confirmed` | `status -e` returns success when repositories are missing, mismatched, or unreadable. | E-A04-01, E-A04-02 | No aggregated boolean, thrown error, exitCode, or alternate strict command exists. | `AUD-007` |
| `A04-C02` | `confirmed` | Default `status` misses repositories nested deeper than one directory. | E-A04-03, E-A04-04 | `status -e` covers configured nested paths but is a separate explicit mode. | `AUD-008` |
| `A04-C03` | `confirmed` | The repository has no successful automated verification entry; npm test always fails by design. | E-A04-05 | No tests, CI, scripts or alternate HARNESS command found. | `AUD-009` |
| `A04-C04` | `confirmed` | package-lock root identity/version/license are stale relative to package.json. | E-A04-06 | Dependency version agrees; mismatch is limited to root package metadata. | `AUD-010` |
| `A04-C05` | `rejected` | Hard-coded CLI version currently differs from package.json. | E-A04-07 | Direct comparison shows both are 1.2.0; only future drift risk exists. | none |

## Counter-evidence and Alternatives

- Config-aware status has no return value or aggregate state; the CLI action does not inspect one or set exit status after mismatches.
- `status -e` is a partial alternative for nested repos, but default `status` is documented separately and remains non-recursive.
- No `tests/`, CI file, successful npm script, or confirmed HARNESS command exists.
- Package-lock dependency resolution matches Commander 14.0.3; AUD-010 is limited to root identity/release metadata rather than dependency staleness.
- Package and CLI version currently match at 1.2.0, rejecting A04-C05.

## Evidence Gaps / Blockers

- `HARNESS.md` records test/quick/bugfix/full as Unknown; this is confirmed as AUD-009 and routed rather than guessed.
- Full CLI parsing was not executed because `commander` is not installed and dependency installation was unnecessary for the exported-function/caller evidence.

## Cross-module Inputs

| Boundary / Claim | Related Task | Question to Reconcile | Evidence Link |
|---|---|---|---|
| partial workspace normal return → success | A01/A03 | Missing-base partial execution is reported as successful because no completeness state reaches output. | E-A04-08 |
| later failure → generic catch | A03 | Earlier mutations are neither summarized nor returned for recovery. | E-A04-08 |
| nested configs/status | A01 | Config listing is recursive, but default repository status discovery is only one level. | E-A04-03, E-A04-04 |

### Reconciliation Outcome

- A04 strengthens AUD-001 and AUD-005 but does not create duplicate reporting Findings for their output symptoms.
- AUD-007 and AUD-008 remain separate: one is exit semantics for config-aware validation, the other is discovery coverage for default status.
- A04-C05 is rejected because both current version sources equal 1.2.0; AUD-010 is narrowly retained for lockfile root metadata only.
- AUD-009 is a cross-cutting verification gap and remains P3 with a `dev-harness-commands` handoff.

## Checkpoint

- **Last durable stage**: A04 completed
- **Next action**: mandatory cross-module reconciliation
- **Snapshot validation**: valid immediately before confirming Findings; only allowed audit outputs changed.
