const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getResolvedWorkspace } = require('../src/config');

function createConfigFixture(t) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codews-config-'));
    t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
    return fixtureRoot;
}

function writeConfig(fixtureRoot, filename, config) {
    const configPath = path.join(fixtureRoot, filename);
    fs.writeFileSync(configPath, JSON.stringify(config), 'utf8');
    return configPath;
}

test('missing base config fails closed with the inheritance chain', (t) => {
    const fixtureRoot = createConfigFixture(t);
    const childPath = writeConfig(fixtureRoot, 'child.json', {
        base: 'missing.json',
        repos: {
            OnlyOverlay: { branch: 'feature' }
        }
    });

    assert.throws(
        () => getResolvedWorkspace({ configPath: childPath, workspaceRoot: fixtureRoot }),
        /Base config not found: .*missing\.json.*Inheritance chain: child\.json -> missing\.json/
    );
});

test('cyclic base config fails with a finite inheritance chain', (t) => {
    const fixtureRoot = createConfigFixture(t);
    const firstPath = writeConfig(fixtureRoot, 'first.json', { base: 'second.json' });
    writeConfig(fixtureRoot, 'second.json', { base: 'first.json' });

    assert.throws(
        () => getResolvedWorkspace({ configPath: firstPath, workspaceRoot: fixtureRoot }),
        /Circular base config inheritance: first\.json -> second\.json -> first\.json/
    );
});

test('valid base inheritance still merges repository overrides', (t) => {
    const fixtureRoot = createConfigFixture(t);
    writeConfig(fixtureRoot, 'base.json', {
        repos: {
            Shared: { branch: 'main', depth: 1 }
        }
    });
    const childPath = writeConfig(fixtureRoot, 'child.json', {
        base: 'base.json',
        repos: {
            Shared: { branch: 'feature' },
            ChildOnly: { branch: 'main' }
        }
    });

    const workspace = getResolvedWorkspace({
        configPath: childPath,
        workspaceRoot: fixtureRoot
    });

    assert.deepEqual(workspace.repos, {
        Shared: { branch: 'feature', depth: 1 },
        ChildOnly: { branch: 'main' }
    });
});
