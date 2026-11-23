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

function commit(repo, message, file) {
    git(repo, 'add', '--', file);
    git(repo, '-c', 'user.name=CodeWS Tests', '-c', 'user.email=codews@example.invalid',
        'commit', '-m', message);
    return git(repo, 'rev-parse', 'HEAD');
}

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-reset-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}

function init(repo, branch = 'main') {
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init', '-b', branch);
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'committed\n');
    return commit(repo, 'initial', 'tracked.txt');
}

function reset(cwd, ...args) {
    const result = spawnSync(process.execPath, [cli, 'reset', ...args], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    assert.equal(result.error, undefined);
    return result;
}

function writeEnvironment(root, repos) {
    const dir = path.join(root, '.codews');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ repos }));
}

test('reset --hard restores each current HEAD and keeps ordinary untracked and ignored files', (t) => {
    const root = fixture(t);
    const main = path.join(root, 'main');
    const detached = path.join(root, 'group', 'detached');
    const heads = [init(main, 'fix'), init(detached)];
    git(detached, 'checkout', '--detach');
    for (const repo of [main, detached]) {
        const file = path.join(repo, 'tracked.txt');
        fs.writeFileSync(file, 'staged edits');
        git(repo, 'add', 'tracked.txt');
        fs.writeFileSync(file, 'unstaged edits');
        fs.writeFileSync(path.join(repo, '.git', 'info', 'exclude'), 'ignored.txt\n');
        fs.writeFileSync(path.join(repo, 'ignored.txt'), 'keep');
        fs.writeFileSync(path.join(repo, 'untracked.txt'), 'keep');
    }

    const result = reset(root, '--hard');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 succeeded, 0 failed/);
    assert.equal(git(main, 'branch', '--show-current'), 'fix');
    assert.equal(git(detached, 'branch', '--show-current'), '');
    for (const [index, repo] of [main, detached].entries()) {
        assert.equal(git(repo, 'rev-parse', 'HEAD'), heads[index]);
        assert.equal(git(repo, 'diff', '--cached', '--name-only'), '');
        assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'committed\n');
        assert.equal(fs.readFileSync(path.join(repo, 'ignored.txt'), 'utf8'), 'keep');
        assert.equal(fs.readFileSync(path.join(repo, 'untracked.txt'), 'utf8'), 'keep');
    }
    assert.equal(fs.existsSync(path.join(root, '.codews')), false);
});

test('reset requires --hard and applies the selected environment scope', (t) => {
    const root = fixture(t);
    const selected = path.join(root, 'selected');
    const other = path.join(root, 'other');
    for (const repo of [selected, other]) {
        init(repo);
        fs.writeFileSync(path.join(repo, 'tracked.txt'), 'local edits');
    }
    writeEnvironment(root, { Selected: { path: 'selected', branch: 'other-branch' } });

    const missingHard = reset(selected, '-e', 'fixture');
    assert.equal(missingHard.status, 1);
    assert.match(missingHard.stderr, /--hard/);
    assert.equal(fs.readFileSync(path.join(selected, 'tracked.txt'), 'utf8'), 'local edits');

    const result = reset(selected, '-e', 'fixture', '--hard');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git(selected, 'branch', '--show-current'), 'main');
    assert.equal(fs.readFileSync(path.join(selected, 'tracked.txt'), 'utf8'), 'committed\n');
    assert.equal(fs.readFileSync(path.join(other, 'tracked.txt'), 'utf8'), 'local edits');
});

test('reset --hard rejects a parent path conflict and continues with other selected repositories', (t) => {
    const root = fixture(t);
    const parent = path.join(root, 'parent');
    const child = path.join(parent, 'child');
    const other = path.join(root, 'other');
    init(parent);
    fs.writeFileSync(child, 'tracked by parent');
    commit(parent, 'track child path', 'child');
    fs.unlinkSync(child);
    const childHead = init(child);
    init(other);
    for (const repo of [parent, child, other]) {
        fs.writeFileSync(path.join(repo, 'tracked.txt'), 'local edits');
    }
    writeEnvironment(root, { Parent: { path: 'parent' }, Other: { path: 'other' } });

    const result = reset(root, '--hard', '-e', 'fixture');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /tracked path conflict/);
    assert.match(result.stdout, /1 succeeded, 1 failed/);
    assert.equal(git(child, 'rev-parse', 'HEAD'), childHead);
    assert.equal(fs.readFileSync(path.join(child, 'tracked.txt'), 'utf8'), 'local edits');
    assert.equal(fs.readFileSync(path.join(parent, 'tracked.txt'), 'utf8'), 'local edits');
    assert.equal(fs.readFileSync(path.join(other, 'tracked.txt'), 'utf8'), 'committed\n');
});
