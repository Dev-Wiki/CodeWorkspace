const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = path.join(__dirname, '..', 'bin', 'codews.js');

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(cwd, contents) {
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), contents);
    git(cwd, 'add', 'tracked.txt');
    git(cwd, '-c', 'user.name=CodeWS Tests', '-c', 'user.email=codews@example.invalid',
        'commit', '-m', contents);
    return git(cwd, 'rev-parse', 'HEAD');
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-pull-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace);
    return { root, workspace };
}

function cloneRepository({ root, workspace }, name, remoteBranch, localBranch = remoteBranch) {
    const source = path.join(root, `source-${path.basename(name)}`);
    const repo = path.join(workspace, name);
    fs.mkdirSync(source);
    git(source, 'init', '-b', remoteBranch);
    const initial = commit(source, 'initial');
    fs.mkdirSync(path.dirname(repo), { recursive: true });
    git(root, 'clone', '--origin', 'team', source, repo);
    if (localBranch !== remoteBranch) git(repo, 'branch', '-m', localBranch);
    const latest = commit(source, 'remote update');
    return { source, repo, initial, latest };
}

function pull(cwd, ...args) {
    const result = spawnSync(process.execPath, [cli, 'pull', ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    assert.equal(result.error, undefined);
    return result;
}

test('pull discovers multiple repositories and fast-forwards their current upstreams', (t) => {
    const scope = fixture(t);
    const main = cloneRepository(scope, 'main-repo', 'main');
    const bugfix = cloneRepository(scope, 'group/bugfix-repo', 'team-fix', 'local-fix');
    git(bugfix.repo, 'config', 'pull.rebase', 'true');

    const result = pull(scope.workspace);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 succeeded, 0 failed/);
    assert.equal(git(main.repo, 'branch', '--show-current'), 'main');
    assert.equal(git(bugfix.repo, 'branch', '--show-current'), 'local-fix');
    assert.equal(git(main.repo, 'rev-parse', 'HEAD'), main.latest);
    assert.equal(git(bugfix.repo, 'rev-parse', 'HEAD'), bugfix.latest);
    assert.equal(fs.existsSync(path.join(scope.workspace, '.codews')), false);
});

test('pull updates clean siblings when another repo is dirty or invalid', (t) => {
    const scope = fixture(t);
    const clean = cloneRepository(scope, 'clean', 'main');
    const dirty = cloneRepository(scope, 'dirty', 'main');
    fs.mkdirSync(path.join(scope.workspace, '.git'));
    fs.writeFileSync(path.join(dirty.repo, 'tracked.txt'), 'local edits');

    const result = pull(scope.workspace);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /1 succeeded, 2 failed/);
    assert.match(result.stderr, /valid Git worktree root/);
    assert.match(result.stderr, /dirty.*Uncommitted changes/);
    assert.equal(git(clean.repo, 'rev-parse', 'HEAD'), clean.latest);
    assert.equal(git(dirty.repo, 'rev-parse', 'HEAD'), dirty.initial);
    assert.equal(fs.readFileSync(path.join(dirty.repo, 'tracked.txt'), 'utf8'), 'local edits');
});

test('pull --force cleans only selected worktrees and preserves nested repos and local config', (t) => {
    const scope = fixture(t);
    const parent = cloneRepository(scope, '', 'main');
    const child = cloneRepository(scope, 'nested/child', 'main');
    fs.mkdirSync(path.join(parent.repo, '.codews'));
    const config = path.join(parent.repo, '.codews', 'fixture.json');
    fs.writeFileSync(config, JSON.stringify({ repos: { Parent: { path: '.', branch: 'other' } } }));
    fs.writeFileSync(path.join(parent.repo, '.git', 'info', 'exclude'), 'ignored.txt\n');
    fs.writeFileSync(path.join(parent.repo, 'tracked.txt'), 'local edits');
    fs.writeFileSync(path.join(parent.repo, 'untracked.txt'), 'remove');
    fs.writeFileSync(path.join(parent.repo, 'ignored.txt'), 'remove');
    fs.writeFileSync(path.join(child.repo, 'tracked.txt'), 'keep child edits');

    const result = pull(scope.workspace, '-e', 'fixture', '--force');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(parent.repo, 'branch', '--show-current'), 'main');
    assert.equal(git(parent.repo, 'rev-parse', 'HEAD'), parent.latest);
    assert.equal(fs.existsSync(path.join(parent.repo, 'untracked.txt')), false);
    assert.equal(fs.existsSync(path.join(parent.repo, 'ignored.txt')), false);
    assert.equal(fs.existsSync(config), true);
    assert.equal(git(child.repo, 'rev-parse', 'HEAD'), child.initial);
    assert.equal(fs.readFileSync(path.join(child.repo, 'tracked.txt'), 'utf8'), 'keep child edits');
});

test('pull --force preserves commits and worktree changes when fast-forward is impossible', (t) => {
    const scope = fixture(t);
    const diverged = cloneRepository(scope, 'diverged', 'main');
    const detached = cloneRepository(scope, 'detached', 'main');
    const noUpstream = cloneRepository(scope, 'no-upstream', 'main');
    const localCommit = commit(diverged.repo, 'local commit');
    git(detached.repo, 'checkout', '--detach');
    git(noUpstream.repo, 'branch', '--unset-upstream');
    for (const { repo } of [diverged, detached, noUpstream]) {
        fs.writeFileSync(path.join(repo, 'untracked.txt'), 'keep');
    }

    const result = pull(scope.workspace, '--force');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /0 succeeded, 3 failed/);
    assert.match(result.stderr, /have diverged/);
    assert.match(result.stderr, /HEAD is detached/);
    assert.match(result.stderr, /has no upstream/);
    assert.equal(git(diverged.repo, 'rev-parse', 'HEAD'), localCommit);
    for (const { repo } of [diverged, detached, noUpstream]) {
        assert.equal(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf8'), 'keep');
    }
});

test('pull --force blocks an upstream path conflict before cleaning a parent worktree', (t) => {
    const scope = fixture(t);
    const parent = cloneRepository(scope, '', 'main');
    const child = cloneRepository(scope, 'nested/child', 'main');
    const conflict = path.join('nested', 'child', 'content.txt');
    fs.mkdirSync(path.join(parent.source, path.dirname(conflict)), { recursive: true });
    fs.writeFileSync(path.join(parent.source, conflict), 'tracked by upstream parent');
    git(parent.source, 'add', conflict);
    git(parent.source, '-c', 'user.name=CodeWS Tests', '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'conflict with child');
    fs.writeFileSync(path.join(parent.repo, 'tracked.txt'), 'keep local edits');

    const result = pull(scope.workspace, '--force');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tracked path conflict/);
    assert.equal(git(parent.repo, 'rev-parse', 'HEAD'), parent.initial);
    assert.equal(fs.readFileSync(path.join(parent.repo, 'tracked.txt'), 'utf8'), 'keep local edits');
    assert.equal(git(child.repo, 'rev-parse', 'HEAD'), child.latest);
    assert.equal(fs.existsSync(path.join(child.repo, 'content.txt')), false);
});
