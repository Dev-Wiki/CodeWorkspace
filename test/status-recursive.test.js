const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { statusWorkspace } = require('../src/git');

function runGit(repoPath, args) {
    return execFileSync('git', args, {
        cwd: repoPath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function createFixture(t) {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-status-recursive-'));
    t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
    return workspaceRoot;
}

function createRepository(repoPath) {
    fs.mkdirSync(repoPath, { recursive: true });
    runGit(repoPath, ['init']);
    runGit(repoPath, ['branch', '-M', 'main']);
    fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'fixture\n', 'utf8');
    runGit(repoPath, ['add', 'tracked.txt']);
    runGit(repoPath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'initial'
    ]);
}

function captureDefaultStatus(workspaceRoot) {
    const output = [];
    const originalLog = console.log;
    console.log = (...values) => output.push(values.join(' '));
    try {
        statusWorkspace(null, workspaceRoot);
        return output.join('\n');
    } finally {
        console.log = originalLog;
    }
}

test('default status discovers a clean repository below the first directory level', (t) => {
    const workspaceRoot = createFixture(t);
    const relativePath = path.join('Level1', 'Level2', 'DeepRepo');
    createRepository(path.join(workspaceRoot, relativePath));

    const output = captureDefaultStatus(workspaceRoot);
    assert.match(output, new RegExp(`${relativePath.replace(/\\/g, '\\\\')}.*\\[CLEAN\\]`));
});

test('default status continues scanning for repositories nested inside a repository', (t) => {
    const workspaceRoot = createFixture(t);
    const outerPath = path.join(workspaceRoot, 'Outer');
    const innerRelativePath = path.join('Outer', 'vendor', 'Inner');
    createRepository(outerPath);
    createRepository(path.join(workspaceRoot, innerRelativePath));

    const output = captureDefaultStatus(workspaceRoot);
    assert.match(output, /Outer.*Branch: main/);
    assert.match(output, new RegExp(`${innerRelativePath.replace(/\\/g, '\\\\')}.*Branch: main`));
});

test('default status does not follow directory symlinks while scanning', (t) => {
    const workspaceRoot = createFixture(t);
    const realPath = path.join(workspaceRoot, 'Real');
    const linkedPath = path.join(workspaceRoot, 'Linked');
    createRepository(realPath);

    try {
        fs.symlinkSync(realPath, linkedPath, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
        if (err.code === 'EPERM') {
            t.skip('Creating directory symlinks is not permitted in this environment.');
            return;
        }
        throw err;
    }

    const output = captureDefaultStatus(workspaceRoot);
    assert.match(output, /Real.*Branch: main/);
    assert.doesNotMatch(output, /Linked/);
});
