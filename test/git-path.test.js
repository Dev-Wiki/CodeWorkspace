const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkoutWorkspace } = require('../src/git');

function createWorkspaceFixture(t) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-path-'));
    const workspaceRoot = path.join(fixtureRoot, 'workspace');
    fs.mkdirSync(workspaceRoot);
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
    return { fixtureRoot, workspaceRoot };
}

function runGit(repoPath, args) {
    return execFileSync('git', args, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function createGitRepository(repoPath) {
    fs.mkdirSync(repoPath, { recursive: true });
    runGit(repoPath, ['init']);
    fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'fixture\n', 'utf8');
    runGit(repoPath, ['add', 'tracked.txt']);
    runGit(repoPath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'initial'
    ]);
    return runGit(repoPath, ['branch', '--show-current']);
}

function workspaceWithPath(workspaceRoot, repoPath, extraConfig = {}) {
    return {
        workspaceRoot,
        repos: {
            Escaped: {
                path: repoPath,
                ...extraConfig
            }
        }
    };
}

test('relative repository paths cannot escape the workspace before clone', async (t) => {
    const { fixtureRoot, workspaceRoot } = createWorkspaceFixture(t);
    const sourcePath = path.join(fixtureRoot, 'source');
    const branch = createGitRepository(sourcePath);
    const workspace = workspaceWithPath(workspaceRoot, '../escaped-target', {
        branch,
        url: sourcePath
    });

    await assert.rejects(
        () => checkoutWorkspace(workspace),
        /Repository path for "Escaped" escapes workspace root/
    );
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'escaped-target')), false);
});

test('absolute repository paths outside the workspace are rejected', async (t) => {
    const { fixtureRoot, workspaceRoot } = createWorkspaceFixture(t);
    const outsidePath = path.join(fixtureRoot, 'outside');
    const workspace = workspaceWithPath(workspaceRoot, outsidePath);

    await assert.rejects(
        () => checkoutWorkspace(workspace),
        /Repository path for "Escaped" escapes workspace root/
    );
});

test('symlinked repository paths cannot escape the canonical workspace root', async (t) => {
    const { fixtureRoot, workspaceRoot } = createWorkspaceFixture(t);
    const outsidePath = path.join(fixtureRoot, 'outside');
    fs.mkdirSync(outsidePath);
    const linkedPath = path.join(workspaceRoot, 'linked-outside');

    try {
        fs.symlinkSync(outsidePath, linkedPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
        if (err.code === 'EPERM') {
            t.skip('Creating directory symlinks is not permitted in this environment.');
            return;
        }
        throw err;
    }

    const workspace = workspaceWithPath(workspaceRoot, 'linked-outside');
    await assert.rejects(
        () => checkoutWorkspace(workspace),
        /Repository path for "Escaped" escapes workspace root/
    );
});

test('repository paths inside the canonical workspace remain valid', async (t) => {
    const { workspaceRoot } = createWorkspaceFixture(t);
    const workspace = workspaceWithPath(workspaceRoot, 'inside');

    await checkoutWorkspace(workspace);
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'inside')), false);
});

test('all repository paths are validated before the first clone starts', async (t) => {
    const { fixtureRoot, workspaceRoot } = createWorkspaceFixture(t);
    const sourcePath = path.join(fixtureRoot, 'source');
    const branch = createGitRepository(sourcePath);
    const workspace = {
        workspaceRoot,
        repos: {
            Inside: {
                path: 'inside-target',
                branch,
                url: sourcePath
            },
            Escaped: {
                path: '../escaped-target',
                branch,
                url: sourcePath
            }
        }
    };

    await assert.rejects(
        () => checkoutWorkspace(workspace),
        /Repository path for "Escaped" escapes workspace root/
    );
    assert.equal(fs.existsSync(path.join(workspaceRoot, 'inside-target')), false);
    assert.equal(fs.existsSync(path.join(fixtureRoot, 'escaped-target')), false);
});
