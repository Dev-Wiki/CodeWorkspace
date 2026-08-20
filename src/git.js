const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function promptUser(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

function runCommand(cmd, cwd, streamOutput = false) {
    try {
        const options = { cwd, encoding: 'utf8' };
        options.stdio = (streamOutput && !process.env.CI) ? 'inherit' : 'pipe';
        const result = execSync(cmd, options);
        return result ? result.trim() : '';
    } catch (err) {
        throw new Error(`Command failed: ${cmd}\nIn directory: ${cwd}\nError: ${err.stderr || err.message}`);
    }
}

function runGitCommand(args, cwd) {
    try {
        const result = execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return result ? result.trim() : '';
    } catch (err) {
        const command = ['git', ...args].map(value => JSON.stringify(value)).join(' ');
        throw new Error(
            `Command failed: ${command}\nIn directory: ${cwd}\nError: ${err.stderr || err.message}`
        );
    }
}

function captureRepositorySnapshot(repoPath) {
    if (!fs.existsSync(repoPath)) {
        return { existed: false };
    }

    return {
        existed: true,
        realPath: fs.realpathSync(repoPath),
        head: runGitCommand(['rev-parse', 'HEAD'], repoPath),
        branch: runGitCommand(['branch', '--show-current'], repoPath),
        dirtyStatus: getRealDirtyStatus(repoPath)
    };
}

function buildRecoveryActions(record) {
    if (!record.snapshot.existed) {
        return [{ type: 'remove-directory', path: record.repoPath }];
    }

    const checkoutArgs = record.snapshot.branch
        ? ['checkout', record.snapshot.branch]
        : ['checkout', '--detach', record.snapshot.head];
    return [
        { type: 'git', cwd: record.repoPath, args: checkoutArgs },
        { type: 'git', cwd: record.repoPath, args: ['reset', '--hard', record.snapshot.head] }
    ];
}

function rollbackRepository(record) {
    const action = record.snapshot.existed
        ? 'restore-existing-repository'
        : 'remove-new-repository';
    const recoveryActions = buildRecoveryActions(record);
    const result = {
        repoName: record.repoName,
        repoPath: record.repoPath,
        action,
        status: 'restored',
        recoveryActions,
        executedHooks: record.executedHooks
    };

    if (record.snapshot.dirtyStatus) {
        result.status = 'manual-recovery-required';
        result.recoveryActions = [];
        result.reason = 'Pre-existing changes detected; automatic destructive recovery was withheld.';
        result.originalStatus = record.snapshot.dirtyStatus;
        return result;
    }

    try {
        if (record.snapshot.existed
            && fs.realpathSync(record.repoPath) !== record.snapshot.realPath) {
            throw new Error(
                `Repository path changed during switch: ${JSON.stringify(record.repoPath)}`
            );
        }

        for (const recoveryAction of recoveryActions) {
            if (recoveryAction.type === 'remove-directory') {
                if (fs.existsSync(recoveryAction.path)) {
                    fs.rmSync(recoveryAction.path, { recursive: true, force: true });
                }
            } else {
                runGitCommand(recoveryAction.args, recoveryAction.cwd);
            }
        }

        if (record.snapshot.existed) {
            const residualStatus = getRealDirtyStatus(record.repoPath);
            if (residualStatus) {
                result.status = 'manual-recovery-required';
                result.residualStatus = residualStatus;
            }
        }
    } catch (err) {
        result.status = 'failed';
        result.error = err.message;
    }

    return result;
}

function rollbackWorkspace(records) {
    return records.slice().reverse().map(rollbackRepository);
}

class WorkspaceSwitchError extends Error {
    constructor(failedRepository, cause, rollbackResults) {
        super(`Repository ${JSON.stringify(failedRepository)} failed: ${cause.message}`);
        this.name = 'WorkspaceSwitchError';
        this.code = 'WORKSPACE_SWITCH_FAILED';
        this.recoveryReport = {
            failedRepository,
            originalError: cause.message,
            rollbackResults
        };
    }
}

function getRealDirtyStatus(repoPath) {
    const status = runCommand('git status --porcelain', repoPath);
    if (!status) return "";
    const statusLines = status.split('\n').filter(line => line.trim().length > 0);
    const realDirtyLines = statusLines.filter(line => {
        if (line.startsWith('?? ')) {
            const filePath = line.substring(3).trim();
            const fullPath = path.resolve(repoPath, filePath);
            try {
                if (fs.existsSync(path.join(fullPath, '.git'))) {
                    console.log(`[INFO] Auto-ignoring nested git repository: ${filePath}`);
                    return false;
                }
            } catch (e) {}
        }
        return true;
    });
    return realDirtyLines.join('\n');
}

function canonicalizePotentialPath(targetPath) {
    let existingPath = targetPath;
    const missingSegments = [];

    while (!fs.existsSync(existingPath)) {
        const parentPath = path.dirname(existingPath);
        if (parentPath === existingPath) {
            throw new Error(`Unable to resolve repository path: ${targetPath}`);
        }
        missingSegments.unshift(path.basename(existingPath));
        existingPath = parentPath;
    }

    return path.resolve(fs.realpathSync(existingPath), ...missingSegments);
}

function resolveWorkspaceRepoEntries(workspace) {
    if (typeof workspace.workspaceRoot !== 'string') {
        throw new Error('Workspace root must be a filesystem path.');
    }

    const resolvedWorkspaceRoot = path.resolve(workspace.workspaceRoot);
    if (!fs.existsSync(resolvedWorkspaceRoot) || !fs.statSync(resolvedWorkspaceRoot).isDirectory()) {
        throw new Error(`Workspace root does not exist or is not a directory: ${resolvedWorkspaceRoot}`);
    }
    const canonicalWorkspaceRoot = fs.realpathSync(resolvedWorkspaceRoot);

    return Object.entries(workspace.repos).map(([repoName, config]) => {
        const configuredPath = config.path || repoName;
        if (typeof configuredPath !== 'string') {
            throw new Error(`Repository path for ${JSON.stringify(repoName)} must be a string.`);
        }

        const candidatePath = path.resolve(canonicalWorkspaceRoot, configuredPath);
        const repoPath = canonicalizePotentialPath(candidatePath);
        const relativePath = path.relative(canonicalWorkspaceRoot, repoPath);
        const escapesWorkspace = relativePath === '..'
            || relativePath.startsWith(`..${path.sep}`)
            || path.isAbsolute(relativePath);

        if (escapesWorkspace) {
            throw new Error(
                `Repository path for ${JSON.stringify(repoName)} escapes workspace root: `
                + `${JSON.stringify(configuredPath)} resolves to ${JSON.stringify(repoPath)}`
            );
        }

        return { repoName, config, repoPath };
    });
}

async function checkDirty(workspace, options = {}) {
    let allClean = true;
    const repoEntries = resolveWorkspaceRepoEntries(workspace);
    for (const { repoName, repoPath } of repoEntries) {
        if (!fs.existsSync(repoPath)) {
            continue; // Not cloned yet, so it can't be dirty
        }
        try {
            if (options.force) {
                console.log(`[FORCE] Hard resetting and cleaning ${repoName}...`);
                runCommand('git reset --hard', repoPath);
                runCommand('git clean -xdf', repoPath);
                const newStatus = getRealDirtyStatus(repoPath);
                if (newStatus.length > 0) {
                    console.error(`[ERROR] Failed to completely clean ${repoName}:\n${newStatus}`);
                    allClean = false;
                }
                continue;
            }

            const status = getRealDirtyStatus(repoPath);
            if (status.length > 0) {
                if (options.stash) {
                    console.log(`[STASH] Auto-stashing changes in ${repoName}...`);
                    runCommand('git stash push -u -m "codews auto stash before switch"', repoPath);
                    const newStatus = getRealDirtyStatus(repoPath);
                    if (newStatus.length > 0) {
                        console.error(`[ERROR] Failed to completely stash ${repoName}:\n${newStatus}`);
                        allClean = false;
                    }
                } else {
                    console.error(`[DIRTY] Repository ${repoName} at ${repoPath} has uncommitted changes:\n${status}`);
                    allClean = false;
                }
            }
        } catch (err) {
            console.error(`[ERROR] Failed to check status for ${repoName}: ${err.message}`);
            allClean = false;
        }
    }
    return allClean;
}

async function checkoutWorkspace(workspace, options = {}) {
    const reposEntries = resolveWorkspaceRepoEntries(workspace);
    const total = reposEntries.length;
    const mutationRecords = [];
    let currentRepository = null;
    let index = 0;

    try {
        for (const { repoName, config, repoPath } of reposEntries) {
            currentRepository = repoName;
            index++;
            const branch = config.branch;
            const commit = config.commit;
            const url = config.url;
            let depth = config.depth !== undefined ? config.depth : (commit ? 0 : 1);
            if (options.full) depth = 0;

            if (commit && config.depth !== undefined && depth > 0) {
                if (process.stdout.isTTY && !process.env.CI) {
                    console.warn(`\n[WARNING] 仓库 ${repoName} 同时指定了具体 commit 与 depth:${config.depth}，这极易导致克隆后找不到历史树。`);
                    let ans = '';
                    while (!['1', '2', '3'].includes(ans)) {
                        ans = await promptUser(`请选择处理方式：\n[1] 尝试精准浅拉取（若远端拒绝则自动转全量）(强烈推荐)\n[2] 放弃浅拉取，直接走全量克隆 (最保守)\n[3] 终止操作\n请输入 1/2/3: `);
                        ans = ans.trim();
                    }
                    if (ans === '1') {
                        depth = 'targeted';
                    } else if (ans === '2') {
                        depth = 0;
                    } else if (ans === '3') {
                        throw new Error('User aborted.');
                    }
                } else {
                    console.warn(`[WARNING] 非交互环境：检测到 ${repoName} 存在冲突配置 (commit + depth>0)，自动降级为全量克隆以保安全。`);
                    depth = 0;
                }
            }

            console.log(`[${index}/${total}] Processing ${repoName}...`);

            if (!fs.existsSync(repoPath) && !url) {
                console.warn(`[WARN] Skipping ${repoName} - directory does not exist and no URL provided.`);
                continue;
            }

            const mutationRecord = {
                repoName,
                repoPath,
                snapshot: captureRepositorySnapshot(repoPath),
                executedHooks: []
            };
            mutationRecords.push(mutationRecord);

            if (!mutationRecord.snapshot.existed) {
                console.log(`Cloning ${repoName}...`);
                // Ensure parent directory exists
                fs.mkdirSync(path.dirname(repoPath), { recursive: true });

                if (depth === 'targeted') {
                    runCommand('git init', repoPath);
                    runCommand(`git remote add origin ${url}`, repoPath);
                    try {
                        console.log(`Attempting targeted shallow fetch for commit ${commit}...`);
                        runCommand(`git fetch --depth 1 origin ${commit}`, repoPath, true);
                        runCommand(`git checkout ${commit}`, repoPath);
                        continue;
                    } catch (e) {
                        console.warn(`[WARN] 服务端拒绝了精确游离拉取，开始执行全量兜底...`);
                        fs.rmSync(repoPath, { recursive: true, force: true });
                        fs.mkdirSync(path.dirname(repoPath), { recursive: true });
                        depth = 0;
                    }
                }

                const branchArg = branch ? ` -b ${branch}` : '';
                const cloneCmd = depth > 0
                    ? `git clone --depth ${depth} --single-branch --no-tags ${url}${branchArg} ${path.basename(repoPath)}`
                    : `git clone ${url}${branchArg} ${path.basename(repoPath)}`;
                runCommand(cloneCmd, path.dirname(repoPath), true);
                if (commit) {
                    console.log(`Checking out specific commit ${commit} in ${repoName}...`);
                    runCommand(`git checkout ${commit}`, repoPath);
                }
            } else {
                const target = commit ? commit : branch;
                console.log(`Fetching and checking out ${target} in ${repoName}...`);

                if (!commit) {
                    try {
                        // 为了防止该仓库是以 --single-branch 克隆的，在此显式将目标分支加入 fetch 列表
                        runCommand(`git remote set-branches --add origin ${target}`, repoPath, true);
                    } catch(e) {}
                }

                runCommand('git fetch origin', repoPath, true);
                runCommand(`git checkout ${target}`, repoPath);

                if (!commit) {
                    try {
                        runCommand('git pull', repoPath, true);
                    } catch(e) {
                        console.warn(`[WARN] git pull failed for ${repoName} (might be detached or not tracking upstream)`);
                    }
                }
            }

            if (config.post_hooks && config.post_hooks.length > 0) {
                console.log(`Running post_hooks for ${repoName}...`);
                for (const hook of config.post_hooks) {
                    console.log(`  > ${hook}`);
                    const hookResult = { command: hook, status: 'failed' };
                    mutationRecord.executedHooks.push(hookResult);
                    runCommand(hook, repoPath);
                    hookResult.status = 'completed';
                }
            }
        }
    } catch (err) {
        const rollbackResults = rollbackWorkspace(mutationRecords);
        throw new WorkspaceSwitchError(currentRepository, err, rollbackResults);
    }
}

function statusWorkspace(workspace = null) {
    if (workspace) {
        console.log(`Checking status against environment: ${workspace.name}\n`);
        const repoEntries = resolveWorkspaceRepoEntries(workspace);
        for (const { repoName, config, repoPath } of repoEntries) {
            if (!fs.existsSync(repoPath)) {
                console.log(`${repoName.padEnd(20)} [MISSING]  Not cloned yet`);
                continue;
            }
            try {
                const headCommit = runCommand('git rev-parse HEAD', repoPath);
                let branch = '';
                try {
                    branch = runCommand('git branch --show-current', repoPath);
                } catch(e) {}
                
                const dirty = getRealDirtyStatus(repoPath);
                const statusStr = dirty.length > 0 ? '[DIRTY]' : '[CLEAN]';
                
                let branchStr = "";
                if (config.commit) {
                    const shortHead = headCommit.substring(0, 7);
                    const shortExpected = config.commit.substring(0, 7);
                    branchStr = headCommit.startsWith(config.commit) ? `Commit: ${shortHead}` : `Commit: ${shortHead} (Expected: ${shortExpected})`;
                } else {
                    const expected = config.branch;
                    branchStr = branch === expected ? `Branch: ${branch}` : `Branch: ${branch || 'Detached'} (Expected: ${expected})`;
                }
                
                console.log(`${repoName.padEnd(20)} ${statusStr.padEnd(9)} ${branchStr}`);
            } catch (err) {
                console.log(`${repoName.padEnd(20)} [ERROR]    Failed to check git status`);
            }
        }
    } else {
        console.log(`Scanning current directory for Git repositories...\n`);
        const currentDir = process.cwd();

        const checkAndPrint = (repoPath, displayName) => {
            if (fs.existsSync(path.join(repoPath, '.git'))) {
                try {
                    const branch = runCommand('git branch --show-current', repoPath);
                    const dirty = getRealDirtyStatus(repoPath);
                    const statusStr = dirty.length > 0 ? '[DIRTY]' : '[CLEAN]';
                    console.log(`${displayName.padEnd(20)} ${statusStr.padEnd(9)} Branch: ${branch}`);
                } catch (err) {
                    console.log(`${displayName.padEnd(20)} [ERROR]    Failed to check git status`);
                }
            }
        };

        // 1. Check current directory itself
        if (fs.existsSync(path.join(currentDir, '.git'))) {
            checkAndPrint(currentDir, path.basename(currentDir));
        }

        // 2. Check all immediate subdirectories
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== '.git') {
                const repoPath = path.join(currentDir, entry.name);
                checkAndPrint(repoPath, entry.name);
            }
        }
    }
}

function printSwitchSummary(workspace) {
    console.log('\n--- Workspace Switch Summary ---');
    const repoEntries = resolveWorkspaceRepoEntries(workspace);
    for (const { repoName, repoPath } of repoEntries) {
        if (!fs.existsSync(repoPath)) {
            console.log(`${repoName.padEnd(20)} [MISSING] Not cloned`);
            continue;
        }
        try {
            let branch = 'Detached';
            try {
                const current = runCommand('git branch --show-current', repoPath);
                if (current) branch = current;
            } catch (e) {}

            let logMsg = 'No commits yet';
            try {
                logMsg = runCommand('git log -1 --format="%h %s"', repoPath);
            } catch (e) {}

            console.log(`${repoName.padEnd(20)} Branch: ${branch.padEnd(15)}`);
            console.log(`                     └─ ${logMsg}`);
        } catch (err) {
            console.log(`${repoName.padEnd(20)} [ERROR] Failed to retrieve info`);
        }
    }
    console.log('--------------------------------\n');
}

module.exports = {
    WorkspaceSwitchError,
    checkDirty,
    checkoutWorkspace,
    statusWorkspace,
    printSwitchSummary
};
