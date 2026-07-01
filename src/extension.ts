import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Auto Commit Message');
    context.subscriptions.push(outputChannel);

    const command = vscode.commands.registerCommand('auto-commit-message.generateMessage', async (scmResource?: any) => {
        let workspaceRoot: string;
        
        if (scmResource && scmResource.rootUri) {
            workspaceRoot = scmResource.rootUri.fsPath;
        } else {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder open');
                return;
            }
            workspaceRoot = folders[0].uri.fsPath;
        }
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Deep analyzing changes...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: 'Checking repository...' });
                
                if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
                    vscode.window.showErrorMessage('Not a Git repository');
                    return;
                }

                progress.report({ increment: 10, message: 'Getting changed files...' });
                
                const changes = await getChangesDeep(workspaceRoot);
                
                if (changes.length === 0) {
                    vscode.window.showInformationMessage('No changes detected');
                    return;
                }

                progress.report({ increment: 20, message: `Reading ${changes.length} files...` });
                
                await readChangedFiles(workspaceRoot, changes);
                
                progress.report({ increment: 40, message: 'Analyzing code structure...' });
                
                const analysis = await deepAnalyze(changes);
                
                progress.report({ increment: 70, message: 'Generating message...' });
                
                const message = generateAdvancedMessage(analysis, changes);
                
                progress.report({ increment: 90, message: 'Inserting...' });
                
                await insertMessage(message, workspaceRoot);
                
                outputChannel.appendLine(`✅ ${message}`);
                
                const actions = ['📋 Copy', '📊 Full Analysis', '🔄 Retry'];
                const result = await vscode.window.showInformationMessage(message, ...actions);
                
                if (result === '📋 Copy') {
                    await vscode.env.clipboard.writeText(message);
                } else if (result === '📊 Full Analysis') {
                    await showDeepAnalysis(analysis, changes);
                } else if (result === '🔄 Retry') {
                    vscode.commands.executeCommand('auto-commit-message.generateMessage', scmResource);
                }
                
            } catch (error) {
                vscode.window.showErrorMessage(`Error: ${error}`);
            }
        });
    });

    context.subscriptions.push(command);
}

async function getChangesDeep(workspaceRoot: string): Promise<any[]> {
    const changes: any[] = [];
    
    try {
        const { stdout: status } = await execAsync('git status --porcelain -u', { cwd: workspaceRoot });
        if (!status.trim()) return changes;
        
        const lines = status.split('\n').filter((l: string) => l.trim());
        
        for (const line of lines) {
            const code = line.substring(0, 2).trim();
            const filePath = line.substring(3).trim();
            
            let changeType = 'modified';
            let staged = false;
            
            if (code === '??') { changeType = 'untracked'; }
            else if (code === 'A ' || code === 'AM') { changeType = 'added'; staged = true; }
            else if (code === 'M ' || code === 'MM') { changeType = 'modified'; staged = true; }
            else if (code === 'D ' || code === 'AD') { changeType = 'deleted'; staged = true; }
            else if (code === 'R ') { changeType = 'renamed'; staged = true; }
            else if (code === ' M') { changeType = 'modified'; staged = false; }
            else if (code === ' D') { changeType = 'deleted'; staged = false; }
            
            const fileExt = path.extname(filePath).toLowerCase();
            const fileName = path.basename(filePath);
            const dirName = path.dirname(filePath).split(/[\/\\]/).pop() || 'root';
            
            changes.push({
                filePath,
                fileName,
                fileExt,
                dirName,
                changeType,
                staged,
                additions: 0,
                deletions: 0,
                content: '',
                diff: ''
            });
        }
    } catch (error) {
        console.error('Error getting changes:', error);
    }
    
    return changes;
}

