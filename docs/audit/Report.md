# Codebase Audit Report

> **职责**：本文件是当前有效 Snapshot 下的开发者总览，只汇总已验证 Findings、跨模块结论、未决证据和建议 handoff。权威 Finding 正文见 [Findings.md](Findings.md)，执行状态见 [Dashboard.md](Dashboard.md)。

## Navigation

- [Dashboard](Dashboard.md)
- [Finding Registry](Findings.md)
- [Audit Tasks](tasks/)
- [Task Results](results/)

## Documentation Discoverability

| Field | Value |
|---|---|
| Documentation Hub | `docs/README.md` |
| Stable Audit Entry | `docs/audit/Report.md` |
| Status | `linked` |
| Owner / Action | `dev-harness-docs / none` |

> Audit does not edit the documentation hub. When status is `docs-refresh-required`, this table is the exact navigation handoff and does not require an `AUD-*` Finding.

## Snapshot

| Field | Value |
|---|---|
| Audit Run | `codews-20260819-705aff0` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Audit Scope | `bin/codews.js`, `src/*.js`, `package*.json`; documentation and remote systems excluded |
| Last Drift Validation | final output/link gate: valid, Snapshot `ddf179...` |
| Cross-module Reconciliation | `completed` |

## Executive Summary

本次审计覆盖完整 Node.js CLI 主链与 package/HARNESS 边界，确认 10 项问题。最高优先级是三项 P1：无效 base 可执行部分 workspace、配置路径可越界触及 workspace 外部、以及多仓切换失败后没有 rollback。其余问题集中在 force 脏状态门禁、clone 参数构造、状态退出语义、嵌套仓覆盖和工程验证/包元数据。

- **Tasks**: 4 completed / 0 blocked / 0 stale
- **Confirmed Findings**: P0 0 / P1 3 / P2 4 / P3 3
- **Needs Verification**: 0
- **Coverage limits**: 远端 Git 服务未访问；AUD-006 的 Windows shell 语义未实测；仓库无项目级自动化验证入口，运行证据来自 `/tmp` 中可回收的本地 Git fixture。

## Architecture / Scope Summary

Context 描述的主链为 `bin/codews.js → src/cli.js → src/config.js / src/git.js → Git、文件系统与 hook 边界`。审计按 [A01 配置继承](tasks/A01-configuration-resolution.md)、[A02 工作区安全](tasks/A02-workspace-safety-boundary.md)、[A03 切换生命周期](tasks/A03-switch-execution-lifecycle.md)、[A04 状态与契约](tasks/A04-status-runtime-contracts.md) 四个行为域贯通 producer、gate、mutation 和 output；没有按文件数量机械切片。

## Confirmed Findings

### P0

- none

### P1

