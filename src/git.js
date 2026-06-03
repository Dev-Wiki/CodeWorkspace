const { execSync } = require('child_process');
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

async function checkDirty(workspace, options = {}) {
    let allClean = true;
    for (const [repoName, config] of Object.entries(workspace.repos)) {
        const repoPath = path.resolve(workspace.workspaceRoot, config.path || repoName);
        if (!fs.existsSync(repoPath)) {
            continue; // Not cloned yet, so it can't be dirty
        }
        try {
            const status = runCommand('git status --porcelain', repoPath);
            if (status.length > 0) {
                if (options.force) {
                    console.log(`[FORCE] Hard resetting ${repoName}...`);
                    runCommand('git reset --hard', repoPath);
                } else if (options.stash) {
                    console.log(`[STASH] Auto-stashing changes in ${repoName}...`);
                    runCommand('git stash push -u -m "codews auto stash before switch"', repoPath);
                    const newStatus = runCommand('git status --porcelain', repoPath);
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

async function checkoutWorkspace(workspace) {
    const reposEntries = Object.entries(workspace.repos);
    const total = reposEntries.length;
    let index = 0;

    for (const [repoName, config] of reposEntries) {
        index++;
        const repoPath = path.resolve(workspace.workspaceRoot, config.path || repoName);
        const branch = config.branch;
        const commit = config.commit;
        const url = config.url;
        let depth = config.depth !== undefined ? config.depth : (commit ? 0 : 1);

        if (commit && config.depth !== undefined && config.depth > 0) {
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

        if (!fs.existsSync(repoPath)) {
            if (!url) {
                console.warn(`[WARN] Skipping ${repoName} - directory does not exist and no URL provided.`);
                continue;
            }
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

            const cloneCmd = depth > 0 
                ? `git clone --depth ${depth} --single-branch --no-tags ${url} -b ${branch} ${path.basename(repoPath)}`
                : `git clone ${url} -b ${branch} ${path.basename(repoPath)}`;
            runCommand(cloneCmd, path.dirname(repoPath), true);
            if (commit) {
                console.log(`Checking out specific commit ${commit} in ${repoName}...`);
                runCommand(`git checkout ${commit}`, repoPath);
            }
        } else {
            const target = commit ? commit : branch;
            console.log(`Fetching and checking out ${target} in ${repoName}...`);
            runCommand('git fetch', repoPath, true);
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
                runCommand(hook, repoPath);
            }
        }
    }
}

function statusWorkspace(workspace = null) {
    if (workspace) {
        console.log(`Checking status against environment: ${workspace.name}\n`);
        for (const [repoName, config] of Object.entries(workspace.repos)) {
            const repoPath = path.resolve(workspace.workspaceRoot, config.path || repoName);
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
                
                const dirty = runCommand('git status --porcelain', repoPath);
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
                    const dirty = runCommand('git status --porcelain', repoPath);
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

module.exports = { checkDirty, checkoutWorkspace, statusWorkspace };
