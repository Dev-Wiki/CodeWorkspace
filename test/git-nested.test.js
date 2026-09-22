const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkDirty, checkoutWorkspace } = require('../src/git');

function git(cwd, ...args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function commit(cwd) {
    git(cwd, 'add', '.');
    git(cwd, '-c', 'user.name=CodeWS Tests', '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'fixture');
}

function init(cwd) {
    fs.mkdirSync(cwd, { recursive: true });
    git(cwd, 'init');
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'original\n');
    commit(cwd);
}

function fixture(t, childName = 'Child') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-nested-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const parent = path.join(root, 'Parent');
    const child = path.join(parent, childName);
    init(parent);
    const workspace = {
        workspaceRoot: root,
        repos: { Parent: { path: 'Parent' }, Child: { path: `Parent/${childName}` } }
    };
    return { root, parent, child, workspace };
}

for (const options of [{ force: true }, { stash: true }]) {
    test(`${JSON.stringify(options)} rejects a non-repository child before changing the parent`, async (t) => {
        const { parent, child, workspace } = fixture(t);
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(child, 'keep.txt'), 'keep');
        fs.writeFileSync(path.join(parent, 'tracked.txt'), 'local work');
        await assert.rejects(checkDirty(workspace, options), /Child.*(root|repository)/i);
        assert.equal(fs.readFileSync(path.join(parent, 'tracked.txt'), 'utf8'), 'local work');
        assert.equal(fs.readFileSync(path.join(child, 'keep.txt'), 'utf8'), 'keep');
        assert.equal(git(parent, 'stash', 'list'), '');
    });
}

test('direct checkout validates all existing roots before cloning anything', async (t) => {
    const { root, parent, child, workspace } = fixture(t);
    fs.mkdirSync(child);
    workspace.repos = { First: { path: 'First', url: parent }, ...workspace.repos };
    await assert.rejects(checkoutWorkspace(workspace), /Child.*(root|repository)/i);
    assert.equal(fs.existsSync(path.join(root, 'First')), false);
});

test('force preserves nested repositories and removes ordinary directories in each', async (t) => {
    const { parent, child, workspace } = fixture(t, "group/Child [1]'s");
    init(child);
    const heads = [git(parent, 'rev-parse', 'HEAD'), git(child, 'rev-parse', 'HEAD')];
    for (const repo of [parent, child]) {
        fs.writeFileSync(path.join(repo, 'tracked.txt'), 'modified');
        fs.mkdirSync(path.join(repo, '.dev'));
        fs.writeFileSync(path.join(repo, '.dev', 'scratch'), 'remove');
    }
    const sibling = path.join(path.dirname(child), 'ordinary.txt');
    fs.writeFileSync(sibling, 'remove');
    assert.equal(await checkDirty(workspace, { force: true }), true);
    assert.equal(fs.existsSync(sibling), false);
    for (const [index, repo] of [parent, child].entries()) {
        assert.equal(git(repo, 'rev-parse', 'HEAD'), heads[index]);
        assert.equal(fs.existsSync(path.join(repo, '.git')), true);
        assert.equal(fs.existsSync(path.join(repo, '.dev')), false);
        assert.equal(fs.readFileSync(path.join(repo, 'tracked.txt'), 'utf8'), 'original\n');
    }
});

test('missing configured child remains eligible for cloning', async (t) => {
    const { parent, child, workspace } = fixture(t);
    workspace.repos.Child.url = parent;
    assert.equal(await checkDirty(workspace, { force: true }), true);
    // Only clone the missing child; the parent has no configured remote.
    await checkoutWorkspace({ ...workspace, repos: { Child: workspace.repos.Child } });
    assert.equal(git(child, 'rev-parse', '--show-toplevel'), child);
});

test('force accepts a nested linked worktree with a .git file', async (t) => {
    const { root, parent, child, workspace } = fixture(t);
    const source = path.join(root, 'Source');
    init(source);
    git(source, 'worktree', 'add', '--detach', child);
    assert.equal(fs.statSync(path.join(child, '.git')).isFile(), true);
    fs.writeFileSync(path.join(child, 'tracked.txt'), 'modified');
    assert.equal(await checkDirty(workspace, { force: true }), true);
    assert.equal(fs.readFileSync(path.join(child, 'tracked.txt'), 'utf8'), 'original\n');
    assert.equal(git(parent, 'rev-parse', '--show-toplevel'), parent);
});

