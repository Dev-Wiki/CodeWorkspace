const test = require('node:test');
const assert = require('node:assert/strict');

const packageManifest = require('../package.json');
const packageLock = require('../package-lock.json');

test('package-lock top-level identity matches package.json', () => {
    assert.equal(packageLock.name, packageManifest.name);
    assert.equal(packageLock.version, packageManifest.version);
});

test('package-lock root package identity matches package.json', () => {
    const lockRoot = packageLock.packages[''];
    assert.equal(lockRoot.name, packageManifest.name);
    assert.equal(lockRoot.version, packageManifest.version);
    assert.equal(lockRoot.license, packageManifest.license);
});

test('package-lock root dependencies match package.json', () => {
    assert.deepEqual(packageLock.packages[''].dependencies, packageManifest.dependencies);
});
