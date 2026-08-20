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
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-status-exit-'));
    t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
    return workspaceRoot;
}

function createRepository(workspaceRoot, repoName = 'Repo') {
    const repoPath = path.join(workspaceRoot, repoName);
    fs.mkdirSync(repoPath);
    runGit(repoPath, ['init']);
    runGit(repoPath, ['branch', '-M', 'main']);
    fs.writeFileSync(path.join(repoPath, 'tracked.txt'), 'fixture\n', 'utf8');
    runGit(repoPath, ['add', 'tracked.txt']);
    runGit(repoPath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'initial'
    ]);
    return repoPath;
}

function runStatus(workspaceRoot, repos) {
    const output = [];
    const originalLog = console.log;
    console.log = (...values) => output.push(values.join(' '));
    try {
        const matches = statusWorkspace({ name: 'status', workspaceRoot, repos });
        return { matches, output: output.join('\n') };
    } finally {
        console.log = originalLog;
    }
}

test('environment status succeeds when every configured repository matches', (t) => {
    const workspaceRoot = createFixture(t);
    createRepository(workspaceRoot);

    const result = runStatus(workspaceRoot, { Repo: { path: 'Repo', branch: 'main' } });
    assert.equal(result.matches, true);
    assert.match(result.output, /\[CLEAN\].*Branch: main/);
});

test('environment status fails for a missing repository', (t) => {
    const workspaceRoot = createFixture(t);

    const result = runStatus(workspaceRoot, {
        Missing: { path: 'Missing', branch: 'main' }
    });
    assert.equal(result.matches, false);
    assert.match(result.output, /\[MISSING\]/);
});

test('environment status fails for a dirty repository', (t) => {
    const workspaceRoot = createFixture(t);
    const repoPath = createRepository(workspaceRoot);
    fs.writeFileSync(path.join(repoPath, 'untracked.txt'), 'dirty\n', 'utf8');

    const result = runStatus(workspaceRoot, { Repo: { path: 'Repo', branch: 'main' } });
    assert.equal(result.matches, false);
    assert.match(result.output, /\[DIRTY\]/);
});

test('environment status fails for a branch mismatch', (t) => {
    const workspaceRoot = createFixture(t);
    createRepository(workspaceRoot);

    const result = runStatus(workspaceRoot, {
        Repo: { path: 'Repo', branch: 'expected' }
    });
    assert.equal(result.matches, false);
    assert.match(result.output, /Expected: expected/);
});

test('environment status fails for a commit mismatch', (t) => {
    const workspaceRoot = createFixture(t);
    createRepository(workspaceRoot);

    const result = runStatus(workspaceRoot, {
        Repo: { path: 'Repo', commit: '0000000000000000000000000000000000000000' }
    });
    assert.equal(result.matches, false);
    assert.match(result.output, /Expected: 0000000/);
});

test('environment status fails when a configured path is not a Git repository', (t) => {
    const workspaceRoot = createFixture(t);
    fs.mkdirSync(path.join(workspaceRoot, 'NotGit'));

    const result = runStatus(workspaceRoot, {
        NotGit: { path: 'NotGit', branch: 'main' }
    });
    assert.equal(result.matches, false);
    assert.match(result.output, /\[ERROR\]/);
});