test('force accepts a configured submodule and cleans it separately', async (t) => {
    const { root, parent, child, workspace } = fixture(t);
    const source = path.join(root, 'Source');
    init(source);
    git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'Child');
    commit(parent);
    git(parent, 'config', 'submodule.recurse', 'true');
    fs.writeFileSync(path.join(child, 'tracked.txt'), 'child commit\n');
    commit(child);
    const childHead = git(child, 'rev-parse', 'HEAD');
    fs.writeFileSync(path.join(child, 'tracked.txt'), 'modified');
    assert.equal(await checkDirty(workspace, { force: true }), true);
    assert.equal(fs.statSync(path.join(child, '.git')).isFile(), true);
    assert.equal(fs.readFileSync(path.join(child, 'tracked.txt'), 'utf8'), 'child commit\n');
    assert.equal(git(child, 'rev-parse', 'HEAD'), childHead);
});

test('force rejects a damaged child repository before changing the parent', async (t) => {
    const { parent, child, workspace } = fixture(t);
    init(child);
    fs.writeFileSync(path.join(child, '.git', 'HEAD'), 'broken HEAD');
    fs.writeFileSync(path.join(parent, 'tracked.txt'), 'keep');
    await assert.rejects(checkDirty(workspace, { force: true }), /Child.*(root|repository)/i);
    assert.equal(fs.readFileSync(path.join(parent, 'tracked.txt'), 'utf8'), 'keep');
});

