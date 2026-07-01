import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

interface GitChange {
    file: string;
    status: string;
    oldFile?: string;
    additions: number;
    deletions: number;
}

interface CommitAnalysis {
    type: string;
    emoji: string;
    description: string;
    scope?: string;
    body?: string;
    confidence: number;
}

export function activate(context: vscode.ExtensionContext) {
    const generator = new CommitGenerator();
    
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(git-commit) Generate Commit';
    statusBarItem.tooltip = 'Generate Conventional Commit Message';
    statusBarItem.command = 'auto-commit-message.generateMessage';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();
    
    const outputChannel = vscode.window.createOutputChannel('Auto Commit Message');
    context.subscriptions.push(outputChannel);
    
    outputChannel.appendLine('🚀 Auto Commit Message v1.0.0 activated');
    outputChannel.appendLine('📂 Ready to generate commit messages');
    
    vscode.window.showInformationMessage('✨ Auto Commit Message is ready! Click $(git-commit) in Source Control or status bar.');

    const command = vscode.commands.registerCommand('auto-commit-message.generateMessage', async () => {
        const progressOptions: vscode.ProgressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing changes...',
            cancellable: false
        };

        await vscode.window.withProgress(progressOptions, async (progress) => {
            try {
                progress.report({ increment: 0, message: 'Checking repository...' });
                
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('❌ Please open a workspace folder first.');
                    return;
                }

                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                
                if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
                    vscode.window.showErrorMessage('❌ This workspace is not a Git repository.');
                    return;
                }

                progress.report({ increment: 30, message: 'Fetching changes...' });
                
                const changes = await generator.getChanges(workspaceRoot);
                
                if (changes.length === 0) {
                    vscode.window.showInformationMessage('📝 No changes detected. Make some changes first!');
                    return;
                }

                progress.report({ increment: 60, message: 'Analyzing diff...' });
                
                const diff = await generator.getDiff(workspaceRoot);
                
                progress.report({ increment: 80, message: 'Generating message...' });
                
                const message = generator.generateMessage(changes, diff);
                
                progress.report({ increment: 100, message: 'Inserting message...' });
                
                await generator.insertMessage(message);
                
                outputChannel.appendLine(`✅ Generated: ${message}`);
                outputChannel.show();
                
                const actions = ['Copy to Clipboard', 'Dismiss'];
                if (message.length > 50) {
                    actions.unshift('Show Full Message');
                }
                
                const selection = await vscode.window.showInformationMessage(
                    `✅ ${message.length > 50 ? message.substring(0, 50) + '...' : message}`,
                    ...actions
                );
                
                if (selection === 'Copy to Clipboard') {
                    await vscode.env.clipboard.writeText(message);
                    vscode.window.showInformationMessage('📋 Commit message copied to clipboard!');
                } else if (selection === 'Show Full Message') {
                    const doc = await vscode.workspace.openTextDocument({ content: message });
                    await vscode.window.showTextDocument(doc);
                }
                
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`❌ ${errorMsg}`);
                outputChannel.appendLine(`❌ Error: ${errorMsg}`);
            }
        });
    });

    context.subscriptions.push(command);
}

class CommitGenerator {
    private static readonly TYPES = {
        feat: { emoji: '✨', label: 'Feature', priority: 1 },
        fix: { emoji: '🐛', label: 'Bug Fix', priority: 1 },
        docs: { emoji: '📝', label: 'Documentation', priority: 2 },
        style: { emoji: '💄', label: 'Code Style', priority: 3 },
        refactor: { emoji: '♻️', label: 'Refactor', priority: 2 },
        perf: { emoji: '⚡', label: 'Performance', priority: 2 },
        test: { emoji: '✅', label: 'Tests', priority: 2 },
        build: { emoji: '📦', label: 'Build System', priority: 3 },
        ci: { emoji: '👷', label: 'CI/CD', priority: 3 },
        chore: { emoji: '🔧', label: 'Chore', priority: 4 },
        revert: { emoji: '⏪', label: 'Revert', priority: 1 },
        security: { emoji: '🔒', label: 'Security', priority: 1 }
    };

