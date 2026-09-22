const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function runSwitch(t, options, failure, status = '') {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-diagnostics-'));
    fs.mkdirSync(path.join(workspaceRoot, 'Repo'));
    t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

    // Run the real CLI and preflight in isolation, injecting Git failures so the
    // regression is portable and does not depend on Windows file locking.
    return spawnSync(process.execPath, ['-e', `
        const childProcess = require('child_process');
        childProcess.execSync = () => { throw new Error('outside repository'); };
        childProcess.execFileSync = (file, args) => {
            console.log('GIT ' + args.join(' '));
            if (args[0] === ${JSON.stringify(failure)}) {
                const error = new Error('Git failed');
                error.stderr = args[0] === 'clean'
                    ? 'warning: failed to remove .idea/.deveco/cxx/.cache/clangd/wecode-cpp.db: Invalid argument'
                    : 'fatal: simulated Git failure';
                throw error;
            }
            if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
                return ${JSON.stringify(path.join(workspaceRoot, 'Repo'))};
            }
            return args[0] === 'status' ? ${JSON.stringify(status)} : '';
        };
        const config = require('./src/config');
        config.loadConfig = () => ({});
        config.getResolvedWorkspace = () => ({
            workspaceRoot: ${JSON.stringify(workspaceRoot)},
            repos: { Repo: { path: 'Repo', branch: 'main' } }
        });
        require('./src/cli').run(['node', 'codews', 'switch', 'fixture', ...${JSON.stringify(options)}]);
    `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
}

function assertSwitchAborted(result) {
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Switching to environment|GIT (checkout|fetch|clone)/);
}

test('force clean failure reports the operation, original error and file-use advice', (t) => {
    const result = runSwitch(t, ['--force'], 'clean');
    assertSwitchAborted(result);
    assert.match(result.stderr, /Failed to clean untracked and ignored files for Repo/);
    assert.match(result.stderr, /wecode-cpp\.db: Invalid argument/);
    assert.match(result.stderr, /Close.*IDE.*indexing/);
    assert.match(result.stderr, /Forced workspace cleanup failed/);
    assert.doesNotMatch(result.stderr, /Working tree is dirty|commit or stash/);
});

test('force reset failure identifies reset without suggesting a file lock', (t) => {
    const result = runSwitch(t, ['--force'], 'reset');
    assertSwitchAborted(result);
    assert.match(result.stderr, /Failed to reset tracked files for Repo/);
    assert.match(result.stderr, /Forced workspace cleanup failed/);
    assert.doesNotMatch(result.stderr, /Close.*IDE|commit or stash/);
    assert.doesNotMatch(result.stdout, /GIT clean/);
});

test('force status verification failure identifies status after cleanup', (t) => {
    const result = runSwitch(t, ['--force'], 'status');
    assertSwitchAborted(result);
    assert.match(result.stderr, /Failed to verify status after forced cleanup for Repo/);
    assert.doesNotMatch(result.stderr, /Close.*IDE|commit or stash/);
});

test('force with remaining changes reports incomplete cleanup', (t) => {
    const result = runSwitch(t, ['--force'], null, ' M tracked.txt');
    assertSwitchAborted(result);
    assert.match(result.stderr, /Failed to completely clean Repo/);
    assert.match(result.stderr, /Forced workspace cleanup failed/);
    assert.doesNotMatch(result.stderr, /commit or stash/);
});

test('stash command failure reports automatic stashing failure', (t) => {
    const result = runSwitch(t, ['--stash'], 'stash', ' M tracked.txt');
    assertSwitchAborted(result);
    assert.match(result.stderr, /Failed to stash changes for Repo/);
    assert.match(result.stderr, /Automatic stashing failed/);
    assert.doesNotMatch(result.stderr, /Working tree is dirty|commit or stash/);
});

test('ordinary status command failure does not masquerade as uncommitted changes', (t) => {
    const result = runSwitch(t, [], 'status');
    assertSwitchAborted(result);
    assert.match(result.stderr, /Failed to check status for Repo/);
    assert.match(result.stderr, /Workspace validation failed/);
    assert.doesNotMatch(result.stderr, /Working tree is dirty|commit or stash/);
});

test('ordinary dirty repository still gets commit or stash advice', (t) => {
    const result = runSwitch(t, [], null, ' M tracked.txt');
    assertSwitchAborted(result);
    assert.match(result.stderr, /\[DIRTY\].*Repo/);
    assert.match(result.stderr, /commit or stash/);
});