async function readChangedFiles(workspaceRoot: string, changes: any[]): Promise<void> {
    for (const change of changes) {
        if (change.changeType === 'deleted') continue;
        
        try {
            const fullPath = path.join(workspaceRoot, change.filePath);
            if (fs.existsSync(fullPath)) {
                const content = fs.readFileSync(fullPath, 'utf8');
                change.content = content;
            }
        } catch (error) {}
        
        try {
            let diffCmd = change.staged ? 
                `git diff --cached -p -- "${change.filePath}"` : 
                `git diff -p -- "${change.filePath}"`;
            
            if (change.changeType === 'untracked') {
                diffCmd = `git diff --no-index /dev/null "${change.filePath}"`;
            }
            
            const { stdout } = await execAsync(diffCmd, { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
            change.diff = stdout || '';
        } catch (error) {}
    }
}

async function deepAnalyze(changes: any[]): Promise<any> {
    const analysis: any = {
        projectType: '',
        languages: new Set<string>(),
        frameworks: new Set<string>(),
        packages: new Set<string>(),
        functions: [] as any[],
        classes: [] as any[],
        components: [] as any[],
        hooks: [] as string[],
        apis: [] as string[],
        routes: [] as string[],
        models: [] as string[],
        services: [] as string[],
        utils: [] as string[],
        configs: [] as string[],
        styles: [] as string[],
        tests: [] as string[],
        docs: [] as string[],
        bugfixes: [] as string[],
        features: [] as string[],
        refactors: [] as string[],
        dependencies: { added: [] as string[], removed: [] as string[], updated: [] as string[] },
        summary: {
            totalFiles: changes.length,
            totalAdditions: 0,
            totalDeletions: 0,
            newFiles: 0,
            deletedFiles: 0,
            modifiedFiles: 0,
            stagedFiles: 0,
            unstagedFiles: 0
        }
    };
    
    analysis.summary.newFiles = changes.filter((c: any) => c.changeType === 'added' || c.changeType === 'untracked').length;
    analysis.summary.deletedFiles = changes.filter((c: any) => c.changeType === 'deleted').length;
    analysis.summary.modifiedFiles = changes.filter((c: any) => c.changeType === 'modified').length;
    analysis.summary.stagedFiles = changes.filter((c: any) => c.staged).length;
    analysis.summary.unstagedFiles = changes.filter((c: any) => !c.staged).length;
    
    for (const change of changes) {
        const ext = change.fileExt;
        const content = change.content || '';
        const diff = change.diff || '';
        const fileName = change.fileName.toLowerCase();
        const filePath = change.filePath.toLowerCase();
        
        if (ext === '.ts' || ext === '.tsx') { analysis.languages.add('TypeScript'); }
        if (ext === '.js' || ext === '.jsx') { analysis.languages.add('JavaScript'); }
        if (ext === '.py') { analysis.languages.add('Python'); }
        if (ext === '.java') { analysis.languages.add('Java'); }
        if (ext === '.go') { analysis.languages.add('Go'); }
        if (ext === '.rs') { analysis.languages.add('Rust'); }
        if (ext === '.rb') { analysis.languages.add('Ruby'); }
        if (ext === '.php') { analysis.languages.add('PHP'); }
        if (ext === '.cs') { analysis.languages.add('C#'); }
        if (ext === '.cpp' || ext === '.c' || ext === '.h') { analysis.languages.add('C/C++'); }
        if (ext === '.css' || ext === '.scss' || ext === '.less') { analysis.languages.add('CSS'); }
        if (ext === '.html') { analysis.languages.add('HTML'); }
        if (ext === '.json') { analysis.languages.add('JSON'); }
        if (ext === '.md') { analysis.languages.add('Markdown'); }
        if (ext === '.sql') { analysis.languages.add('SQL'); }
        
        if (content.includes('react')) { analysis.frameworks.add('React'); }
        if (content.includes('vue')) { analysis.frameworks.add('Vue'); }
        if (content.includes('angular')) { analysis.frameworks.add('Angular'); }
        if (content.includes('next')) { analysis.frameworks.add('Next.js'); }
        if (content.includes('express')) { analysis.frameworks.add('Express'); }
        if (content.includes('django')) { analysis.frameworks.add('Django'); }
        if (content.includes('flask')) { analysis.frameworks.add('Flask'); }
        if (content.includes('spring')) { analysis.frameworks.add('Spring'); }
        if (content.includes('fastapi')) { analysis.frameworks.add('FastAPI'); }
        
        const functionMatches = content.match(/(?:function|def|func)\s+(\w+)/g);
        if (functionMatches) {
            functionMatches.forEach((f: string) => {
                const name = f.split(/\s+/)[1];
                if (name && name.length > 2 && !analysis.functions.find((x: any) => x.name === name)) {
                    analysis.functions.push({ name, file: change.filePath });
                }
            });
        }
        
        const arrowMatches = content.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
        if (arrowMatches) {
            arrowMatches.forEach((f: string) => {
                const name = f.match(/(?:const|let|var)\s+(\w+)/);
                if (name && !analysis.functions.find((x: any) => x.name === name[1])) {
                    analysis.functions.push({ name: name[1], file: change.filePath });
                }
            });
        }
        
        const classMatches = content.match(/class\s+(\w+)/g);
        if (classMatches) {
            classMatches.forEach((c: string) => {
                const name = c.replace('class ', '');
                if (!analysis.classes.find((x: any) => x.name === name)) {
                    analysis.classes.push({ name, file: change.filePath });
                }
            });
        }
        
        if (content.includes('useState') || content.includes('useEffect') || content.includes('useCallback')) {
            const hookMatches = content.match(/use\w+/g);
            if (hookMatches) {
                hookMatches.forEach((h: string) => {
                    if (!analysis.hooks.includes(h)) { analysis.hooks.push(h); }
                });
            }
        }
        
        if (content.includes('export default') || content.includes('export const')) {
            const compMatches = content.match(/export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)/g);
            if (compMatches) {
                compMatches.forEach((c: string) => {
                    const name = c.split(/\s+/).pop();
                    if (name && !analysis.components.find((x: any) => x.name === name)) {
                        analysis.components.push({ name, file: change.filePath });
                    }
                });
            }
        }
        
        if (filePath.includes('/api/') || filePath.includes('/routes/') || filePath.includes('/controllers/')) {
            if (!analysis.apis.includes(change.filePath)) {
                analysis.apis.push(change.filePath);
            }
        }
        
        if (filePath.includes('/models/') || filePath.includes('/entities/') || filePath.includes('/schemas/')) {
            if (!analysis.models.includes(change.filePath)) {
                analysis.models.push(change.filePath);
            }
        }
        
        if (filePath.includes('/services/') || filePath.includes('/providers/')) {
            if (!analysis.services.includes(change.filePath)) {
                analysis.services.push(change.filePath);
            }
        }
        
        if (filePath.includes('/utils/') || filePath.includes('/helpers/') || filePath.includes('/lib/')) {
            if (!analysis.utils.includes(change.filePath)) {
                analysis.utils.push(change.filePath);
            }
        }
        
        if (fileName.includes('config') || fileName.includes('.env') || fileName.includes('setting')) {
            if (!analysis.configs.includes(change.filePath)) {
                analysis.configs.push(change.filePath);
            }
        }
        
        if (filePath.includes('/styles/') || filePath.includes('/css/') || ext === '.css' || ext === '.scss') {
            if (!analysis.styles.includes(change.filePath)) {
                analysis.styles.push(change.filePath);
            }
        }
        
        if (fileName.includes('test') || fileName.includes('spec') || filePath.includes('/tests/') || filePath.includes('/__tests__/')) {
            if (!analysis.tests.includes(change.filePath)) {
                analysis.tests.push(change.filePath);
            }
        }
        
        if (ext === '.md' || fileName.includes('readme') || filePath.includes('/docs/')) {
            if (!analysis.docs.includes(change.filePath)) {
                analysis.docs.push(change.filePath);
            }
        }
        
        const diffLines = diff.split('\n');
        for (const line of diffLines) {
            if (line.startsWith('+') && !line.startsWith('+++')) {
                analysis.summary.totalAdditions++;
                const clean = line.substring(1).toLowerCase();
                if (clean.match(/fix|bug|issue|error|crash|null|undefined|broken|resolve|patch|correct/)) {
                    analysis.bugfixes.push(clean.trim().substring(0, 80));
                }
                if (clean.match(/add|create|new|feature|implement|introduce|support|enable/)) {
                    analysis.features.push(clean.trim().substring(0, 80));
                }
                if (clean.match(/refactor|restructure|simplify|clean|reorganize|move|extract|rename/)) {
                    analysis.refactors.push(clean.trim().substring(0, 80));
                }
            }
            if (line.startsWith('-') && !line.startsWith('---')) {
                analysis.summary.totalDeletions++;
            }
        }
        
        if (fileName === 'package.json' && change.changeType !== 'deleted') {
            try {
                const pkg = JSON.parse(content);
                if (pkg.dependencies) {
                    Object.keys(pkg.dependencies).forEach((d: string) => analysis.packages.add(d));
                }
                if (pkg.devDependencies) {
                    Object.keys(pkg.devDependencies).forEach((d: string) => analysis.packages.add(d));
                }
            } catch (error) {}
        }
        
        const packageChanges = diff.match(/[+-]\s*"(@?[^"]+)":\s*"[^"]+"/g);
        if (packageChanges) {
            packageChanges.forEach((p: string) => {
                const match = p.match(/"(@?[^"]+)"/);
                if (match) {
                    if (p.startsWith('+')) { analysis.dependencies.added.push(match[1]); }
                    if (p.startsWith('-')) { analysis.dependencies.removed.push(match[1]); }
                }
            });
        }
    }
    
    return analysis;
}

