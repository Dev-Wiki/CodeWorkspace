# CodeWorkspace (codews)

CodeWorkspace 是一款轻量级、配置驱动的多仓库 (Multi-Repo) 工作区环境管理工具。专为解决大型复杂项目（如多仓库交叉依赖、定制化 Bugfix 分支环境）而设计。

## 核心特性

- **配置驱动**：告别难以维护的、硬编码的 Shell 脚本，所有分支配置使用标准 JSON 声明。
- **动态继承 (Dev Fork)**：利用 Base 继承机制，只需几行 JSON 即可派生出局部的 Bugfix 环境，未修改的仓库自动继承基线分支。
- **安全拦截 (防撕裂)**：在执行并发检出前，强制执行 Git 脏状态（Dirty Check）前置校验。引擎具备智能嵌套识别能力，自动豁免内嵌子仓库，并在发现真实的未提交代码时自动阻断操作，绝不污染工作区。
- **自动层级拉取**：原生支持无限级深度的子目录嵌套与自定义 Hook (如 `git lfs pull`, `unzip`)。

## 安装

由于本工具极度轻量且无冗余依赖，你可以直接通过原生 npm 从 GitHub 全局静默安装：

```bash
# 方案一：通过 HTTPS 源码压缩包直装（推荐，避开 SSH 鉴权拦截）
npm install -g https://github.com/Dev-Wiki/CodeWorkspace/tarball/master

# 方案二：传统克隆安装
git clone https://github.com/Dev-Wiki/CodeWorkspace.git
cd CodeWorkspace
npm install -g .
```

执行完毕后，`codews` 命令将被自动注册到操作系统的全局环境变量中，开箱即用。

## 指令速查

```bash
# 列出当前上下文中所有可用的环境配置
codews list

# 切换工作区到指定的配置
codews switch <env_name> [--stash] [--force] [--full]
# --stash: 遇到未提交的代码自动静默执行 git stash
# --force: 暴力覆盖，遇到未提交代码直接 git reset --hard 丢弃
# --full: 全局覆写深度，强制所有仓库（无视 JSON 配置）走 depth=0 全量深克隆

# 查看某个配置的具体详情（仓库、分支、映射路径等）
codews show <env_name>

# 检查当前目录下所有 Git 仓库的脏状态与当前分支
codews status

# 检查当前目录是否严格符合某个环境配置（跨分支校验、缺漏校验、Hash比对）
codews status -e <env_name>
```

## 配置寻址与全局使用指南 (Local > Global)

`codews` 引擎内置了“就近向上查找”机制。你可以自由选择将配置文件（`.codews/*.json`）放在**工程内部**或**全局环境**中。

### 1. 局部（工程级）使用方式

在你的具体工程根目录（例如 `D:\Code\ProjectA`）下创建 `.codews` 文件夹：
```text
D:\Code\ProjectA\
  ├── .codews\
  │   ├── release_master.json
  │   └── bugfix_01.json
  ├── RepoX\
  └── RepoY\
```
当你在 `ProjectA` 或者其任何子目录（如 `RepoX`）下执行 `codews switch release_master` 时，工具会自动向上查找到工程级配置并执行。

### 2. 全局（系统级）使用方式

如果你有多个大工程，希望集中管理所有基线配置，可以使用全局目录 `~/.codews/`（Windows 上通常是 `C:\Users\你的用户名\.codews\`）。

强烈建议在全局模式下通过**子文件夹划分命名空间**：
```text
C:\Users\YourName\.codews\
  ├── ProjectA\
  │   └── release_v1.0.json
  └── ProjectB\
      └── release_master.json
```

**全局跨项目调用方式**：
在全局存储后，你可以在任意目录下，通过追加文件夹名称（命名空间）直接切换不同项目的环境：
```bash
# 切换 ProjectA 环境
codews switch ProjectA/release_v1.0
```

**智能根目录倒推 (Smart Root Inference)**：
当你使用全局配置时，如果你身处于某个深层子仓库（如 `D:\Code\ProjectB\RepoX\src\...`），引擎会智能调用底层 `git rev-parse` 获取当前所在的物理库顶层路径，并结合 JSON 配置中的相对路径做减法，**自动算出全局工程真正的 Workspace Root**。你再也不用繁琐地 `cd ../../../` 退回根目录再执行。

## 配置匹配逻辑 (Matching Rule)

**常见疑惑：工具怎么知道我当前的子仓库 `RepoX` 属于哪个全局配置文件？**

**答案：工具本身不猜测，全靠你主动指定。**

当你执行 `codews switch <配置名>` 时，引擎的执行链路如下：
1. **寻找配置文件**：如果你输入了 `codews switch ProjectB/release_master`，工具会直接去 `~/.codews/ProjectB/release_master.json` 读取内容。
2. **读取映射表**：工具打开该 JSON，查看里面的 `"repos"` 节点。
3. **相对路径执行**：引擎以智能推断出的根目录（或当前终端目录）为基准，去寻找或拉取 JSON 里配置的相对路径（如 `"path": "RepoX"`）。

因此，并不是 `RepoX` 自动对应了全局的某个文件，而是你主动用指定的 JSON 文件对该目录下的所有子文件夹下达了 Git 调度指令。

## JSON 配置文件规范

配置分为 `base` (可选继承) 和 `repos` (核心定义) 两个关键节点。

### 基线配置示例 (`release_master.json`)
```json
{
  "name": "release_master",
  "repos": {
    "RepoX": {
      "path": "RepoX",
      "url": "ssh://git@xxx/RepoX.git",
      "branch": "master"
    },
    "RepoY_Nested": {
      "path": "RepoX/common/base/RepoY_Nested",
      "branch": "release_1.0",
      "commit": "a1b2c3d",
      "depth": 1,
      "post_hooks": [
        "powershell -Command \"...\""
      ]
    }
  }
}
```
**说明**：
- `branch`：检出的分支名称。
- `commit` (高级)：支持直接配置 `commit` Hash 值，引擎会光速检出该 Detached 节点。
- `depth` (可选)：克隆深度，默认值为 `1`（开启浅克隆，仅拉取指定分支单层历史记录）。若需拉取完整提交历史，请配置为 `0`。
- `post_hooks`：切换完分支后需要自动执行的 Shell 脚本指令。

### 继承重写示例 (`bugfix_01.json`)
利用 Base 机制实现局部覆盖（Override）：
```json
{
  "base": "release_master",
  "repos": {
    "RepoX": {
      "branch": "bugfix_login"
    },
    "RepoY_Nested": {
      "ignore": true
    }
  }
}
```
**优势与特性**：
1. **自动补全后缀**：`base` 字段可以简写，引擎会自动补充 `.json`。
2. **缺省继承**：未声明的仓库（如另外 3 个仓），引擎会自动将它们兜底检出为 `release_master` 的分支状态。
3. **深度合并叠加**：如果在子配置只写了 `"commit": "xxx"`，它会从 Base 完美继承 `url` 和 `branch`，初次 Clone 依旧享受极速单分支下载。
4. **一票否决**：`"ignore": true` 拥有最高优先级，会将该仓库从本次运行环境中连根拔起彻底剔除，不再耗费任何性能巡检。

---

## 架构与演进规划

关于本工具的设计哲学（为何放弃 Rust）、系统架构演进，以及未来的 V2 可视化交互界面（TUI / VSCode 插件）规划，请参阅独立的架构白皮书：

👉 [ARCHITECTURE.md](ARCHITECTURE.md)
