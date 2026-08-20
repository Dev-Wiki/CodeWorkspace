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

function createFixture(t, sourceName, branch) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-argv-'));
    const workspaceRoot = path.join(fixtureRoot, 'workspace');
    const sourcePath = path.join(fixtureRoot, sourceName);
    fs.mkdirSync(workspaceRoot);
    fs.mkdirSync(sourcePath);
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

    runGit(sourcePath, ['init']);
    runGit(sourcePath, ['branch', '-M', branch]);
    fs.writeFileSync(path.join(sourcePath, 'tracked.txt'), 'fixture\n', 'utf8');
    runGit(sourcePath, ['add', 'tracked.txt']);
    runGit(sourcePath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'initial'
    ]);

    return {
        workspaceRoot,
        sourcePath,
        branch,
        head: runGit(sourcePath, ['rev-parse', 'HEAD'])
    };
}

async function cloneFixture(fixture, targetName) {
    await checkoutWorkspace({
        workspaceRoot: fixture.workspaceRoot,
        repos: {
            Literal: {
                path: targetName,
                url: fixture.sourcePath,
                branch: fixture.branch
            }
        }
    });
    return path.join(fixture.workspaceRoot, targetName);
}

test('clone preserves spaces and apostrophes in source and destination paths', async (t) => {
    const fixture = createFixture(t, "Source With Space's Origin", 'main');
    const targetPath = await cloneFixture(fixture, "Repo With Space's Copy");

    assert.equal(runGit(targetPath, ['rev-parse', 'HEAD']), fixture.head);
    assert.equal(runGit(targetPath, ['remote', 'get-url', 'origin']), fixture.sourcePath);
});

test('clone passes a branch containing shell syntax as one literal argument', async (t) => {
    const fixture = createFixture(t, 'source', "feature'quote");
    const targetPath = await cloneFixture(fixture, 'target');

    assert.equal(runGit(targetPath, ['branch', '--show-current']), fixture.branch);
    assert.equal(runGit(targetPath, ['rev-parse', 'HEAD']), fixture.head);
});

test('existing repository checkout preserves a branch containing shell syntax', async (t) => {
    const fixture = createFixture(t, 'source', 'original');
    const targetPath = path.join(fixture.workspaceRoot, 'target');
    execFileSync('git', ['clone', '-b', 'original', fixture.sourcePath, targetPath], {
        cwd: fixture.workspaceRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const targetBranch = "feature'quote";
    runGit(fixture.sourcePath, ['checkout', '-b', targetBranch]);
    fs.writeFileSync(path.join(fixture.sourcePath, 'tracked.txt'), 'updated\n', 'utf8');
    runGit(fixture.sourcePath, ['add', 'tracked.txt']);
    runGit(fixture.sourcePath, [
        '-c', 'user.name=CodeWS Tests',
        '-c', 'user.email=codews@example.invalid',
        'commit', '-m', 'updated'
    ]);
    const targetHead = runGit(fixture.sourcePath, ['rev-parse', 'HEAD']);

    await checkoutWorkspace({
        workspaceRoot: fixture.workspaceRoot,
        repos: {
            Literal: {
                path: 'target',
                url: fixture.sourcePath,
                branch: targetBranch
            }
        }
    });

    assert.equal(runGit(targetPath, ['branch', '--show-current']), targetBranch);
    assert.equal(runGit(targetPath, ['rev-parse', 'HEAD']), targetHead);
});