function generateAdvancedMessage(analysis: any, changes: any[]): string {
    let type = 'chore';
    let description = '';
    
    const totalFiles = changes.length;
    const newFiles = analysis.summary.newFiles;
    const deletedFiles = analysis.summary.deletedFiles;
    const hasFunctions = analysis.functions.length > 0;
    const hasClasses = analysis.classes.length > 0;
    const hasComponents = analysis.components.length > 0;
    const hasApis = analysis.apis.length > 0;
    const hasModels = analysis.models.length > 0;
    const hasServices = analysis.services.length > 0;
    const hasTests = analysis.tests.length > 0;
    const hasDocs = analysis.docs.length > 0;
    const hasBugfixes = analysis.bugfixes.length > 0;
    const hasFeatures = analysis.features.length > 0;
    const hasRefactors = analysis.refactors.length > 0;
    const hasStyles = analysis.styles.length > 0;
    const hasConfigs = analysis.configs.length > 0;
    const hasUtils = analysis.utils.length > 0;
    const hasPackages = analysis.dependencies.added.length > 0 || analysis.dependencies.removed.length > 0;
    
    if (totalFiles === 1) {
        const change = changes[0];
        const name = path.basename(change.filePath, change.fileExt);
        
        if (change.changeType === 'added' || change.changeType === 'untracked') {
            if (hasComponents) {
                type = 'feat';
                description = `add ${analysis.components[0].name} component`;
            } else if (hasFunctions) {
                type = 'feat';
                description = `add ${analysis.functions[0].name} function`;
            } else if (hasClasses) {
                type = 'feat';
                description = `add ${analysis.classes[0].name} class`;
            } else if (hasApis) {
                type = 'feat';
                description = `add ${name} API endpoint`;
            } else if (hasModels) {
                type = 'feat';
                description = `add ${name} model`;
            } else if (hasServices) {
                type = 'feat';
                description = `add ${name} service`;
            } else if (hasTests) {
                type = 'test';
                description = `add tests for ${name.replace(/\.(test|spec)$/, '')}`;
            } else if (hasDocs) {
                type = 'docs';
                description = `add ${name} documentation`;
            } else if (hasStyles) {
                type = 'style';
                description = `add ${name} styles`;
            } else {
                type = 'feat';
                description = `add ${name}`;
            }
        } else if (change.changeType === 'deleted') {
            type = 'chore';
            description = `remove ${name}`;
        } else {
            if (hasBugfixes) {
                type = 'fix';
                description = `fix ${analysis.bugfixes[0].substring(0, 50)}`;
            } else if (hasRefactors) {
                type = 'refactor';
                description = `refactor ${name}${hasFunctions ? ' - ' + analysis.functions.map((f: any) => f.name).join(', ') : ''}`;
            } else if (hasFunctions) {
                type = 'feat';
                description = `update ${analysis.functions[0].name} in ${name}`;
            } else if (hasFeatures) {
                type = 'feat';
                description = `enhance ${name} functionality`;
            } else if (hasTests) {
                type = 'test';
                description = `update tests for ${name}`;
            } else if (hasDocs) {
                type = 'docs';
                description = `update ${name} documentation`;
            } else if (hasStyles) {
                type = 'style';
                description = `update ${name} styles`;
            } else if (hasConfigs) {
                type = 'chore';
                description = `update ${name} configuration`;
            } else {
                type = 'chore';
                description = `update ${name}`;
            }
        }
    } else {
        const categories: string[] = [];
        if (hasComponents) { categories.push('components'); }
        if (hasApis) { categories.push('API'); }
        if (hasModels) { categories.push('models'); }
        if (hasServices) { categories.push('services'); }
        if (hasTests) { categories.push('tests'); }
        if (hasDocs) { categories.push('docs'); }
        if (hasStyles) { categories.push('styles'); }
        if (hasConfigs) { categories.push('config'); }
        if (hasUtils) { categories.push('utilities'); }
        
        if (hasBugfixes && hasFeatures) {
            type = 'feat';
            description = `add features and fix bugs across ${totalFiles} files`;
        } else if (hasBugfixes) {
            type = 'fix';
            description = `resolve ${analysis.bugfixes.length} issues in ${totalFiles} files`;
        } else if (hasFeatures && hasComponents) {
            type = 'feat';
            const compNames = analysis.components.slice(0, 3).map((c: any) => c.name).join(', ');
            description = `add ${compNames}${analysis.components.length > 3 ? ' and more' : ''} components`;
        } else if (hasRefactors && totalFiles > 2) {
            type = 'refactor';
            description = `restructure ${categories.join(', ')} modules`;
        } else if (newFiles > totalFiles / 2) {
            type = 'feat';
            description = `add ${newFiles} new files with ${categories.length > 0 ? categories.join(', ') : 'multiple'} updates`;
        } else if (deletedFiles > 0 && newFiles === 0) {
            type = 'chore';
            description = `remove ${deletedFiles} files`;
        } else if (hasPackages) {
            type = 'build';
            const added = analysis.dependencies.added.slice(0, 2).join(', ');
            description = `update dependencies${added ? ': add ' + added : ''}`;
        } else if (hasTests && hasDocs && totalFiles === 2) {
            type = 'chore';
            description = `update tests and documentation`;
        } else if (categories.length >= 3) {
            type = 'feat';
            description = `update ${categories.slice(0, 3).join(', ')} across ${totalFiles} files`;
        } else if (categories.length > 0) {
            type = 'refactor';
            description = `restructure ${categories.join(' and ')}`;
        } else {
            type = 'chore';
            description = `update ${totalFiles} files (${analysis.summary.totalAdditions}+ ${analysis.summary.totalDeletions}-)`;
        }
    }
    
    const config = vscode.workspace.getConfiguration('autoCommitMessage');
    const useEmoji = config.get('useEmoji', false);
    
    const emojis: Record<string, string> = {
        feat: '✨', fix: '🐛', docs: '📝', style: '💄', refactor: '♻️',
        perf: '⚡', test: '✅', build: '📦', ci: '👷', chore: '🔧'
    };
    
    let message = useEmoji ? `${emojis[type] || ''} ` : '';
    message += `${type}: ${description}`;
    
    return message;
}