    private static readonly KEYWORD_MAP: Record<string, string[]> = {
        feat: ['add', 'create', 'implement', 'new', 'feature', 'introduce', 'support', 'enable', 'allow', 'ability'],
        fix: ['fix', 'resolve', 'repair', 'bug', 'issue', 'error', 'problem', 'crash', 'null', 'undefined', 'broken', 'wrong', 'correct', 'patch'],
        docs: ['document', 'readme', 'doc', 'comment', 'guide', 'manual', 'wiki', 'tutorial', 'example', 'usage', 'api'],
        style: ['style', 'format', 'indent', 'whitespace', 'lint', 'prettify', 'beautify', 'spacing', 'alignment', 'cosmetic'],
        refactor: ['refactor', 'restructure', 'simplify', 'clean', 'reorganize', 'move', 'extract', 'rename', 'improve', 'rework'],
        perf: ['performance', 'optimize', 'speed', 'fast', 'cache', 'memory', 'efficient', 'lazy', 'reduce', 'improve'],
        test: ['test', 'spec', 'mock', 'assert', 'jest', 'mocha', 'testing', 'coverage', 'unit', 'e2e', 'integration'],
        build: ['build', 'webpack', 'babel', 'compiler', 'dependency', 'deps', 'bundle', 'package', 'npm', 'yarn', 'gradle', 'maven'],
        ci: ['ci', 'pipeline', 'deploy', 'travis', 'jenkins', 'workflow', 'docker', 'kubernetes', 'automation', 'continuous'],
        chore: ['chore', 'update', 'upgrade', 'bump', 'version', 'release', 'config', 'setting', 'misc', 'maintenance', 'cleanup'],
        security: ['security', 'vulnerability', 'xss', 'csrf', 'injection', 'auth', 'permission', 'encrypt', 'protect', 'secure'],
        revert: ['revert', 'rollback', 'undo', 'backout', 'restore']
    };

