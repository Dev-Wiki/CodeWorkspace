# CodeWorkspace (codews) 系统架构与演进规划

## 一、架构定位与设计原则

CodeWorkspace 是一个面向多仓库（Multi-Repo）工程的**配置化版本编排器**。
它摒弃了传统的黑盒 Shell 脚本，引入了基于声明式 JSON 的状态流转机制。

### 核心设计
- **声明式驱动 (SSOT)**：Workspace JSON 是定义环境流转的唯一标准，拒绝 if/else 脚本逻辑黑盒。
- **安全沙箱 (Fail-Fast)**：绝对禁止脏工作区引发的环境穿透，在发生任何分支调度前进行严苛的状态机校验。
- **动态继承 (Dev Fork)**：通过局部重写机制实现基线环境派生，拒绝产生庞大、冗余且难以维护的扁平配置文件。

## 二、系统架构设计

**核心引擎架构**：目前采用 Node.js 原生实现，追求极简、无依赖与无状态（Stateless）。

```text
[ CLI 交互层 (Commander.js) ]
          ↓
[ 配置解析引擎 (Config Parser) ]
  - 智能向上寻址 (Local > Global)
  - 智能根目录倒推 (Smart Root Inference)
  - JSON 动态深度继承树 (Deep Merge)
          ↓
[ Git 调度引擎 (Subprocess) ]
  - 跨进程并发/串行调度
  - 前置安全沙箱 (Dirty Check)
  - 后置生命周期钩子 (Post Hooks)
```

## 三、核心工作流模型 (Dev Fork 机制)

### 3.1 确立稳定基线 (Base Workspace)
首先在全局维护一个基础配置文件，定义系统在某个节点（如发版时刻）所有底层组件的绝对稳定状态。
```json
{
  "name": "release_master",
  "repos": {
    "RepoX": { "branch": "master" },
    "RepoY": { "branch": "master" },
    "CoreLib": { "branch": "master" }
  }
}
```

### 3.2 局部按需派生 (Override Workspace)
当上层业务线的开发者只需要拉起环境并修改其中的 `RepoX` 组件时，无需复制大量无关配置，只需建立一个极简的子 JSON：
```json
{
  "base": "release_master.json",
  "repos": {
    "RepoX": {
      "branch": "bugfix_login_001"
    }
  }
}
```
**运行机制**：引擎在执行切换时，会通过动态继承自动拉取基线中的 `RepoY` 和 `CoreLib`，而唯独将 `RepoX` 切至业务所需的 Bugfix 分支。这极大地降低了环境维护与分支冲突的心智负担。

## 四、安全调度沙箱

为了避免跨子仓库切分支导致的“代码丢失”与“中间撕裂态”，底层引擎引入了多级防御机制：

1. **强阻断脏检查 (Strict Dirty Check)**
   在发生任何写操作前，引擎对所有受管仓库进行静默的 `git status --porcelain` 扫描。只要有哪怕一个仓库处于未提交状态，系统立即中断全局流转，拒绝污染开发者的原始工作现场。

2. **高级逃生舱 (Escape Hatches)**
   在明确授权下，允许高级开发者通过 Flag 穿透默认的安全阻断：
   - `--stash`（自动收容）：静默收取当前脏工作区的增量（含 Untracked 文件），推入对应子库的暂存栈，随后完成安全检出。
   - `--force`（暴力碾压）：执行核打击级的 `git reset --hard` 与内置防死锁降级的 `git clean -xdf` 策略，强行对齐目标基线。

3. **游离态检出 (Detached Checkout)**
   对于极度敏感的特定历史版本依赖，系统支持跳过 `branch`，直接声明底层的 `commit` Hash 字段。此时引擎将自动跳过不可预测的 `git pull` 操作，执行无缝的静态快照锚定。

## 五、演进路线与里程碑

### V1 阶段：核心 CLI (MVP) —— **已完成 ✅**
- **技术选型**：废弃早期构想的重型系统级语言（Rust）方案，彻底转向 Node.js 以换取极高的敏捷迭代能力。
- **核心成果**：完成无状态环境编排引擎的底层地基构建。
  - [x] JSON Base/Override 动态继承引擎，大幅削减冗余配置
  - [x] 跨多仓库智能根目录倒推算法 (Smart Root Inference)
  - [x] 强制前置 Status 脏状态阻断安全沙箱机制
  - [x] 完备的基础指令族：`list` / `show` / `switch` / `status`
  - [x] 高级安全检出机制：游离 Commit 锚定与 `--stash` / `--force` 双模式逃生舱

### V2 阶段：轻量级可视化交互 (Visual UX) —— **规划中 🚧**
鉴于动辄数十个仓库的手动 JSON 编辑易产生拼写错误，后续核心发力点在于消除最后一部分配置的心智负担。
**核心原则：坚决拒绝包含 Tauri / Electron 的重型桌面端框架，保持极客级轻量体验。**

- **里程碑 A：终端 UI (CLI TUI)**
  通过原生终端实现轻量级界面。执行 `codews edit` 呼出命令行动画菜单。开发者通过方向键与空格键，快速勾选需要覆盖的仓库，提供实时的远程分支联想补全，最终自动回写生成 JSON 结构。
- **里程碑 B：IDE 侧边栏集线器 (VSCode Extension)**
  向集成开发环境渗透。直接挂载于 VSCode 侧边栏，呈现全局 Workspace 的树状拓扑视图，支持可视化点选一键切换环境直达现场，并以红绿灯形式直观透出各个模块当前的脏状态与游离态。
