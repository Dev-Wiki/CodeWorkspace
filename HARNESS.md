# HARNESS — 项目构建与验证契约

本文件是项目构建、验证和执行环境的唯一事实源。
它定义可执行命令、运行条件和验证边界，不替代 `AGENTS.md` 中的行为、安全与修改约束。

## 项目类型
Node.js CommonJS command-line application

## 编译与启动问题排查
- **WorkingDirectory**: repository root
- **RecommendedTerminal**: PowerShell（Windows）或项目兼容 shell
- **CanRunBuildHere**: unknown
- **BuildCommand**: N/A
- **Reason**: 项目无独立编译或打包步骤

## 自动识别构建命令候选

- **build**: `N/A`
- **test**: `Unknown`
- **quick**: `Unknown`
- **bugfix**: `Unknown`
- **full**: `Unknown`

## 已确认命令（人工维护）

- **build**: `N/A`（项目无独立编译或打包步骤）
- **test**: `npm run harness:test`
- **quick**: `npm run harness:quick`
- **bugfix**: `npm run harness:bugfix`
- **full**: `npm run harness:full`

以上命令均在仓库根目录执行，适用于 Node.js CommonJS CLI，设备要求为 `none`。命令入口由 `package.json` 维护；测试使用 Node.js 内置 test runner，不依赖额外测试框架。

复杂项目可为同一 Purpose 维护多条已确认记录。每条记录使用 `Purpose / Command / WorkingDirectory / Platform / Variant / Preconditions / DeviceRequirement / Shell / Environment / Evidence / Status`；简单项目继续使用上面的单值字段。

## 高风险目录
- `src/`: contains all configuration parsing, filesystem path derivation, subprocess invocation, and destructive repository-switch behavior

## 禁改区域
- bin: generated build outputs
- .git: version control metadata

## 自动识别候选
- No automated test entry is available; package.json contains only a failing placeholder test script.
- Configuration-controlled post_hooks are executed through the shell in each repository working directory.
- Version 1.2.0 is duplicated between package metadata and CLI registration.

## 需人工确认
- Confirm the trust model for local and global `.codews` files because repository URLs, revisions, paths, and post_hooks reach shell and filesystem boundaries.
