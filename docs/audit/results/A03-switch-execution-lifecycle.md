# Audit Result A03 — `切换执行生命周期`

> **职责**：本文件记录 [对应 Task](../tasks/A03-switch-execution-lifecycle.md) 的检查范围、Evidence、candidate、反证和缺口。它不是最终报告；稳定 Finding 维护在 [Findings.md](../Findings.md)。

## Navigation

- [Dashboard](../Dashboard.md)
- [Audit Task](../tasks/A03-switch-execution-lifecycle.md)
- [Finding Registry](../Findings.md)
- [Current Report](../Report.md)

## Snapshot

| Field | Value |
|---|---|
| Audit Run / Task | `codews-20260819-705aff0` / `A03` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Dirty Fingerprint | Snapshot `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` |
| Drift Status | `valid` |
| Result Status | `completed` |

## Coverage Executed

- **Entry points followed**: CLI mutation gate and every branch of `checkoutWorkspace`, including targeted fallback and hooks.
- **Call chains / data flows**: resolved repo fields → path/target/depth → string Git command → sequential repository mutation → exception/success return.
- **Boundaries examined**: missing/existing targets, branch/commit/depth variants, escaped/spaced paths, multi-repo failure, cleanup, hooks.
- **Excluded or unread scope**: remote-server-specific behavior; probes used one local Git source under `/tmp`.

## Evidence

| Evidence ID | Path / Command / Artifact | Observation | Supports / Contradicts | Snapshot |
|---|---|---|---|---|
| `E-A03-00` | `runtime.py verify-workspace` | Snapshot valid before task | task execution | `705aff0/91941f7e` |
| `E-A03-01` | `src/git.js:81-88`, `113-145` | commit defaults depth to 0, but all ordinary clones still append `-b ${branch}` before checking out the commit. | A03-C01 | `705aff0/91941f7e` |
| `E-A03-02` | `/tmp` commit-only probe | Command failed as `git clone ... -b undefined CommitOnly`. | A03-C01 | `705aff0/91941f7e` |
| `E-A03-03` | `src/git.js:77-83`, `138-175` | Repositories mutate sequentially; exceptions propagate with no rollback/compensation state. | A03-C02 | `705aff0/91941f7e` |
| `E-A03-04` | `/tmp` two-repo probe | Second clone failed on missing branch while `firstRepoRemains=true`. | A03-C02 | `705aff0/91941f7e` |
| `E-A03-05` | `/tmp` escaped-path probe | Clone completed at `../escaped-target`; outside existed and inside did not. | AUD-002 | `705aff0/91941f7e` |
| `E-A03-06` | `/tmp` missing-base integration probe | Warning emitted, dirty gate true, only `OnlyOverlay` resolved and cloned successfully. | AUD-001 | `705aff0/91941f7e` |
| `E-A03-07` | `src/git.js:11-18`, `138-141` | Dynamic clone operands and target basename are interpolated into one shell string. | A03-C03 | `705aff0/91941f7e` |
| `E-A03-08` | `/tmp` spaced-path probe | `Repo With Space` produced an unquoted multi-token clone command and failed. | A03-C03 | `705aff0/91941f7e` |
| `E-A03-09` | `ARCHITECTURE.md:65-73`, `src/cli.js:63-69` | Project promises anti-tear behavior and commit-without-branch, while CLI only reports the propagated failure after earlier mutations. | A03-C01, A03-C02 | `705aff0/91941f7e` |

## Candidate Outcomes

| Local ID | Status | Claim | Evidence | Counter-evidence | Registry Mapping |
|---|---|---|---|---|---|
| `A03-C01` | `confirmed` | A first clone configured only by commit always includes `-b undefined` and fails before the commit checkout. | E-A03-01, E-A03-02, E-A03-09 | Targeted depth path can work, and inherited configs may supply branch; neither protects documented direct commit-only/default-depth use. | `AUD-004` |
| `A03-C02` | `confirmed` | A later repository failure leaves earlier repositories mutated because the sequential loop has no rollback or compensation. | E-A03-03, E-A03-04, E-A03-09 | CLI catches and reports failure, but no restore/rollback/transaction implementation exists. | `AUD-005` |
| `A03-C03` | `confirmed` | Clone fails for a configured target basename containing spaces because dynamic operands are passed through an unquoted shell string. | E-A03-07, E-A03-08 | Existing repos use cwd and avoid this basename argument; missing-repo clone has no argv-based alternative. | `AUD-006` |
| `A03-C04` | `confirmed` | Missing base reaches a real clone and returns normally. | E-A03-06 | No downstream complete-workspace check found. | `AUD-001` |
| `A03-C05` | `confirmed` | Escaped repoPath reaches the clone filesystem/Git sink. | E-A03-05 | No checkout-specific containment guard found. | `AUD-002` |

## Counter-evidence and Alternatives

- Searched for rollback, restore, compensation, transaction journals and post-failure status repair; none exist.
- A commit combined with explicit positive depth takes the targeted/full fallback branch, but commit-only defaults to depth 0 and reaches the broken ordinary clone command.
- Inherited configs often retain a base branch, but architecture explicitly permits omitting branch for a pinned commit.
- Existing repositories with spaced directory names use `cwd` safely; the failure is specific to the missing-repo clone command's unquoted target basename.
- `post_hooks` intentionally execute shell commands; no extra security claim is made here about config trust. AUD-006 is confirmed on valid path tokenization alone.

## Evidence Gaps / Blockers

- No repository-level test command exists; all probes are documented one-off local Git fixtures.
- Remote Git server behavior remains excluded.

## Cross-module Inputs

| Boundary / Claim | Related Task | Question to Reconcile | Evidence Link |
|---|---|---|---|
| missing base → clone | A01/A04 | Resolved: A01 owns parser root cause; A04 confirms normal return leads to success output. | E-A03-06; A04 E-A04-08 |
| escaped path → clone | A02 | Resolved: A02/A03 aliases merged into AUD-002; severity P1 retained. | E-A03-05 |
| later failure → earlier mutation remains | A04 | Resolved: CLI reports generic failure without mutated-repo set or recovery state. | E-A03-04, E-A03-09; A04 E-A04-08 |
| force false-clean → checkout | A02 | Resolved: executor has no dirty recheck; remains AUD-003 rather than merging with rollback AUD-005. | `src/cli.js:56-64`, `src/git.js:76-88` |

### Reconciliation Outcome

- AUD-001/AUD-002 absorb A03 aliases; AUD-004/AUD-005/AUD-006 remain distinct root causes.
- AUD-002 (containment) and AUD-006 (shell tokenization) affect the same path data but require different validation/execution fixes.
- AUD-001 (incomplete producer state) and AUD-005 (failed executor rollback) both produce torn workspaces but have distinct owners and trigger conditions.
- Windows shell/path behavior was not probed for AUD-006; Unix behavior is confirmed and severity remains P2.

## Checkpoint

- **Last durable stage**: A03 completed
- **Next action**: A04 status/output/runtime contract
- **Snapshot validation**: valid immediately before confirming Findings; target-repo changes remain confined to allowed audit outputs.
