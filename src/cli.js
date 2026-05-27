const { Command } = require('commander');
const { loadConfig, getResolvedWorkspace, listConfigs } = require('./config');
const { checkDirty, checkoutWorkspace, statusWorkspace } = require('./git');
const path = require('path');
const fs = require('fs');

const { execSync } = require('child_process');

function adjustWorkspaceRoot(workspace) {
    try {
        const toplevel = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (toplevel) {
            const basename = path.basename(toplevel);
            for (const [repoName, config] of Object.entries(workspace.repos)) {
                const p = config.path || repoName;
                if (p === basename || p.endsWith('/' + basename) || p.endsWith('\\' + basename)) {
                    let root = toplevel;
                    const parts = p.split(/[/\\]/);
                    for (let i = 0; i < parts.length; i++) {
                        root = path.dirname(root);
                    }
                    if (fs.existsSync(root)) {
                        workspace.workspaceRoot = root;
                    }
                    break;
                }
            }
        }
    } catch (e) {
        // Ignore errors if not in a git repo
    }
}

function run(argv) {
    const program = new Command();
    program
        .name('codews')
        .description('Workspace manager for multi-repo projects')
        .version('1.0.0');

    program.command('switch <env>')
        .description('Switch workspace to a specific environment')
        .option('--stash', 'Auto-stash changes before switching')
        .option('--force', 'Force reset and clean changes before switching')
        .action(async (env, options) => {
            try {
                const configResult = loadConfig(env);
                if (!configResult) {
                    console.error(`Error: Configuration for '${env}' not found.`);
                    process.exit(1);
                }
                const workspace = getResolvedWorkspace(configResult);
                adjustWorkspaceRoot(workspace);
                
                console.log('Validating workspace status...');
                const isClean = await checkDirty(workspace, options);
                if (!isClean) {
                    console.error('Error: Working tree is dirty. Please commit or stash your changes before switching.');
                    process.exit(1);
                }

                console.log(`Switching to environment: ${env}`);
                await checkoutWorkspace(workspace);
                console.log('Switch completed successfully.');
            } catch (err) {
                console.error('Switch failed:', err.message);
                process.exit(1);
            }
        });

    program.command('status')
        .description('Check git status for all repositories in the current workspace')
        .option('-e, --env <env>', 'Specify environment to check against')
        .action((options) => {
            if (options.env) {
                const configResult = loadConfig(options.env);
                if (!configResult) {
                    console.error(`Error: Configuration for '${options.env}' not found.`);
                    process.exit(1);
                }
                const workspace = getResolvedWorkspace(configResult);
                adjustWorkspaceRoot(workspace);
                statusWorkspace(workspace);
            } else {
                statusWorkspace(null);
            }
        });

    program.command('list [namespace]')
        .description('List all available environments in the current scope')
        .action((namespace) => {
            const configs = listConfigs();
            const filteredConfigs = namespace 
                ? configs.filter(c => c.name.startsWith(namespace + '/'))
                : configs;

            if (filteredConfigs.length === 0) {
                console.log('No environments found. Check your .codews directories.');
                return;
            }
            console.log('Available environments:');
            filteredConfigs.forEach(c => {
                console.log(`  - ${c.name.padEnd(25)} [${c.scope}]  ${c.path}`);
            });
        });

    program.command('show <env>')
        .description('Show resolved configuration and branch details for an environment')
        .action((env) => {
            const configResult = loadConfig(env);
            if (!configResult) {
                console.error(`Error: Configuration for '${env}' not found.`);
                process.exit(1);
            }
            const workspace = getResolvedWorkspace(configResult);
            adjustWorkspaceRoot(workspace);
            console.log(`Environment: ${workspace.name}`);
            console.log(`Root: ${workspace.workspaceRoot}`);
            console.log('\nRepositories:');
            for (const [repoName, config] of Object.entries(workspace.repos)) {
                const branch = config.branch || 'N/A';
                const pathStr = config.path || repoName;
                console.log(`  - ${repoName.padEnd(20)} => Branch: ${branch.padEnd(30)} Path: ${pathStr}`);
            }
        });

    program.parse(argv);
}

module.exports = { run };
