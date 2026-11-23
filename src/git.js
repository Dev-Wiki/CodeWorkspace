const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function promptUser(query) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
}

function runHookCommand(command, cwd) {
    try {
        const result = execSync(command, { cwd, encoding: 'utf8', stdio: 'pipe' });
        return result ? result.trim() : '';
    } catch (err) {
        throw new Error(
            `Command failed: ${command}\nIn directory: ${cwd}\nError: ${err.stderr || err.message}`
        );
    }
}

function runGitCommand(args, cwd, streamOutput = false) {
    try {
        const result = execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: (streamOutput && !process.env.CI)
                ? 'inherit'
                : ['ignore', 'pipe', 'pipe']
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
        { type: 'git', cwd: record.repoPath, args: ['reset', '--hard', '--no-recurse-submodules', record.snapshot.head] }
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
        if (record.snapshot.existed) {
            validateRepositoryRoot(record);
            validateChildPathOwnership(record, record.snapshot.head);
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

function getRealDirtyStatus(repoPath, childPaths = [], preserveWorkspaceConfig = false) {
    const args = ['status', '--porcelain'];
    if (childPaths.length > 0) {
        args.push('--untracked-files=all', '--', '.',
            ...childPaths.map(child => `:(exclude,literal)${child}`));
    }
    let status = runGitCommand(args, repoPath);
    if (childPaths.length > 0) {
        // Staged gitlink changes belong to the parent index, even though the
        // child working tree is checked separately.
        const staged = runGitCommand(['diff', '--cached', '--name-status', '--',
            ...childPaths.map(child => `:(literal)${child}`)], repoPath);
        if (staged) status += `\n[INDEX] ${staged}`;
    }
    if (!status) return "";
    const statusLines = status.split('\n').filter(line => line.trim().length > 0);
    const realDirtyLines = statusLines.filter(line => {
        if (line.startsWith('?? ')) {
            const filePath = line.substring(3).trim();
            if (preserveWorkspaceConfig && /^"?\.codews\//.test(filePath)) return false;
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

function getNestedRepositoryPaths(repoPath, repositoryPaths) {
    return repositoryPaths
        .map(child => path.relative(repoPath, child))
        .filter(relative => relative && relative !== '..'
            && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
        .map(relative => relative.split(path.sep).join('/'));
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

    const entries = Object.entries(workspace.repos).map(([repoName, config]) => {
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

    const repositoryPaths = entries.map(entry => entry.repoPath);
    for (const entry of entries) {
        entry.childPaths = getNestedRepositoryPaths(entry.repoPath, repositoryPaths);
    }
    return entries;
}

function validateRepositoryRoot({ repoName, repoPath }) {
    try {
        const actualRoot = runGitCommand(['rev-parse', '--show-toplevel'], repoPath);
        if (path.relative(fs.realpathSync(repoPath), fs.realpathSync(actualRoot)) !== '') {
            throw new Error(`expected ${JSON.stringify(repoPath)}, Git reports ${JSON.stringify(actualRoot)}`);
        }
    } catch (err) {
        throw new Error(`Repository ${JSON.stringify(repoName)} is not a valid Git worktree root: ${err.message}`);
    }
}

function validateChildPathOwnership({ repoName, repoPath, childPaths }, revision = 'HEAD') {
    if (childPaths.length === 0) return;
    // Check both the committed tree and the index: reset --hard restores HEAD,
    // including paths staged for deletion, and can overwrite a nested repository.
    const ancestors = [...new Set(childPaths.flatMap(child => {
        const parts = child.split('/');
        return parts.slice(0, -1).map((part, index) => parts.slice(0, index + 1).join('/'));
    }))];
    // A tree at the child path already proves overlap. Avoid recursive full-tree
    // output (and its subprocess buffer limit) for unrelated parent files.
    const records = [
        ...[...childPaths, ...ancestors].map(targetPath => runGitCommand([
            'ls-tree', '-z', '--full-tree', revision, '--', targetPath
        ], repoPath)),
        runGitCommand(['ls-files', '--stage', '-z', '--',
            ...childPaths.map(child => `:(literal)${child}`)], repoPath),
        ...ancestors.map(ancestor => runGitCommand(['ls-files', '--stage', '-z', '--',
            `:(literal)${ancestor}`, `:(exclude,literal)${ancestor}/`], repoPath))
    ];
    for (const record of records.flatMap(output => output.split('\0').filter(Boolean))) {
        const tab = record.indexOf('\t');
        const trackedPath = record.slice(tab + 1);
        // A gitlink represents a submodule, not files owned by the parent.
        if (record.startsWith('160000 ')) continue;
        const conflict = childPaths.find(child => trackedPath === child
            || trackedPath.startsWith(`${child}/`)
            || (!record.startsWith('040000 ') && child.startsWith(`${trackedPath}/`)));
        if (conflict) {
            throw new Error(`Repository ${JSON.stringify(repoName)} has a tracked path conflict: `
                + `${JSON.stringify(trackedPath)} overlaps configured child ${JSON.stringify(conflict)}.`);
        }
    }
}

function validateWorkspaceRepositories(entries) {
    // Finish every read-only check before the first reset, stash, clone or checkout.
    for (const entry of entries) {
        if (fs.existsSync(entry.repoPath)) validateRepositoryRoot(entry);
    }
    for (const entry of entries) {
        if (fs.existsSync(entry.repoPath)) validateChildPathOwnership(entry);
    }
}

function validateCheckoutChildPaths(entry, target, isCommit) {
    if (entry.childPaths.length === 0) return;
    let remoteTree;
    if (!isCommit) {
        try {
            remoteTree = runGitCommand(['rev-parse', '--verify', '--end-of-options',
                `refs/remotes/origin/${target}^{tree}`], entry.repoPath);
        } catch (err) {
            // A local branch or tag need not have an origin tracking ref.
        }
    }
    let targetTree;
    try {
        targetTree = runGitCommand(['rev-parse', '--verify', '--end-of-options',
            `${target}^{tree}`], entry.repoPath);
    } catch (err) {
        if (!remoteTree) throw err;
        // checkout can create a local tracking branch on its first use.
        targetTree = remoteTree;
    }
    validateChildPathOwnership(entry, targetTree);
    if (remoteTree && remoteTree !== targetTree) {
        // A subsequent pull may advance an already existing local branch.
        validateChildPathOwnership(entry, remoteTree);
    }
}

function hardResetRepository(repoPath) {
    runGitCommand(['reset', '--hard', '--no-recurse-submodules'], repoPath);
}

function forceCleanRepository({ repoName, repoPath, childPaths }, preserveWorkspaceConfig = false) {
    let operation = 'reset tracked files';
    try {
        console.log(`[FORCE] Hard resetting and cleaning ${repoName}...`);
        hardResetRepository(repoPath);
        operation = 'clean untracked and ignored files';
        const cleanArgs = ['clean', '-xdf'];
        if (preserveWorkspaceConfig) cleanArgs.push('-e', '/.codews/');
        for (const child of childPaths) {
            // -e uses ignore patterns, so quote pattern metacharacters and
            // anchor to this root. Keep the single -f protection as well.
            cleanArgs.push('-e', `/${child.replace(/[\\*?\[\]]/g, '\\$&')}/`);
        }
        runGitCommand(cleanArgs, repoPath);
        operation = 'verify status after forced cleanup';
        const newStatus = getRealDirtyStatus(repoPath, childPaths, preserveWorkspaceConfig);
        if (newStatus) {
            console.error(`[ERROR] Failed to completely clean ${repoName}:\n${newStatus}`);
            return false;
        }
        return true;
    } catch (err) {
        console.error(`[ERROR] Failed to ${operation} for ${repoName}: ${err.message}`);
        if (operation === 'clean untracked and ignored files') {
            console.error('[HINT] Files may be in use or not removable. Close any IDE (e.g. DevEco Studio) and indexing processes using this repository, check file permissions, and retry.');
        }
        return false;
    }
}

async function checkDirty(workspace, options = {}) {
    let allClean = true;
    const repoEntries = resolveWorkspaceRepoEntries(workspace);
    validateWorkspaceRepositories(repoEntries);
    for (const entry of repoEntries) {
        const { repoName, repoPath, childPaths } = entry;
        if (!fs.existsSync(repoPath)) {
            continue; // Not cloned yet, so it can't be dirty
        }
        if (options.force) {
            if (!forceCleanRepository(entry)) allClean = false;
            continue;
        }
        let operation = 'check status';
        try {
            const status = getRealDirtyStatus(repoPath, childPaths);
            if (status.length > 0) {
                if (options.stash) {
                    console.log(`[STASH] Auto-stashing changes in ${repoName}...`);
                    operation = 'stash changes';
                    runGitCommand([
                        'stash', 'push', '-u', '-m', 'codews auto stash before switch'
                    ], repoPath);
                    operation = 'verify status after stashing';
                    const newStatus = getRealDirtyStatus(repoPath, childPaths);
                    if (newStatus.length > 0) {
                        console.error(`[ERROR] Failed to completely stash ${repoName}:\n${newStatus}`);
                        allClean = false;
                    }
                } else {
                    console.error(`[DIRTY] Repository ${repoName} at ${repoPath} has uncommitted changes:\n${status}`);
                    console.error('Please commit or stash your changes before switching.');
                    allClean = false;
                }
            }
        } catch (err) {
            console.error(`[ERROR] Failed to ${operation} for ${repoName}: ${err.message}`);
            allClean = false;
        }
    }
    return allClean;
}

async function checkoutWorkspace(workspace, options = {}) {
    const reposEntries = resolveWorkspaceRepoEntries(workspace);
    validateWorkspaceRepositories(reposEntries);
    const total = reposEntries.length;
    const mutationRecords = [];
    let currentRepository = null;
    let index = 0;

    try {
        for (const entry of reposEntries) {
            const { repoName, config, repoPath, childPaths } = entry;
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

            // A previous parent checkout/clone or hook may have created this path.
            if (fs.existsSync(repoPath)) validateRepositoryRoot(entry);

            const mutationRecord = {
                repoName,
                repoPath,
                childPaths,
                snapshot: captureRepositorySnapshot(repoPath),
                executedHooks: []
            };
            mutationRecords.push(mutationRecord);

            if (!mutationRecord.snapshot.existed) {
                console.log(`Cloning ${repoName}...`);
                // Ensure parent directory exists
                fs.mkdirSync(path.dirname(repoPath), { recursive: true });

                if (depth === 'targeted') {
                    runGitCommand(['init'], repoPath);
                    runGitCommand(['remote', 'add', 'origin', url], repoPath);
                    try {
                        console.log(`Attempting targeted shallow fetch for commit ${commit}...`);
                        runGitCommand(['fetch', '--depth', '1', 'origin', commit], repoPath, true);
                        runGitCommand(['checkout', commit], repoPath);
                        continue;
                    } catch (e) {
                        console.warn(`[WARN] 服务端拒绝了精确游离拉取，开始执行全量兜底...`);
                        fs.rmSync(repoPath, { recursive: true, force: true });
                        fs.mkdirSync(path.dirname(repoPath), { recursive: true });
                        depth = 0;
                    }
                }

                const cloneArgs = ['clone'];
                if (depth > 0) {
                    cloneArgs.push('--depth', String(depth), '--single-branch', '--no-tags');
                }
                if (branch) {
                    cloneArgs.push('-b', branch);
                }
                cloneArgs.push('--', url, path.basename(repoPath));
                runGitCommand(cloneArgs, path.dirname(repoPath), true);
                if (commit) {
                    console.log(`Checking out specific commit ${commit} in ${repoName}...`);
                    runGitCommand(['checkout', commit], repoPath);
                }
            } else {
                const target = commit ? commit : branch;
                console.log(`Fetching and checking out ${target} in ${repoName}...`);

                if (!commit) {
                    try {
                        // 为了防止该仓库是以 --single-branch 克隆的，在此显式将目标分支加入 fetch 列表
                        runGitCommand([
                            'remote', 'set-branches', '--add', 'origin', target
                        ], repoPath, true);
                    } catch(e) {}
                }

                runGitCommand(['fetch', 'origin'], repoPath, true);
                validateCheckoutChildPaths(entry, target, Boolean(commit));
                runGitCommand(['checkout', target], repoPath);

                if (!commit) {
                    try {
                        runGitCommand(['pull'], repoPath, true);
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
                    runHookCommand(hook, repoPath);
                    hookResult.status = 'completed';
                }
            }
        }
    } catch (err) {
        const rollbackResults = rollbackWorkspace(mutationRecords);
        throw new WorkspaceSwitchError(currentRepository, err, rollbackResults);
    }
}

function findGitRepositories(rootPath) {
    const repositories = [];

    const scanDirectory = (directoryPath) => {
        if (fs.existsSync(path.join(directoryPath, '.git'))) {
            repositories.push(directoryPath);
        }

        let entries;
        try {
            entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch (err) {
            console.warn(`[WARN] Unable to scan directory ${directoryPath}: ${err.message}`);
            return;
        }

        for (const entry of entries) {
            if (entry.isDirectory() && entry.name !== '.git') {
                scanDirectory(path.join(directoryPath, entry.name));
            }
        }
    };

    scanDirectory(rootPath);
    return repositories;
}

function verifyNoGitOperation(repoPath) {
    const gitDir = runGitCommand(['rev-parse', '--absolute-git-dir'], repoPath);
    const operationMarkers = [
        'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply',
        'rebase-merge', 'sequencer', 'BISECT_START'
    ];
    if (operationMarkers.some(marker => fs.existsSync(path.join(gitDir, marker)))) {
        throw new Error('A Git operation is in progress. Finish or abort it before pulling.');
    }
}

function pullRepository(entry, { force }) {
    const { repoName, repoPath, childPaths } = entry;
    verifyNoGitOperation(repoPath);
    const branch = runGitCommand(['branch', '--show-current'], repoPath);
    if (!branch) throw new Error('HEAD is detached. Check out a branch before pulling.');
    const head = runGitCommand(['rev-parse', '--verify', 'HEAD'], repoPath);
    const branchRef = `refs/heads/${branch}`;
    const [upstream, remote, remoteRef] = runGitCommand([
        'for-each-ref', '--format=%(upstream)%09%(upstream:remotename)%09%(upstream:remoteref)', '--', branchRef
    ], repoPath).split('\t');
    if (!upstream || !remote || !remoteRef) {
        throw new Error(`Branch ${JSON.stringify(branch)} has no upstream. Set a tracking branch before pulling.`);
    }
    validateChildPathOwnership(entry, head);
    if (!force) {
        const dirty = getRealDirtyStatus(repoPath, childPaths, true);
        if (dirty) throw new Error(`Uncommitted changes. Commit or stash them before pulling.\n${dirty}`);
    }

    console.log(`[PULL] ${repoName} (${branch}) <- ${upstream}`);
    if (remote !== '.') runGitCommand(['fetch', '--no-recurse-submodules', '--', remote, remoteRef], repoPath);
    const target = runGitCommand(['rev-parse', '--verify', '--end-of-options', `${upstream}^{commit}`], repoPath);
    const [ahead, behind] = runGitCommand([
        'rev-list', '--left-right', '--count', `${head}...${target}`
    ], repoPath).split(/\s+/).map(Number);
    if (ahead && behind) {
        throw new Error(`Branch ${JSON.stringify(branch)} and its upstream have diverged (${ahead} ahead, ${behind} behind).`);
    }
    if (behind) validateChildPathOwnership(entry, target);

    // Fetch can take time. Do not clean or merge a different branch or worktree.
    if (fs.realpathSync(repoPath) !== repoPath
        || runGitCommand(['branch', '--show-current'], repoPath) !== branch
        || runGitCommand(['rev-parse', '--verify', 'HEAD'], repoPath) !== head) {
        throw new Error('The worktree path or HEAD changed during fetch. Retry the pull.');
    }
    verifyNoGitOperation(repoPath);
    if (force && !forceCleanRepository(entry, true)) return false;

    if (behind) {
        runGitCommand([
            '-c', 'submodule.recurse=false', 'merge', '--ff-only', '--no-squash',
            '--no-autostash', '--no-overwrite-ignore', '--', target
        ], repoPath);
        console.log(`[UPDATED] ${repoName} (${branch}) ${head.slice(0, 7)} -> ${target.slice(0, 7)}`);
    } else {
        const detail = ahead ? `ahead by ${ahead} commit(s)` : 'up to date';
        console.log(`[OK] ${repoName} (${branch}) ${detail}`);
    }
    return true;
}

function runWorkspaceOperation(workspace, env, operation, runRepository) {
    const root = fs.realpathSync(workspace ? workspace.workspaceRoot : process.cwd());
    const discoveredPaths = findGitRepositories(root);
    const entries = workspace ? resolveWorkspaceRepoEntries(workspace) : discoveredPaths.map(repoPath => ({
        repoPath,
        repoName: path.relative(root, repoPath) || path.basename(root)
    }));
    const selected = [...new Map(entries.map(entry => [entry.repoPath, entry])).values()];
    if (selected.length === 0) throw new Error(`No repositories selected in ${root}.`);
    const repositoryPaths = [...new Set([...discoveredPaths, ...selected.map(entry => entry.repoPath)])];

    const scope = env ? `${root} (environment: ${env})` : root;
    console.log(`${operation} for ${selected.length} repositories in ${scope}`);
    let succeeded = 0;
    for (const entry of selected) {
        entry.childPaths = getNestedRepositoryPaths(entry.repoPath, repositoryPaths);
        try {
            if (!fs.existsSync(entry.repoPath)) throw new Error('Repository is missing.');
            if (fs.realpathSync(entry.repoPath) !== entry.repoPath) {
                throw new Error('The worktree path changed after repository discovery.');
            }
            validateRepositoryRoot(entry);
            if (runRepository(entry)) succeeded++;
        } catch (err) {
            console.error(`[ERROR] ${entry.repoName} (${entry.repoPath}): ${err.message}`);
        }
    }
    const failed = selected.length - succeeded;
    console.log(`${operation} completed: ${succeeded} succeeded, ${failed} failed.`);
    return failed === 0;
}

function pullWorkspace(workspace = null, options = {}) {
    return runWorkspaceOperation(workspace, options.env, 'Pull', entry => pullRepository(entry, options));
}

function resetWorkspace(workspace = null, options = {}) {
    return runWorkspaceOperation(workspace, options.env, 'Reset', entry => {
        const { repoName, repoPath } = entry;
        const head = runGitCommand(['rev-parse', '--verify', 'HEAD'], repoPath);
        validateChildPathOwnership(entry, head);
        hardResetRepository(repoPath);
        console.log(`[RESET] ${repoName} to ${head.slice(0, 7)}`);
        return true;
    });
}

function statusWorkspace(workspace = null, currentDir = process.cwd()) {
    if (workspace) {
        console.log(`Checking status against environment: ${workspace.name}\n`);
        const repoEntries = resolveWorkspaceRepoEntries(workspace);
        let allMatching = true;
        for (const { repoName, config, repoPath } of repoEntries) {
            if (!fs.existsSync(repoPath)) {
                console.log(`${repoName.padEnd(20)} [MISSING]  Not cloned yet`);
                allMatching = false;
                continue;
            }
            try {
                const headCommit = runGitCommand(['rev-parse', 'HEAD'], repoPath);
                let branch = '';
                try {
                    branch = runGitCommand(['branch', '--show-current'], repoPath);
                } catch(e) {}
                
                const dirty = getRealDirtyStatus(repoPath);
                const statusStr = dirty.length > 0 ? '[DIRTY]' : '[CLEAN]';
                if (dirty.length > 0) {
                    allMatching = false;
                }
                
                let branchStr = "";
                if (config.commit) {
                    const shortHead = headCommit.substring(0, 7);
                    const shortExpected = config.commit.substring(0, 7);
                    const commitMatches = headCommit.startsWith(config.commit);
                    branchStr = commitMatches ? `Commit: ${shortHead}` : `Commit: ${shortHead} (Expected: ${shortExpected})`;
                    if (!commitMatches) {
                        allMatching = false;
                    }
                } else {
                    const expected = config.branch;
                    const branchMatches = branch === expected;
                    branchStr = branchMatches ? `Branch: ${branch}` : `Branch: ${branch || 'Detached'} (Expected: ${expected})`;
                    if (!branchMatches) {
                        allMatching = false;
                    }
                }
                
                console.log(`${repoName.padEnd(20)} ${statusStr.padEnd(9)} ${branchStr}`);
            } catch (err) {
                console.log(`${repoName.padEnd(20)} [ERROR]    Failed to check git status`);
                allMatching = false;
            }
        }
        return allMatching;
    } else {
        console.log(`Scanning current directory for Git repositories...\n`);

        const checkAndPrint = (repoPath, displayName) => {
            if (fs.existsSync(path.join(repoPath, '.git'))) {
                try {
                    const branch = runGitCommand(['branch', '--show-current'], repoPath);
                    const dirty = getRealDirtyStatus(repoPath);
                    const statusStr = dirty.length > 0 ? '[DIRTY]' : '[CLEAN]';
                    console.log(`${displayName.padEnd(20)} ${statusStr.padEnd(9)} Branch: ${branch}`);
                } catch (err) {
                    console.log(`${displayName.padEnd(20)} [ERROR]    Failed to check git status`);
                }
            }
        };

        for (const repoPath of findGitRepositories(currentDir)) {
            const relativePath = path.relative(currentDir, repoPath);
            const displayName = relativePath || path.basename(currentDir);
            checkAndPrint(repoPath, displayName);
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
                const current = runGitCommand(['branch', '--show-current'], repoPath);
                if (current) branch = current;
            } catch (e) {}

            let logMsg = 'No commits yet';
            try {
                logMsg = runGitCommand(['log', '-1', '--format=%h %s'], repoPath);
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
    pullWorkspace,
    resetWorkspace,
    statusWorkspace,
    printSwitchSummary
};
