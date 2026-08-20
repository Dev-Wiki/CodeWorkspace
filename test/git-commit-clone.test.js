const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { checkoutWorkspace } = require('../src/git');

function runGit(repoPath, args) {
    return execFileSync('git', args, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function createSourceFixture(t) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-commit-clone-'));
    const workspaceRoot = path.join(fixtureRoot, 'workspace');
    const sourcePath = path.join(fixtureRoot, 'source');
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(sourcePath);
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

    runGit(sourcePath, ['init']);
    fs.writeFileSync(path.join(sourcePath, 'tracked.txt'), 'first\n', 'utf8');
    runGit(sourcePath, ['add', 'tracked.txt']);
    runGit(sourcePath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'first'
    ]);
    const targetCommit = runGit(sourcePath, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(sourcePath, 'tracked.txt'), 'second\n', 'utf8');
    runGit(sourcePath, ['add', 'tracked.txt']);
    runGit(sourcePath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'second'
    ]);

    return { fixtureRoot, workspaceRoot, sourcePath, targetCommit };
}

async function assertCommitOnlyClone(workspaceRoot, url, targetCommit, targetName) {
    await checkoutWorkspace({
        workspaceRoot,
        repos: {
            CommitOnly: {
                path: targetName,
                url,
                commit: targetCommit
            }
        }
    });

    const repoPath = path.join(workspaceRoot, targetName);
    assert.equal(runGit(repoPath, ['rev-parse', 'HEAD']), targetCommit);
    assert.equal(runGit(repoPath, ['branch', '--show-current']), '');
    assert.equal(fs.readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8'), 'first\n');
    assert.equal(runGit(repoPath, ['status', '--porcelain']), '');
}

test('commit-only first clone works from a local repository path', async (t) => {
    const { workspaceRoot, sourcePath, targetCommit } = createSourceFixture(t);
    await assertCommitOnlyClone(workspaceRoot, sourcePath, targetCommit, 'local-target');
});

test('commit-only first clone works from a file URL bare remote', async (t) => {
    const { fixtureRoot, workspaceRoot, sourcePath, targetCommit } = createSourceFixture(t);
    const remotePath = path.join(fixtureRoot, 'remote.git');
    execFileSync('git', ['clone', '--bare', sourcePath, remotePath], {
        cwd: fixtureRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    await assertCommitOnlyClone(
        workspaceRoot,
        pathToFileURL(remotePath).href,
        targetCommit,
        'remote-target'
    );
});
