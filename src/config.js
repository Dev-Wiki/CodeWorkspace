const fs = require('fs');
const path = require('path');
const os = require('os');

function loadConfig(envName) {
    const filename = envName.endsWith('.json') ? envName : `${envName}.json`;
    let currentDir = process.cwd();
    const globalPath = path.join(os.homedir(), '.codews', filename);

    // 1. Local Lookup (up to root)
    while (true) {
        const localPath = path.join(currentDir, '.codews', filename);
        if (fs.existsSync(localPath) && localPath !== globalPath) {
            return { configPath: localPath, workspaceRoot: currentDir };
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }

    // 2. Global Lookup
    if (fs.existsSync(globalPath)) {
        return { configPath: globalPath, workspaceRoot: process.cwd() };
    }

    return null;
}

function getResolvedWorkspace(configResult) {
    const { configPath, workspaceRoot } = configResult;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let resolvedRepos = {};

    if (raw.base) {
        const baseFilename = raw.base.endsWith('.json') ? raw.base : `${raw.base}.json`;
        const basePath = path.resolve(path.dirname(configPath), baseFilename);
        if (fs.existsSync(basePath)) {
            const baseWorkspace = getResolvedWorkspace({ configPath: basePath, workspaceRoot });
            resolvedRepos = { ...baseWorkspace.repos };
        } else {
            console.warn(`Warning: Base config not found at ${basePath}`);
        }
    }

    if (raw.repos) {
        for (const [repoName, config] of Object.entries(raw.repos)) {
            if (config.ignore === true) {
                delete resolvedRepos[repoName];
            } else if (resolvedRepos[repoName]) {
                resolvedRepos[repoName] = { ...resolvedRepos[repoName], ...config };
            } else {
                resolvedRepos[repoName] = config;
            }
        }
    }

    return {
        name: raw.name || path.basename(configPath, '.json'),
        workspaceRoot: workspaceRoot,
        repos: resolvedRepos
    };
}

function scanDir(baseDir, currentPath = '') {
    let results = [];
    const targetDir = path.join(baseDir, currentPath);
    if (!fs.existsSync(targetDir)) return results;
    
    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            results = results.concat(scanDir(baseDir, path.join(currentPath, entry.name)));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
            const relPath = path.join(currentPath, entry.name);
            results.push(relPath.replace(/\\/g, '/').replace(/\.json$/, ''));
        }
    }
    return results;
}

function listConfigs() {
    let currentDir = process.cwd();
    let localDir = null;
    const globalDir = path.join(os.homedir(), '.codews');

    while (true) {
        const potentialPath = path.join(currentDir, '.codews');
        if (fs.existsSync(potentialPath) && fs.statSync(potentialPath).isDirectory()) {
            if (potentialPath !== globalDir) {
                localDir = potentialPath;
            }
            break;
        }
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) break;
        currentDir = parentDir;
    }

    const configs = [];
    if (localDir) {
        const localNames = scanDir(localDir);
        localNames.forEach(name => {
            configs.push({ name, scope: 'Local', path: path.join(localDir, name + '.json') });
        });
    }

    if (fs.existsSync(globalDir) && fs.statSync(globalDir).isDirectory()) {
        const globalNames = scanDir(globalDir);
        globalNames.forEach(name => {
            configs.push({ name, scope: 'Global', path: path.join(globalDir, name + '.json') });
        });
    }

    return configs;
}

module.exports = { loadConfig, getResolvedWorkspace, listConfigs };