test('root validation accepts a symlink alias to a worktree inside the workspace', async (t) => {
    const { parent, child, workspace } = fixture(t);
    init(child);
    const alias = path.join(workspace.workspaceRoot, 'Alias');
    try {
        fs.symlinkSync(child, alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (err) {
        if (err.code !== 'EPERM') throw err;
        t.skip('Creating symlinks is not permitted.');
        return;
    }
    workspace.repos.Child.path = 'Alias';
    assert.equal(await checkDirty(workspace, { force: true }), true);
    assert.equal(git(child, 'rev-parse', '--show-toplevel'), fs.realpathSync(child));
    assert.equal(fs.existsSync(path.join(parent, '.git')), true);
});

test('parent tracked files inside a configured child abort before reset', async (t) => {
    const { parent, child, workspace } = fixture(t);
    fs.mkdirSync(child);
    fs.writeFileSync(path.join(child, 'tracked.txt'), 'parent version');
    commit(parent);
    init(child);
    fs.writeFileSync(path.join(child, 'tracked.txt'), 'child local work');
    await assert.rejects(checkDirty(workspace, { force: true }), /tracked path conflict:/i);
    assert.equal(fs.readFileSync(path.join(child, 'tracked.txt'), 'utf8'), 'child local work');
});

for (const change of ['update', 'delete']) {
    test(`staged submodule ${change} remains dirty in the parent`, async (t) => {
        const { root, parent, child, workspace } = fixture(t);
        const source = path.join(root, 'Source');
        init(source);
        git(parent, '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'Child');
        commit(parent);
        if (change === 'update') {
            fs.writeFileSync(path.join(child, 'tracked.txt'), 'new child commit');
            commit(child);
            git(parent, 'add', 'Child');
        } else {
            git(parent, 'rm', '--cached', 'Child');
        }
        assert.equal(await checkDirty(workspace), false);
        assert.notEqual(git(parent, 'diff', '--cached', '--name-only'), '');
        const expectedIndex = git(parent, 'ls-files', '--stage', 'Child');
        const stashed = await checkDirty(workspace, { stash: true });
        if (stashed) {
            assert.notEqual(git(parent, 'stash', 'list'), '');
            const savedIndex = git(parent, 'ls-tree', 'stash@{0}^2', '--', 'Child');
            if (change === 'update') {
                assert.ok(savedIndex.includes(git(child, 'rev-parse', 'HEAD')));
            } else {
                assert.equal(savedIndex, '');
            }
        } else {
            // Some Git versions cannot stash gitlink-only changes; report failure
            // and leave the staged work intact instead of claiming a clean tree.
            assert.equal(git(parent, 'ls-files', '--stage', 'Child'), expectedIndex);
        }
    });
}

test('an ancestor file staged in the parent conflicts with a deep child', async (t) => {
    const { parent, child, workspace } = fixture(t, 'group/deep/Child');
    const ancestor = path.join(parent, 'group');
    fs.writeFileSync(ancestor, 'staged parent file');
    git(parent, 'add', 'group');
    fs.unlinkSync(ancestor);
    init(child);
    await assert.rejects(checkDirty(workspace, { force: true }), /tracked path conflict:/i);
    assert.equal(fs.existsSync(path.join(child, '.git')), true);
});

test('a HEAD file replaced locally by a child repository aborts before reset', async (t) => {
    const { parent, child, workspace } = fixture(t);
    fs.writeFileSync(child, 'parent file');
    commit(parent);
    git(parent, 'rm', 'Child');
    init(child);
    const head = git(child, 'rev-parse', 'HEAD');
    await assert.rejects(checkDirty(workspace, { force: true }), /tracked path conflict:/i);
    assert.equal(git(child, 'rev-parse', 'HEAD'), head);
});

test('deep parent files staged for deletion cannot be restored into a child by reset', async (t) => {
    const { parent, child, workspace } = fixture(t, 'group/deep/Child');
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(child, 'parent.txt'), 'parent file');
    commit(parent);
    git(parent, 'rm', '-r', 'group');
    init(child);
    await assert.rejects(checkDirty(workspace, { force: true }), /tracked path conflict:/i);
    assert.equal(fs.existsSync(path.join(child, 'parent.txt')), false);
});

test('checkout rejects a target tree that overlaps a configured child', async (t) => {
    const { root, parent, child, workspace } = fixture(t);
    const originalBranch = git(parent, 'branch', '--show-current');
    const source = path.join(root, 'Source');
    git(root, 'clone', parent, source);
    git(source, 'checkout', '-b', 'conflicting-target');
    fs.mkdirSync(path.join(source, 'Child'));
    fs.writeFileSync(path.join(source, 'Child', 'tracked.txt'), 'parent target file');
    commit(source);
    git(parent, 'remote', 'add', 'origin', source);
    init(child);
    const childHead = git(child, 'rev-parse', 'HEAD');
    workspace.repos.Parent.branch = 'conflicting-target';
    await assert.rejects(checkoutWorkspace(workspace), /tracked path conflict:/i);
    assert.equal(git(parent, 'branch', '--show-current'), originalBranch);
    assert.equal(git(child, 'rev-parse', 'HEAD'), childHead);
    assert.equal(fs.readFileSync(path.join(child, 'tracked.txt'), 'utf8'), 'original\n');
});

test('checkout allows a new remote branch with a configured nested repository', async (t) => {
    const { root, parent, child, workspace } = fixture(t);
    const source = path.join(root, 'Source');
    git(root, 'clone', parent, source);
    git(source, 'checkout', '-b', 'new-target');
    fs.writeFileSync(path.join(source, 'tracked.txt'), 'target\n');
    commit(source);
    git(parent, 'remote', 'add', 'origin', source);
    // Keep the child missing: it has no URL and should be skipped after parent checkout.
    workspace.repos.Parent.branch = 'new-target';
    await checkoutWorkspace(workspace);
    assert.equal(git(parent, 'branch', '--show-current'), 'new-target');
    assert.equal(fs.readFileSync(path.join(parent, 'tracked.txt'), 'utf8'), 'target\n');
    assert.equal(fs.existsSync(child), false);
});

test('checkout rejects upstream conflicts even if the local branch has no conflict', async (t) => {
    const { root, parent, child, workspace } = fixture(t);
    const branch = git(parent, 'branch', '--show-current');
    const parentHead = git(parent, 'rev-parse', 'HEAD');
    const source = path.join(root, 'Source');
    git(root, 'clone', parent, source);
    git(parent, 'remote', 'add', 'origin', source);
    git(parent, 'fetch', 'origin');
    git(parent, 'branch', '--set-upstream-to', `origin/${branch}`);
    fs.mkdirSync(path.join(source, 'Child'));
    fs.writeFileSync(path.join(source, 'Child', 'parent.txt'), 'upstream file');
    commit(source);
    init(child);
    workspace.repos.Parent.branch = branch;
    await assert.rejects(checkoutWorkspace(workspace), /tracked path conflict:/i);
    assert.equal(git(parent, 'rev-parse', 'HEAD'), parentHead);
    assert.equal(fs.existsSync(path.join(child, 'parent.txt')), false);
});
