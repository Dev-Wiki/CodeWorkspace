const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkDirty } = require('../src/git');

function runGit(repoPath, args) {
    return execFileSync('git', args, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function createDirtyRepository(t) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-force-'));
    const repoPath = path.join(workspaceRoot, 'repo');
    fs.mkdirSync(repoPath);
    t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));

    runGit(repoPath, ['init']);
    fs.writeFileSync(path.join(repoPath, '.gitignore'), 'ignored.txt\n', 'utf8');
    fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'original\n', 'utf8');
    runGit(repoPath, ['add', '.gitignore', 'tracked.txt']);
    runGit(repoPath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'initial'
    ]);

    fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'modified\n', 'utf8');
    fs.writeFileSync(path.join(repoPath, 'untracked.txt'), 'untracked\n', 'utf8');
    fs.writeFileSync(path.join(repoPath, 'ignored.txt'), 'ignored\n', 'utf8');
    return { workspaceRoot, repoPath };
}

test('force restores tracked files and removes untracked and ignored files', async (t) => {
    const { workspaceRoot, repoPath } = createDirtyRepository(t);
    const workspace = {
        workspaceRoot,
        repos: {
            Repo: { path: 'repo' }
        }
    };

    assert.equal(await checkDirty(workspace, { force: true }), true);
    assert.equal(fs.readFileSync(path.join(repoPath, 'tracked.txt'), 'utf8'), 'original\n');
    assert.equal(fs.existsSync(path.join(repoPath, 'untracked.txt')), false);
    assert.equal(fs.existsSync(path.join(repoPath, 'ignored.txt')), false);
    assert.equal(runGit(repoPath, ['status', '--porcelain']), '');
});

test('force removes ignored files even when porcelain status is clean', async (t) => {
    const { workspaceRoot, repoPath } = createDirtyRepository(t);
    runGit(repoPath, ['restore', 'tracked.txt']);
    fs.unlinkSync(path.join(repoPath, 'untracked.txt'));
    assert.equal(runGit(repoPath, ['status', '--porcelain']), '');

    const workspace = {
        workspaceRoot,
        repos: {
            Repo: { path: 'repo' }
        }
    };

    assert.equal(await checkDirty(workspace, { force: true }), true);
    assert.equal(fs.existsSync(path.join(repoPath, 'ignored.txt')), false);
    assert.equal(runGit(repoPath, ['status', '--porcelain']), '');
});