async function showDeepAnalysis(analysis: any, changes: any[]): Promise<void> {
    let report = '# 🔍 Deep Commit Analysis Report\n\n';
    
    report += '## 📊 Summary\n';
    report += `| Metric | Count |\n|--------|-------|\n`;
    report += `| Total Files | ${analysis.summary.totalFiles} |\n`;
    report += `| New Files | ${analysis.summary.newFiles} |\n`;
    report += `| Deleted Files | ${analysis.summary.deletedFiles} |\n`;
    report += `| Modified Files | ${analysis.summary.modifiedFiles} |\n`;
    report += `| Staged | ${analysis.summary.stagedFiles} |\n`;
    report += `| Unstaged | ${analysis.summary.unstagedFiles} |\n`;
    report += `| Additions | +${analysis.summary.totalAdditions} |\n`;
    report += `| Deletions | -${analysis.summary.totalDeletions} |\n\n`;
    
    if (analysis.languages.size > 0) {
        report += '## 💻 Languages\n';
        analysis.languages.forEach((l: string) => { report += `- ${l}\n`; });
        report += '\n';
    }
    
    if (analysis.frameworks.size > 0) {
        report += '## 🏗️ Frameworks\n';
        analysis.frameworks.forEach((f: string) => { report += `- ${f}\n`; });
        report += '\n';
    }
    
    if (analysis.components.length > 0) {
        report += '## 🧩 Components\n';
        analysis.components.forEach((c: any) => { report += `- \`${c.name}\` → ${c.file}\n`; });
        report += '\n';
    }
    
    if (analysis.functions.length > 0) {
        report += '## 🔧 Functions\n';
        analysis.functions.slice(0, 15).forEach((f: any) => { report += `- \`${f.name}()\` → ${f.file}\n`; });
        if (analysis.functions.length > 15) { report += `- ... and ${analysis.functions.length - 15} more\n`; }
        report += '\n';
    }
    
    if (analysis.classes.length > 0) {
        report += '## 📦 Classes\n';
        analysis.classes.forEach((c: any) => { report += `- \`${c.name}\` → ${c.file}\n`; });
        report += '\n';
    }
    
    if (analysis.hooks.length > 0) {
        report += '## 🪝 React Hooks\n';
        analysis.hooks.forEach((h: string) => { report += `- ${h}\n`; });
        report += '\n';
    }
    
    if (analysis.apis.length > 0) {
        report += '## 🌐 API Routes\n';
        analysis.apis.forEach((a: string) => { report += `- ${a}\n`; });
        report += '\n';
    }
    
    if (analysis.models.length > 0) {
        report += '## 📊 Models\n';
        analysis.models.forEach((m: string) => { report += `- ${m}\n`; });
        report += '\n';
    }
    
    if (analysis.services.length > 0) {
        report += '## 🔌 Services\n';
        analysis.services.forEach((s: string) => { report += `- ${s}\n`; });
        report += '\n';
    }
    
    if (analysis.bugfixes.length > 0) {
        report += '## 🐛 Bug Fixes Detected\n';
        analysis.bugfixes.slice(0, 10).forEach((b: string) => { report += `- ${b}\n`; });
        report += '\n';
    }
    
    if (analysis.features.length > 0) {
        report += '## ✨ Features Added\n';
        analysis.features.slice(0, 10).forEach((f: string) => { report += `- ${f}\n`; });
        report += '\n';
    }
    
    if (analysis.dependencies.added.length > 0 || analysis.dependencies.removed.length > 0) {
        report += '## 📦 Dependencies\n';
        if (analysis.dependencies.added.length > 0) {
            report += '### Added\n';
            analysis.dependencies.added.forEach((d: string) => { report += `- ${d}\n`; });
        }
        if (analysis.dependencies.removed.length > 0) {
            report += '### Removed\n';
            analysis.dependencies.removed.forEach((d: string) => { report += `- ${d}\n`; });
        }
        report += '\n';
    }
    
    report += '## 📁 All Changed Files\n';
    changes.forEach((c: any) => {
        const icon = c.staged ? '📌' : '  ';
        report += `- ${icon} \`${c.filePath}\` (${c.changeType})\n`;
    });
    
    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
    await vscode.window.showTextDocument(doc);
}

async function insertMessage(message: string, workspaceRoot: string): Promise<void> {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension && gitExtension.isActive) {
            const api = gitExtension.exports.getAPI(1);
            if (api.repositories) {
                const repo = api.repositories.find((r: any) => r.rootUri.fsPath === workspaceRoot);
                if (repo) {
                    repo.inputBox.value = message;
                    return;
                }
                if (api.repositories.length > 0) {
                    api.repositories[0].inputBox.value = message;
                    return;
                }
            }
        }
    } catch (error) {}
    
    await vscode.env.clipboard.writeText(message);
}

export function deactivate() {}