    async getChanges(workspaceRoot: string): Promise<GitChange[]> {
        const changes: GitChange[] = [];
        
        try {
            const { stdout: staged } = await execAsync('git diff --cached --name-status', { cwd: workspaceRoot });
            if (staged.trim()) {
                const lines = staged.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    const parts = line.split('\t');
                    if (parts.length >= 2) {
                        changes.push({
                            file: parts[parts.length - 1],
                            status: this.mapStatus(parts[0]),
                            additions: 0,
                            deletions: 0
                        });
                    }
                }
            }

            const { stdout: unstaged } = await execAsync('git diff --name-only', { cwd: workspaceRoot });
            if (unstaged.trim()) {
                const files = unstaged.split('\n').filter(f => f.trim());
                for (const file of files) {
                    if (!changes.find(c => c.file === file)) {
                        changes.push({
                            file,
                            status: 'modified',
                            additions: 0,
                            deletions: 0
                        });
                    }
                }
            }

            const { stdout: untracked } = await execAsync('git ls-files --others --exclude-standard', { cwd: workspaceRoot });
            if (untracked.trim()) {
                const files = untracked.split('\n').filter(f => f.trim());
                for (const file of files) {
                    changes.push({
                        file,
                        status: 'added',
                        additions: 0,
                        deletions: 0
                    });
                }
            }

            const { stdout: stats } = await execAsync('git diff --stat', { cwd: workspaceRoot });
            if (stats.trim()) {
                const lines = stats.split('\n');
                for (const line of lines) {
                    const match = line.match(/(.+?)\s+\|\s+(\d+)\s+([+-]+)/);
                    if (match) {
                        const filename = match[1].trim();
                        const change = changes.find(c => c.file === filename);
                        if (change) {
                            const plusCount = (match[3].match(/\+/g) || []).length;
                            const minusCount = (match[3].match(/-/g) || []).length;
                            change.additions = plusCount;
                            change.deletions = minusCount;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error getting changes:', error);
        }
        
        return changes;
    }

    private mapStatus(statusCode: string): string {
        if (statusCode.startsWith('A')) return 'added';
        if (statusCode.startsWith('D')) return 'deleted';
        if (statusCode.startsWith('R')) return 'renamed';
        if (statusCode.startsWith('M')) return 'modified';
        if (statusCode.startsWith('?')) return 'added';
        return 'modified';
    }

    async getDiff(workspaceRoot: string): Promise<string> {
        try {
            const { stdout: stagedDiff } = await execAsync('git diff --cached', { cwd: workspaceRoot });
            if (stagedDiff.trim()) return stagedDiff;
            
            const { stdout: unstagedDiff } = await execAsync('git diff', { cwd: workspaceRoot });
            return unstagedDiff;
        } catch (error) {
            return '';
        }
    }

    generateMessage(changes: GitChange[], diff: string): string {
        const keywords = this.extractKeywords(changes, diff);
        const type = this.determineType(changes, keywords);
        const description = this.createDescription(changes, type);
        const scope = this.detectScope(changes);
        const config = vscode.workspace.getConfiguration('autoCommitMessage');
        const useEmoji = config.get('useEmoji', false);
        const maxLength = config.get('maxLength', 72);
        
        let message = '';
        if (useEmoji) {
            message += `${CommitGenerator.TYPES[type as keyof typeof CommitGenerator.TYPES].emoji} `;
        }
        
        message += type;
        
        if (scope) {
            message += `(${scope})`;
        }
        
        message += `: ${description}`;
        
        if (message.length > maxLength) {
            message = message.substring(0, maxLength - 3) + '...';
        }
        
        return message;
    }

    private extractKeywords(changes: GitChange[], diff: string): Set<string> {
        const keywords = new Set<string>();
        
        for (const change of changes) {
            const parts = change.file.toLowerCase().split(/[\/\\\-_.]/);
            parts.forEach(p => {
                if (p.length > 2) keywords.add(p);
            });
            
            const ext = path.extname(change.file).toLowerCase();
            if (ext) keywords.add(ext.replace('.', ''));
            
            if (change.status === 'added') {
                keywords.add('add');
                keywords.add('new');
            }
            if (change.status === 'deleted') {
                keywords.add('remove');
                keywords.add('delete');
            }
        }
        
        if (diff) {
            const words = diff.toLowerCase().split(/\W+/);
            words.forEach(w => {
                if (w.length > 3) keywords.add(w);
            });
        }
        
        return keywords;
    }

    private determineType(changes: GitChange[], keywords: Set<string>): string {
        const scores: Record<string, number> = {};
        
        for (const [type, typeKeywords] of Object.entries(CommitGenerator.KEYWORD_MAP)) {
            scores[type] = 0;
            
            for (const keyword of keywords) {
                if (typeKeywords.includes(keyword)) {
                    scores[type] += 3;
                }
            }
            
            for (const change of changes) {
                const file = change.file.toLowerCase();
                if (type === 'docs' && (file.includes('readme') || file.includes('docs/') || /\.(md|txt|rst)$/.test(file))) {
                    scores[type] += 5;
                }
                if (type === 'test' && (file.includes('test') || file.includes('spec') || file.includes('__tests__'))) {
                    scores[type] += 5;
                }
                if (type === 'style' && /\.(css|scss|less|styl)$/.test(file)) {
                    scores[type] += 5;
                }
                if (type === 'build' && (file.includes('package.json') || file.includes('webpack') || file.includes('docker'))) {
                    scores[type] += 5;
                }
                if (type === 'ci' && (file.includes('.github/') || file.includes('.gitlab-ci'))) {
                    scores[type] += 5;
                }
            }
            
            scores[type] += (Object.keys(CommitGenerator.KEYWORD_MAP).length - CommitGenerator.TYPES[type as keyof typeof CommitGenerator.TYPES].priority) * 2;
        }
        
        let bestType = 'chore';
        let bestScore = 0;
        
        for (const [type, score] of Object.entries(scores)) {
            if (score > bestScore) {
                bestScore = score;
                bestType = type;
            }
        }
        
        return bestType;
    }

    private createDescription(changes: GitChange[], type: string): string {
        if (changes.length === 0) return 'update files';
        
        if (changes.length === 1) {
            const change = changes[0];
            const name = path.basename(change.file, path.extname(change.file));
            
            switch (change.status) {
                case 'added': return `add ${name}`;
                case 'deleted': return `remove ${name}`;
                case 'renamed': return change.oldFile ? `rename ${path.basename(change.oldFile)} to ${name}` : `rename ${name}`;
                default: return `${type === 'fix' ? 'fix' : 'update'} ${name}`;
            }
        }
        
        const commonDir = this.findCommonDirectory(changes.map(c => c.file));
        if (commonDir && commonDir.length > 2 && !['src', 'lib', 'dist', 'build', '.', 'public', 'assets'].includes(commonDir)) {
            const action = changes.some(c => c.status === 'added') ? 'add' : 'update';
            return `${action} ${commonDir}`;
        }
        
        const extensions = changes.map(c => path.extname(c.file)).filter(e => e);
        if (extensions.length > 0) {
            const extCounts: Record<string, number> = {};
            extensions.forEach(e => { extCounts[e] = (extCounts[e] || 0) + 1; });
            const mostCommon = Object.entries(extCounts).sort((a, b) => b[1] - a[1])[0][0];
            const action = changes.some(c => c.status === 'added') ? 'add' : 'update';
            return `${action} ${mostCommon.replace('.', '')} files`;
        }
        
        return `${changes.some(c => c.status === 'added') ? 'add' : 'update'} ${changes.length} files`;
    }

    private findCommonDirectory(paths: string[]): string | null {
        if (paths.length < 2) return null;
        
        const dirs = paths.map(p => path.dirname(p));
        const first = dirs[0].split(/[\/\\]/).filter(p => p);
        const result: string[] = [];
        
        for (let i = 0; i < first.length; i++) {
            if (dirs.every(d => d.split(/[\/\\]/).filter(p => p)[i] === first[i])) {
                result.push(first[i]);
            } else {
                break;
            }
        }
        
        return result.length > 0 ? result[result.length - 1] : null;
    }

    private detectScope(changes: GitChange[]): string | undefined {
        if (changes.length === 0) return undefined;
        
        const config = vscode.workspace.getConfiguration('autoCommitMessage');
        if (!config.get('includeScope', false)) return undefined;
        
        const dirs = changes.map(c => {
            const parts = path.dirname(c.file).split(/[\/\\]/).filter(p => p);
            return parts.length > 0 ? parts[0] : '';
        });
        
        const uniqueDirs = [...new Set(dirs)].filter(d => d && d.length > 2 && !['src', 'lib', 'dist', 'build', 'public', 'assets', '.'].includes(d));
        
        if (uniqueDirs.length === 1) {
            return uniqueDirs[0];
        }
        
        return undefined;
    }

    async insertMessage(message: string): Promise<void> {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (gitExtension && gitExtension.isActive) {
                const api = gitExtension.exports.getAPI(1);
                if (api.repositories && api.repositories.length > 0) {
                    const repo = api.repositories[0];
                    repo.inputBox.value = message;
                    return;
                }
            }
        } catch (error) {
            console.warn('Git API method failed, using clipboard fallback');
        }
        
        await vscode.env.clipboard.writeText(message);
        vscode.window.showInformationMessage('📋 Message copied to clipboard. Paste it in the commit box.');
    }
}

export function deactivate() {}