- [AUD-001 — base 继承图无失败闭合](Findings.md#aud-001--base-继承图无失败闭合) — 缺失 base 后仅 overlay 被 clone 并正常返回；循环 base 栈溢出。
- [AUD-002 — 仓库路径可逃逸 workspace root](Findings.md#aud-002--仓库路径可逃逸-workspace-root) — `../` 目标在 workspace 外实际创建了 Git 仓库，后续 reset/fetch/checkout/hooks 同样复用该路径。
- [AUD-005 — 后续仓库失败时保留前序仓库变更](Findings.md#aud-005--后续仓库失败时保留前序仓库变更) — 第二仓失败后第一仓仍保持已 clone/切换状态，无 rollback 或恢复清单。

### P2

- [AUD-003 — force 在未清理 untracked 时返回 clean](Findings.md#aud-003--force-在未清理-untracked-时返回-clean) — 探针返回 true 时 Git 仍报告 `?? untracked.txt`。
- [AUD-004 — commit-only 首次克隆使用 undefined 分支](Findings.md#aud-004--commit-only-首次克隆使用-undefined-分支) — 文档支持的 branchless pin 实际执行 `-b undefined`。
- [AUD-006 — 带空格的克隆目标路径失败](Findings.md#aud-006--带空格的克隆目标路径失败) — shell 字符串把合法目标 basename 拆成多个参数。
- [AUD-007 — status -e 对不匹配与缺失返回成功](Findings.md#aud-007--status--e-对不匹配与缺失返回成功) — mismatch 与 missing 输出后进程仍为 0。

### P3

- [AUD-008 — 默认 status 漏掉深层嵌套仓库](Findings.md#aud-008--默认-status-漏掉深层嵌套仓库) — 仅扫描当前目录和一层子目录。
- [AUD-009 — 没有可成功执行的自动化验证入口](Findings.md#aud-009--没有可成功执行的自动化验证入口) — npm test 固定失败，HARNESS 无 quick/bugfix/full。
- [AUD-010 — package-lock 根包元数据过期](Findings.md#aud-010--package-lock-根包元数据过期) — 根包名、版本、许可证与 package.json 冲突。

## Cross-module Findings

### Boundary Ledger

| Boundary | Producer / Owner | Consumer / Sink | Tasks | Evidence | Status |
|---|---|---|---|---|---|
| executable → CLI actions | `bin/codews.js` | `src/cli.js` | A04 | [A04 Result](results/A04-status-runtime-contracts.md) | covered |
| config discovery/inheritance → workspace | `src/config.js` | CLI, dirty gate, executor | A01, A03, A04 | [A01](results/A01-configuration-resolution.md), [A03](results/A03-switch-execution-lifecycle.md) | covered |
| config path → filesystem/Git target | workspace producer | `src/git.js` path/Git/hook sinks | A01, A02, A03 | [A02](results/A02-workspace-safety-boundary.md), [A03](results/A03-switch-execution-lifecycle.md) | covered |
| dirty preflight → mutation | `checkDirty` | `checkoutWorkspace` | A02, A03 | [A02](results/A02-workspace-safety-boundary.md), [A03](results/A03-switch-execution-lifecycle.md) | covered |
| sequential mutation → success/failure output | `checkoutWorkspace` | CLI catch/summary | A03, A04 | [A03](results/A03-switch-execution-lifecycle.md), [A04](results/A04-status-runtime-contracts.md) | covered |
| repo discovery/comparison → process status | `statusWorkspace` | CLI user/automation | A04 | [A04](results/A04-status-runtime-contracts.md) | covered |
| package/verification metadata → build/release tooling | `package*.json`, `HARNESS.md` | npm/CI/release consumers | A04 | [A04](results/A04-status-runtime-contracts.md) | covered with command gap |
| remote Git/platform variants | external services / OS shell | clone/fetch/pull behavior | A03 | local probes only | explicit gap |

### Identity and Contradiction Decisions

- **Merged aliases**: A01-C01 + A03-C04 → [AUD-001](Findings.md#aud-001--base-继承图无失败闭合); A02-C01 + A03-C05 → [AUD-002](Findings.md#aud-002--仓库路径可逃逸-workspace-root). No later ID was created for either alias.
- **Kept distinct**: AUD-001 vs AUD-005 (invalid producer state vs executor rollback); AUD-002 vs AUD-006 (containment vs shell argument tokenization); AUD-007 vs AUD-008 (exit contract vs discovery coverage).
- **Resolved contradictions**: missing-base warning is not repaired downstream; dirty blocking does not contain clean/force escaped paths; targeted commit+depth does not cover default commit-only clone; CLI failure reporting does not roll back earlier mutations; package/CLI versions match, rejecting A04-C05, while lockfile root metadata remains stale.
- **Severity/confidence**: P1 ×3, P2 ×4, P3 ×3; all confidence high, no severity changes after end-to-end review.
- **Boundary coverage gaps**: remote Git server variants and Windows shell semantics were not probed; AUD-006 is confirmed for the current Unix shell path. No separate security Finding is asserted for intentionally executable `post_hooks` without a defined config trust policy.
- **Reconciliation Snapshot**: `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec` / Context `91941f7e...`.

## Needs Verification

- none；所有发布 Finding 已绑定当前 Snapshot、代码/运行 Evidence、反证和已完成 reconciliation。

## Rejected / Stale / Resolved

- A04-C05（“CLI 硬编码版本当前与 package.json 不一致”）已拒绝：两处当前均为 `1.2.0`。
- Registry 中无 stale 或 resolved Finding。

## Evidence

- **Canonical Context**: [README](../../README.md), [AGENTS](../../AGENTS.md), [ARCHITECTURE](../../ARCHITECTURE.md), [HARNESS](../../HARNESS.md)
- **Task coverage**: [Tasks](tasks/) / [Results](results/)
- **Finding Registry**: [Findings.md](Findings.md)
- **Cross-module reconciliation**: 本报告的 [Boundary Ledger](#boundary-ledger) 与各 Result 的 `Reconciliation Outcome`
- **Final workspace validation**: `runtime.py verify-workspace` passed; 11 audit outputs passed `validate-output`; 17 Markdown files had 0 broken relative links; Task/Result counts are 4/4; 10 Finding headings are unique; `git diff --check` passed

## Recommended Next Actions

| Finding / Gap | Suggested Handoff | Acceptance Direction | Audit Action |
|---|---|---|---|
| AUD-001 | `dev-harness-auto-fix` | 缺失/循环 base 在 mutation 前失败，并输出继承链 | `recommend only` |
| AUD-002 | `dev-harness-auto-fix` | 所有 repo target 在任何 Git/fs/hook sink 前通过 canonical containment | `recommend only` |
| AUD-003, AUD-004, AUD-006, AUD-007, AUD-008 | `dev-harness-auto-fix` | 分别补齐 force 复检、commit-only clone、argv 执行、status 非零退出和嵌套覆盖回归 | `recommend only` |
| AUD-005 | `dev-harness-planning` → `dev-harness-auto-fix` | 先确定 rollback/补偿/恢复契约，再做失败注入验收 | `recommend only` |
| AUD-009 | `dev-harness-commands` | 建立基于本地 Git fixture 的 quick/bugfix/full 入口 | `recommend only` |
| AUD-010 | `dev-harness-git-workflow` | 确认发布身份后同步 lockfile 根元数据且保持依赖树 | `recommend only` |

> 本报告不授权自动修复、计划创建、文档修改、命令改写、commit、PR 或 release。
