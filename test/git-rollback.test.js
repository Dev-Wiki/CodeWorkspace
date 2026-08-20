const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkoutWorkspace } = require('../src/git');

function runGit(repoPath, args) {
    return execFileSync('git', args, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function commitFile(repoPath, contents, message) {
    fs.writeFileSync(path.join(repoPath, 'tracked.txt'), contents, 'utf8');
    runGit(repoPath, ['add', 'tracked.txt']);
    runGit(repoPath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', message
    ]);
    return runGit(repoPath, ['rev-parse', 'HEAD']);
}

function createSwitchFixture(t, cloneFirstRepository) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-rollback-'));
    const workspaceRoot = path.join(fixtureRoot, 'workspace');
    const sourcePath = path.join(fixtureRoot, 'source');
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(sourcePath);
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

    runGit(sourcePath, ['init']);
    runGit(sourcePath, ['branch', '-M', 'original']);
    const originalHead = commitFile(sourcePath, 'original\n', 'original');
    runGit(sourcePath, ['checkout', '-b', 'target']);
    commitFile(sourcePath, 'target\n', 'target');

    const firstPath = path.join(workspaceRoot, 'First');
    if (cloneFirstRepository) {
        execFileSync('git', ['clone', '-b', 'original', sourcePath, firstPath], {
            cwd: workspaceRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
    }

    return { workspaceRoot, sourcePath, firstPath, originalHead };
}

async function captureSwitchFailure(workspaceRoot, sourcePath, firstConfig = {}) {
    let failure;
    try {
        await checkoutWorkspace({
            workspaceRoot,
            repos: {
                First: {
                    url: sourcePath,
                    branch: 'target',
                    ...firstConfig
                },
                Second: {
                    url: sourcePath,
                    branch: 'branch-that-does-not-exist'
                }
            }
        });
    } catch (err) {
        failure = err;
    }

    assert.ok(failure, 'the injected second-repository failure must propagate');
    return failure;
}

function assertRecoveryReport(failure, firstAction) {
    assert.equal(failure.code, 'WORKSPACE_SWITCH_FAILED');
    assert.equal(failure.recoveryReport.failedRepository, 'Second');
    assert.deepEqual(
        failure.recoveryReport.rollbackResults.map(result => result.repoName),
        ['Second', 'First']
    );
    assert.equal(failure.recoveryReport.rollbackResults[1].action, firstAction);
    assert.equal(failure.recoveryReport.rollbackResults[1].status, 'restored');
    assert.ok(Array.isArray(failure.recoveryReport.rollbackResults[1].recoveryActions));
}

test('later clone failure removes repositories cloned earlier in the switch', async (t) => {
    const { workspaceRoot, sourcePath, firstPath } = createSwitchFixture(t, false);
    const failure = await captureSwitchFailure(workspaceRoot, sourcePath);

    assert.equal(fs.existsSync(firstPath), false);
    assertRecoveryReport(failure, 'remove-new-repository');
});

test('later clone failure restores an existing repository branch and HEAD', async (t) => {
    const { workspaceRoot, sourcePath, firstPath, originalHead } = createSwitchFixture(t, true);
    const failure = await captureSwitchFailure(workspaceRoot, sourcePath);

    assert.equal(runGit(firstPath, ['branch', '--show-current']), 'original');
    assert.equal(runGit(firstPath, ['rev-parse', 'HEAD']), originalHead);
    assert.equal(runGit(firstPath, ['status', '--porcelain']), '');
    assertRecoveryReport(failure, 'restore-existing-repository');
});

test('later clone failure restores an existing detached HEAD', async (t) => {
    const { workspaceRoot, sourcePath, firstPath, originalHead } = createSwitchFixture(t, true);
    runGit(firstPath, ['checkout', '--detach', originalHead]);
    const failure = await captureSwitchFailure(workspaceRoot, sourcePath);

    assert.equal(runGit(firstPath, ['branch', '--show-current']), '');
    assert.equal(runGit(firstPath, ['rev-parse', 'HEAD']), originalHead);
    assertRecoveryReport(failure, 'restore-existing-repository');
});

test('recovery report lists completed hooks whose side effects may remain', async (t) => {
    const { workspaceRoot, sourcePath, firstPath } = createSwitchFixture(t, true);
    const failure = await captureSwitchFailure(workspaceRoot, sourcePath, {
        post_hooks: ['git tag hook-ran']
    });

    assert.equal(runGit(firstPath, ['tag', '--list', 'hook-ran']), 'hook-ran');
    assert.deepEqual(failure.recoveryReport.rollbackResults[1].executedHooks, [
        { command: 'git tag hook-ran', status: 'completed' }
    ]);
});

test('rollback never hard-resets changes that existed before direct API use', async (t) => {
    const { workspaceRoot, sourcePath, firstPath } = createSwitchFixture(t, true);
    fs.writeFileSync(path.join(firstPath, 'tracked.txt'), 'local work\n', 'utf8');
    const failure = await captureSwitchFailure(workspaceRoot, sourcePath);

    assert.equal(failure.recoveryReport.failedRepository, 'First');
    assert.equal(failure.recoveryReport.rollbackResults[0].status, 'manual-recovery-required');
    assert.deepEqual(failure.recoveryReport.rollbackResults[0].recoveryActions, []);
    assert.match(failure.recoveryReport.rollbackResults[0].originalStatus, /tracked\.txt/);
    assert.equal(fs.readFileSync(path.join(firstPath, 'tracked.txt'), 'utf8'), 'local work\n');
});
