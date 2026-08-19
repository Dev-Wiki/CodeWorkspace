# Codebase Audit Findings

> **职责**：本文件是稳定 Finding Registry。同一根因更新原 ID；详细任务覆盖见 [Task Results](results/)，总体摘要见 [Report.md](Report.md)，运行状态见 [Dashboard.md](Dashboard.md)。

## Navigation

- [Dashboard](Dashboard.md)
- [Current Report](Report.md)
- [Audit Tasks](tasks/)
- [Task Results](results/)

## Snapshot

| Field | Value |
|---|---|
| Audit Run | `codews-20260819-705aff0` |
| Base SHA / Branch | `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master` |
| Context Fingerprint | `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` |
| Registry Last Verified | final report gate |
| Drift Status | `valid` |

## Registry

| ID | Severity | Status | Summary | Source Tasks | Last Verified Snapshot |
|---|---|---|---|---|---|
| [AUD-001](#aud-001--base-继承图无失败闭合) | P1 | `confirmed` | base 缺失时继续并执行部分 workspace，循环时递归溢出 | [A01](results/A01-configuration-resolution.md), [A03](results/A03-switch-execution-lifecycle.md) | `705aff0/91941f7e` |
| [AUD-002](#aud-002--仓库路径可逃逸-workspace-root) | P1 | `confirmed` | 配置路径可越界并成为 clone/Git 目标 | [A02](results/A02-workspace-safety-boundary.md), [A03](results/A03-switch-execution-lifecycle.md) | `705aff0/91941f7e` |
| [AUD-003](#aud-003--force-在未清理-untracked-时返回-clean) | P2 | `confirmed` | force 仅 reset，不 clean/复检，却返回 true | [A02 Result](results/A02-workspace-safety-boundary.md) | `705aff0/91941f7e` |
| [AUD-004](#aud-004--commit-only-首次克隆使用-undefined-分支) | P2 | `confirmed` | commit-only clone 拼入 `-b undefined` | [A03 Result](results/A03-switch-execution-lifecycle.md) | `705aff0/91941f7e` |
| [AUD-005](#aud-005--后续仓库失败时保留前序仓库变更) | P1 | `confirmed` | 顺序切换没有 rollback，失败后留下部分状态 | [A03 Result](results/A03-switch-execution-lifecycle.md) | `705aff0/91941f7e` |
| [AUD-006](#aud-006--带空格的克隆目标路径失败) | P2 | `confirmed` | clone 动态参数以未引用 shell 字符串执行 | [A03 Result](results/A03-switch-execution-lifecycle.md) | `705aff0/91941f7e` |
| [AUD-007](#aud-007--status--e-对不匹配与缺失返回成功) | P2 | `confirmed` | 严格状态检查异常时仍退出 0 | [A04 Result](results/A04-status-runtime-contracts.md) | `705aff0/91941f7e` |
| [AUD-008](#aud-008--默认-status-漏掉深层嵌套仓库) | P3 | `confirmed` | 默认扫描只覆盖一层子目录 | [A04 Result](results/A04-status-runtime-contracts.md) | `705aff0/91941f7e` |
| [AUD-009](#aud-009--没有可成功执行的自动化验证入口) | P3 | `confirmed` | npm test 是失败占位，HARNESS 命令为空 | [A04 Result](results/A04-status-runtime-contracts.md) | `705aff0/91941f7e` |
| [AUD-010](#aud-010--package-lock-根包元数据过期) | P3 | `confirmed` | lockfile 根包名、版本、许可证与 package 不一致 | [A04 Result](results/A04-status-runtime-contracts.md) | `705aff0/91941f7e` |

## Evidence

- 每个 Finding 在自己的 `Finding Evidence` 小节维护 `path:line`、命令/artifact、反证和 Result 链接。
- Evidence 必须绑定该 Finding 的 Snapshot；Dashboard 和 Report 只链接，不复制详细证据。
- 无代码或运行 Evidence 的条目不得标 `confirmed`。

## Findings

### AUD-001 — base 继承图无失败闭合

- **Status**: `confirmed`
- **Severity**: `P1`
- **Category**: 配置继承 / 状态安全
- **Confidence**: high
- **Source Tasks**: [A01 Result](results/A01-configuration-resolution.md), [A03 Result](results/A03-switch-execution-lifecycle.md); A04 output review pending

#### Claim

当派生配置引用不存在的 base 时，解析器只告警并返回仅含 overlay 的 workspace；当 base 图成环时，递归没有终止保护并触发栈溢出。

#### Risk / Impact

缺失 base 会把要求完整基线的环境降为部分仓库集合并对这些仓库执行 clone/checkout；循环 base 会让相关命令失败。两者都破坏配置继承的 fail-closed 语义。

#### Call Chain / Data Flow

`CLI env → loadConfig → getResolvedWorkspace(raw.base) → returned workspace / RangeError → CLI consumer → Git boundary`

#### Counter-evidence Checked

- 搜索 schema、visited-set、cycle guard、missing-base throw、调用端二次校验、替代 resolver 和测试，均未找到。
- `switch` 的顶层 catch 能报告递归异常，但 missing-base 路径不抛错，因而不受该保护。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A03 completion

#### Finding Evidence

- `src/config.js:34-42` — 缺失 base 仅告警，已有 base 直接递归。
- `src/config.js:45-60` — overlay 在 base 缺失后仍被合并并返回。
- `src/cli.js:48-66` — `switch` 直接把解析结果交给预检和执行。
- `/tmp` probes — 缺失 base 返回部分 workspace；两节点循环触发 `RangeError`。
- `/tmp` integration probe — partial workspace 通过 dirty gate 并只 clone `OnlyOverlay` 后正常返回。
- [A01 evidence table](results/A01-configuration-resolution.md#evidence)
- [A03 evidence table](results/A03-switch-execution-lifecycle.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: 缺失或成环的 base 图在任何仓库 mutation 前以非零状态终止，并显示可定位的继承链。

---

### AUD-002 — 仓库路径可逃逸 workspace root

- **Status**: `confirmed`
- **Severity**: `P1`
- **Category**: 路径所有权 / 写入边界
- **Confidence**: high
- **Source Tasks**: [A02 Result](results/A02-workspace-safety-boundary.md), [A03 Result](results/A03-switch-execution-lifecycle.md)

#### Claim

`config.path` 可通过 `..` 或绝对语义解析到 `workspaceRoot` 外部，且当前没有 containment 或 Git identity 校验阻止该路径成为仓库 cwd。

#### Risk / Impact

配置错误或恶意配置可让 clone/status/reset/fetch/checkout/pull/hooks 作用于不属于当前 workspace 的路径或仓库；clone sink 已由受控探针确认。

#### Call Chain / Data Flow

`config.path → resolved workspace → path.resolve(workspaceRoot, path) → repoPath → Git cwd / filesystem target`

#### Counter-evidence Checked

- 搜索全部路径消费者，未找到 realpath/relative/isAbsolute/containment 或 Git top-level 身份校验。
- 默认 dirty gate 会阻断脏的越界仓库，但干净仓库仍通过，force 分支还可能先 reset。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A03 completion

#### Finding Evidence

- `src/git.js:42-46`, `81-88` — 预检与执行都直接使用 unconstrained `path.resolve`。
- `/tmp` probe — `../outside` 被解析并作为 `/tmp/codews-audit-A02/outside` 的 Git cwd。
- `/tmp` clone probe — `../escaped-target` 在 workspace 外创建了 Git 仓库，workspace 内对应目标不存在。
- [A02 evidence table](results/A02-workspace-safety-boundary.md#evidence)
- [A03 evidence table](results/A03-switch-execution-lifecycle.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: 每个仓库目标在任何 status/reset/fs/Git/hook 操作前证明位于 canonical workspace root 内，越界配置 fail closed。

---

### AUD-003 — force 在未清理 untracked 时返回 clean

- **Status**: `confirmed`
- **Severity**: `P2`
- **Category**: 脏状态门禁 / destructive option
- **Confidence**: high
- **Source Tasks**: [A02 Result](results/A02-workspace-safety-boundary.md); A03 boundary input

#### Claim

`--force` 对非空 dirty status 只执行 `git reset --hard`，既不执行声明中的 clean，也不复检；因此 untracked 文件仍存在时 `checkDirty` 返回 `true`。

#### Risk / Impact

CLI 随后进入 checkout，可能因残留文件失败，或在成功后保留不属于目标环境的内容；同时输出语义与 force 的 clean 承诺不一致。

#### Call Chain / Data Flow

`switch --force → checkDirty → getRealDirtyStatus → git reset --hard → true → checkoutWorkspace`

#### Counter-evidence Checked

- Stash 路径在执行后调用 `getRealDirtyStatus` 复检，force 路径没有。
- 搜索所有源码未找到 `git clean`、force 后复检或替代清理实现。
- `/tmp` 探针只触及专用测试仓库；返回 true 后 Git 仍报告 untracked 文件。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A02 completion

#### Finding Evidence

- `src/git.js:50-61` — force 仅 reset；只有 stash 分支复检。
- `src/cli.js:56-64` — true 直接进入 checkout。
- `ARCHITECTURE.md:65-70`, `src/cli.js:43-45` — 当前产品/CLI clean 契约。
- `/tmp` probe — `forceCheckDirty=true` 且随后仍有 `?? untracked.txt`。
- [A02 evidence table](results/A02-workspace-safety-boundary.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: force 路径要么按已确认产品语义清理 untracked，要么在残留 dirty status 时返回 false；任何 destructive behavior 必须有回归测试。

---

### AUD-004 — commit-only 首次克隆使用 undefined 分支

- **Status**: `confirmed`
- **Severity**: `P2`
- **Category**: Git clone / commit pinning
- **Confidence**: high
- **Source Tasks**: [A03 Result](results/A03-switch-execution-lifecycle.md)

#### Claim

缺失目标仓库且配置只有 `commit`、没有 `branch` 时，默认 depth 为 0，但普通 clone 无条件拼接 `-b ${branch}`，实际执行 `-b undefined` 并在 commit checkout 前失败。

#### Risk / Impact

架构文档明确支持跳过 branch 的 pinned commit；该合法配置在首次拉取时不可用。已有仓库路径或显式 `depth>0` 的 targeted 分支不能覆盖默认首次 clone。

#### Call Chain / Data Flow

`config.commit → depth=0 / branch=undefined → cloneCmd -b undefined → git clone failure → CLI catch`

#### Counter-evidence Checked

- 显式正 depth 会进入 targeted/full fallback，能够绕开普通 clone；commit-only 默认不会进入该分支。
- 继承配置可能保留 branch，但直接 commit-only 是文档声明的独立能力。
- clone 后的 `git checkout commit` 存在，但永远晚于失败命令。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A03 completion

#### Finding Evidence

- `src/git.js:84-90`, `138-145` — 默认 depth 与无条件 `-b branch` clone 构造。
- `ARCHITECTURE.md:71-74` — branch 可省略的 commit pinning 契约。
- `/tmp` probe — 失败命令为 `git clone ... -b undefined CommitOnly`。
- [A03 evidence table](results/A03-switch-execution-lifecycle.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: commit-only 首次 clone 在本地和远端 fixture 中成功落到指定 detached commit，且不构造 undefined branch。

---

### AUD-005 — 后续仓库失败时保留前序仓库变更

- **Status**: `confirmed`
- **Severity**: `P1`
- **Category**: 多仓生命周期 / 原子性
- **Confidence**: high
- **Source Tasks**: [A03 Result](results/A03-switch-execution-lifecycle.md); A04 reporting review pending

#### Claim

`checkoutWorkspace` 按顺序立即改变每个仓库；任一后续仓库失败时异常直接传播，之前完成的 clone/checkout/pull/hook 没有 rollback、补偿记录或恢复步骤。

#### Risk / Impact

一次失败的多仓切换会留下与目标环境不一致的部分状态，违背项目的“防撕裂”定位；开发者只收到整体失败，没有机器可读的已变更集合。

#### Call Chain / Data Flow

`switch → all-clean gate → repo[0] mutation → repo[1] failure → exception → CLI failure; repo[0] remains mutated`

#### Counter-evidence Checked

- 搜索 rollback/restore/compensation/transaction/journal 和失败后状态修复，未找到实现。
- CLI catch 会显示失败，但不会还原或枚举已经成功处理的仓库。
- `/tmp` 两仓探针确认第二仓失败后第一仓的 `.git` 仍存在。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A03 completion

#### Finding Evidence

- `src/git.js:77-83`, `113-175` — 顺序 mutation 循环且无补偿。
- `src/cli.js:63-69` — 失败仅进入 catch。
- `ARCHITECTURE.md:61-65` — 避免中间撕裂态的产品约束。
- `/tmp` probe — 第二 clone 失败，`firstRepoRemains=true`。
- [A03 evidence table](results/A03-switch-execution-lifecycle.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-planning` 先确定事务/补偿策略，再由 `dev-harness-auto-fix` 实现明确范围
- **Acceptance direction**: 失败注入测试证明切换要么回到原状态，要么生成准确、可执行的部分状态恢复信息，且产品契约同步。

---

### AUD-006 — 带空格的克隆目标路径失败

- **Status**: `confirmed`
- **Severity**: `P2`
- **Category**: 子进程参数边界
- **Confidence**: high
- **Source Tasks**: [A03 Result](results/A03-switch-execution-lifecycle.md)

#### Claim

缺失仓库的 clone 命令把 URL、branch 和目标 basename 插入单个 shell 字符串；目标路径 basename 含空格时被拆为多个 Git 参数，clone 失败。

#### Risk / Impact

合法的自定义目录名称在首次 clone 时不可用；同一构造方式也扩大了所有配置派生 shell operand 的审查面，但本 Finding 只确认空格 tokenization 缺陷。

#### Call Chain / Data Flow

`config.path → repoPath → path.basename(repoPath) → cloneCmd string → /bin/sh tokenization → git clone failure`

#### Counter-evidence Checked

- 已存在仓库通过独立 `cwd` 执行 Git，不需要把目录名放入命令，因此该路径不受同一空格问题影响。
- 缺失仓库 clone 没有 argv/spawn 或 quoting 替代实现。
- `post_hooks` 的信任语义与此不同；未用它扩大安全结论。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A03 completion

#### Finding Evidence

- `src/git.js:11-18`, `138-141` — 字符串 shell 执行与未引用 clone operands。
- `/tmp` probe — `Repo With Space` 出现在未引用命令中并导致 clone 失败。
- [A03 evidence table](results/A03-switch-execution-lifecycle.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: 用 argv 形式执行 Git；覆盖带空格的目标路径与 URL，并验证参数不会被 shell 重新解释。

---

### AUD-007 — status -e 对不匹配与缺失返回成功

- **Status**: `confirmed`
- **Severity**: `P2`
- **Category**: 状态契约 / 自动化退出码
- **Confidence**: high
- **Source Tasks**: [A04 Result](results/A04-status-runtime-contracts.md)

#### Claim

配置感知的 `status -e` 只打印 missing、branch/commit mismatch、dirty 或 error 状态，不聚合失败结果；CLI action 返回后进程仍以 0 退出。

#### Risk / Impact

脚本和 CI 无法用退出码判断 workspace 是否符合环境配置，可能把缺仓、错分支或读取失败误当作验证成功。

#### Call Chain / Data Flow

`codews status -e → getResolvedWorkspace → statusWorkspace → printed mismatch/missing/error → undefined return → process exit 0`

#### Counter-evidence Checked

- 缺失配置文件会显式 `process.exit(1)`，但仓库级 mismatch/missing/error 不会。
- 搜索未找到 aggregate boolean、throw、exitCode 或另一条 strict verification 命令。
- `/tmp` 探针同时包含错分支和缺失仓库，最终 `exitCode=0`。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A04 completion

#### Finding Evidence

- `src/git.js:179-212` — 所有异常状态仅格式化输出。
- `src/cli.js:73-88` — 调用后没有返回值检查或退出码。
- `/tmp` probe — mismatch + missing 输出后 `exitCode=0`。
- [A04 evidence table](results/A04-status-runtime-contracts.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: status 聚合每仓结果；`-e` 在 missing/dirty/mismatch/error 时非零退出，并保留人类可读明细与自动化回归。

---

### AUD-008 — 默认 status 漏掉深层嵌套仓库

- **Status**: `confirmed`
- **Severity**: `P3`
- **Category**: 仓库发现 / 状态覆盖
- **Confidence**: high
- **Source Tasks**: [A04 Result](results/A04-status-runtime-contracts.md)

#### Claim

无 `-e` 的 status 只检查当前目录与直接子目录，因而不会发现第二层及更深的 Git 仓库。

#### Risk / Impact

在项目已支持嵌套仓库的情况下，默认状态视图会漏报深层仓库的 branch 和 dirty 状态，给开发者不完整的工作区视图。

#### Call Chain / Data Flow

`codews status → statusWorkspace(null) → readdirSync(currentDir) → immediate child check only`

#### Counter-evidence Checked

- `status -e` 会按配置路径检查嵌套仓库，但需要显式环境且不修复默认命令的覆盖承诺。
- 配置枚举自身是递归的，说明递归能力存在但未用于 repo discovery。
- `/tmp` 两层嵌套仓库探针确认 Git 仓库存在，而默认扫描没有输出它。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A04 completion

#### Finding Evidence

- `src/git.js:213-242` — 只遍历 immediate subdirectories。
- `/tmp` probe — `Level1/Level2/.git` 存在，输出只含扫描标题且退出 0。
- [A04 evidence table](results/A04-status-runtime-contracts.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-auto-fix`
- **Acceptance direction**: 明确默认发现边界并覆盖嵌套 fixture；若承诺“所有仓库”，递归扫描需有 symlink、vendor、性能和重复仓库保护。

---

### AUD-009 — 没有可成功执行的自动化验证入口

- **Status**: `confirmed`
- **Severity**: `P3`
- **Category**: 验证契约
- **Confidence**: high
- **Source Tasks**: [A04 Result](results/A04-status-runtime-contracts.md)

#### Claim

仓库唯一的 npm test script 是固定输出错误并 exit 1 的占位命令，且 Context/HARNESS 未找到 test、quick、bugfix 或 full 验证入口。

#### Risk / Impact

涉及 reset、clone、checkout、路径和 shell 边界的回归无法通过统一入口验证；本次审计只能依赖一次性受控探针。

#### Call Chain / Data Flow

`package scripts / repository files → Context evidence → HARNESS command mapping → no successful verification command`

#### Counter-evidence Checked

- 搜索了 package scripts、全部仓库文件、tests 和 CI 配置；没有替代入口。
- 未把安装或运行命令冒充测试命令。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A04 completion

#### Finding Evidence

- `package.json:9-10` — test 是失败占位。
- `HARNESS.md:17-30` — test/quick/bugfix/full 全为 Unknown。
- 仓库文件清单 — 不存在 tests 或 CI 配置。
- [A04 evidence table](results/A04-status-runtime-contracts.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-commands`
- **Acceptance direction**: 建立可重复的 quick/bugfix/full 入口，至少覆盖配置继承、路径 containment、dirty gate 与本地 Git 生命周期 fixture。

---

### AUD-010 — package-lock 根包元数据过期

- **Status**: `confirmed`
- **Severity**: `P3`
- **Category**: 包元数据 / 发布一致性
- **Confidence**: high
- **Source Tasks**: [A04 Result](results/A04-status-runtime-contracts.md)

#### Claim

`package-lock.json` 的根包仍声明 `codeworkspace@1.0.0` 和 ISC，而 `package.json` 已是 `codews-cli@1.2.0` 和 MIT。

#### Risk / Impact

依赖安装工具、版本审计和发布自动化看到互相冲突的根包身份与许可证，增加不可复现或错误发布元数据的风险。

#### Call Chain / Data Flow

`package.json release identity ↔ package-lock root package record → npm/release tooling`

#### Counter-evidence Checked

- Commander 依赖版本在两份文件中一致，因此不是依赖解析漂移。
- CLI 硬编码版本与 package.json 当前同为 1.2.0；不把未来漂移风险计入本 Finding。

#### Snapshot

- **Run / Base SHA / Branch**: `codews-20260819-705aff0` / `705aff047a1b40b45d6478ee6841a0f3ffc70ccf` / `master`
- **Context / Dirty Fingerprint**: `91941f7e01fae2887ea110260295a3e9a0cc4140ff710e4ffb636d3e756a788d` / `ddf17939ff1d0855eddf6c0df61cc43f3bee6450b88647f75b9cc4796b0370ec`
- **Last verified**: A04 completion

#### Finding Evidence

- `package.json:2-3,25` — 当前根包名、版本和许可证。
- `package-lock.json:2-10` — 旧的根包元数据。
- [A04 evidence table](results/A04-status-runtime-contracts.md#evidence)

#### Suggested Next Action

- **Handoff**: `dev-harness-git-workflow`
- **Acceptance direction**: 在确认发布身份后重建/刷新 lockfile，验证 name/version/license 与 package.json 一致且依赖树不变。

---

> `confirmed` 必须有当前 Snapshot、代码或运行 Evidence、反证检查和完成的 cross-module reconciliation。漂移后移入 `stale`，不得继续作为当前事实。
