import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

interface GitChange {
    file: string;
    status: string;
    additions: number;
    deletions: number;
}

export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('Auto Commit Message');
    context.subscriptions.push(outputChannel);
    
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = '$(sparkle) Generate Commit Message';
    statusBarItem.tooltip = 'Analyze changes and generate descriptive commit message';
    statusBarItem.command = 'auto-commit-message.generateMessage';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    context.subscriptions.push(statusBarItem);
    statusBarItem.show();

    const command = vscode.commands.registerCommand('auto-commit-message.generateMessage', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing changes...',
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 0, message: '🔍 Scanning repository...' });
                
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    vscode.window.showErrorMessage('❌ Please open a workspace folder first.');
                    return;
                }

                const workspaceRoot = workspaceFolders[0].uri.fsPath;
                
                if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
                    vscode.window.showErrorMessage('❌ This is not a Git repository.');
                    return;
                }

                progress.report({ increment: 20, message: '📂 Finding changed files...' });
                
                const changes = await getAllChanges(workspaceRoot);
                
                if (changes.length === 0) {
                    vscode.window.showInformationMessage('📝 No changes detected. Make some changes first!');
                    return;
                }

                progress.report({ increment: 40, message: '📊 Analyzing file contents...' });
                
                const fullDiff = await getFullDiff(workspaceRoot);
                
                progress.report({ increment: 60, message: '🧠 Understanding changes...' });
                
                const analysis = await analyzeAllChanges(workspaceRoot, changes, fullDiff);
                
                progress.report({ increment: 80, message: '✍️ Crafting message...' });
                
                const message = await craftDetailedMessage(analysis, changes);
                
                progress.report({ increment: 95, message: '📝 Inserting message...' });
                
                await insertMessage(message);
                
                outputChannel.appendLine(`✅ Generated: ${message}`);
                outputChannel.show();
                
                const selection = await vscode.window.showInformationMessage(
                    message,
                    { modal: false },
                    '📋 Copy',
                    '🔄 Regenerate',
                    '📊 Show Analysis'
                );
                
                if (selection === '📋 Copy') {
                    await vscode.env.clipboard.writeText(message);
                    vscode.window.showInformationMessage('📋 Copied to clipboard!');
                } else if (selection === '🔄 Regenerate') {
                    vscode.commands.executeCommand('auto-commit-message.generateMessage');
                } else if (selection === '📊 Show Analysis') {
                    showDetailedAnalysis(analysis);
                }
                
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                vscode.window.showErrorMessage(`❌ ${msg}`);
            }
        });
    });

    context.subscriptions.push(command);
}

async function getAllChanges(workspaceRoot: string): Promise<GitChange[]> {
    const changes: GitChange[] = [];
    
    try {
        const { stdout: status } = await execAsync('git status --porcelain', { cwd: workspaceRoot });
        if (!status.trim()) return changes;
        
        const lines = status.split('\n').filter(l => l.trim());
        
        for (const line of lines) {
            const statusCode = line.substring(0, 2).trim();
            const file = line.substring(3).trim();
            
            let changeStatus = 'modified';
            if (statusCode === '??' || statusCode === 'A') changeStatus = 'added';
            else if (statusCode === 'D') changeStatus = 'deleted';
            else if (statusCode.startsWith('R')) changeStatus = 'renamed';
            else if (statusCode.includes('M')) changeStatus = 'modified';
            
            changes.push({
                file,
                status: changeStatus,
                additions: 0,
                deletions: 0
            });
        }
    } catch (error) {}
    
    return changes;
}

async function getFullDiff(workspaceRoot: string): Promise<string> {
    try {
        const { stdout: staged } = await execAsync('git diff --cached -p', { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        const { stdout: unstaged } = await execAsync('git diff -p', { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 });
        return (staged + '\n' + unstaged).trim();
    } catch (error) {
        return '';
    }
}

async function analyzeAllChanges(workspaceRoot: string, changes: GitChange[], diff: string): Promise<any> {
    const fileAnalyses: any[] = [];
    const allFunctions: string[] = [];
    const allClasses: string[] = [];
    const allImports: string[] = [];
    const bugFixes: string[] = [];
    const features: string[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;
    
    const diffLines = diff.split('\n');
    let currentFile = '';
    let fileAdditions = 0;
    let fileDeletions = 0;
    let fileFunctions: string[] = [];
    let fileClasses: string[] = [];
    
    for (const line of diffLines) {
        if (line.startsWith('diff --git')) {
            if (currentFile) {
                fileAnalyses.push({
                    file: currentFile,
                    additions: fileAdditions,
                    deletions: fileDeletions,
                    functions: [...new Set(fileFunctions)],
                    classes: [...new Set(fileClasses)]
                });
            }
            
            const match = line.match(/diff --git a\/(.*) b\/(.*)/);
            currentFile = match ? match[2] : '';
            fileAdditions = 0;
            fileDeletions = 0;
            fileFunctions = [];
            fileClasses = [];
            continue;
        }
        
        if (line.startsWith('+') && !line.startsWith('+++')) {
            fileAdditions++;
            totalAdditions++;
            
            const clean = line.substring(1).trim();
            
            const funcMatch = clean.match(/(?:function|const|let|var)\s+(\w+)/);
            if (funcMatch && funcMatch[1].length > 2) {
                fileFunctions.push(funcMatch[1]);
                allFunctions.push(funcMatch[1]);
            }
            
            const classMatch = clean.match(/class\s+(\w+)/);
            if (classMatch) {
                fileClasses.push(classMatch[1]);
                allClasses.push(classMatch[1]);
            }
            
            const arrowMatch = clean.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
            if (arrowMatch && arrowMatch[1].length > 2) {
                fileFunctions.push(arrowMatch[1]);
                allFunctions.push(arrowMatch[1]);
            }
            
            const importMatch = clean.match(/import\s+.*?from\s+['"](.+?)['"]/);
            if (importMatch) {
                allImports.push(importMatch[1]);
            }
            
            const bugKeywords = ['fix', 'bug', 'issue', 'error', 'crash', 'null', 'undefined', 'broken', 'resolve', 'patch', 'correct', 'repair'];
            for (const kw of bugKeywords) {
                if (clean.toLowerCase().includes(kw)) {
                    bugFixes.push(kw);
                    break;
                }
            }
            
            const featureKeywords = ['add', 'create', 'new', 'feature', 'implement', 'introduce', 'support', 'enable'];
            for (const kw of featureKeywords) {
                if (clean.toLowerCase().includes(kw)) {
                    features.push(kw);
                    break;
                }
            }
        }
        
        if (line.startsWith('-') && !line.startsWith('---')) {
            fileDeletions++;
            totalDeletions++;
        }
    }
    
    if (currentFile) {
        fileAnalyses.push({
            file: currentFile,
            additions: fileAdditions,
            deletions: fileDeletions,
            functions: [...new Set(fileFunctions)],
            classes: [...new Set(fileClasses)]
        });
    }
    
    return {
        fileAnalyses,
        allFunctions: [...new Set(allFunctions)],
        allClasses: [...new Set(allClasses)],
        allImports: [...new Set(allImports)],
        bugFixes: [...new Set(bugFixes)],
        features: [...new Set(features)],
        totalAdditions,
        totalDeletions,
        totalFiles: changes.length
    };
}

async function craftDetailedMessage(analysis: any, changes: GitChange[]): Promise<string> {
    let type = 'chore';
    let description = '';
    const details: string[] = [];
    
    const hasNew = changes.some(c => c.status === 'added');
    const hasDeleted = changes.some(c => c.status === 'deleted');
    const hasModified = changes.some(c => c.status === 'modified');
    const hasFunctions = analysis.allFunctions.length > 0;
    const hasClasses = analysis.allClasses.length > 0;
    const hasBugFixes = analysis.bugFixes.length > 0;
    const hasFeatures = analysis.features.length > 0;
    const hasImports = analysis.allImports.length > 0;
    
    const fileTypes = changes.map(c => path.extname(c.file)).filter(Boolean);
    const uniqueTypes = [...new Set(fileTypes)];
    
    if (changes.length === 1) {
        const change = changes[0];
        const fileName = path.basename(change.file, path.extname(change.file));
        const ext = path.extname(change.file);
        
        if (change.status === 'added') {
            if (ext === '.md' || ext === '.txt') {
                type = 'docs';
                description = `add ${fileName} documentation`;
            } else if (fileName.toLowerCase().includes('test') || fileName.toLowerCase().includes('spec')) {
                type = 'test';
                description = `add tests for ${fileName.replace(/\.(test|spec)$/, '')}`;
            } else if (hasClasses) {
                type = 'feat';
                description = `add ${analysis.allClasses[0]} component`;
            } else if (hasFunctions) {
                type = 'feat';
                description = `add ${analysis.allFunctions[0]} functionality`;
            } else {
                type = 'feat';
                description = `add ${fileName}`;
            }
        } else if (change.status === 'deleted') {
            type = 'chore';
            description = `remove ${fileName}`;
        } else {
            if (hasBugFixes) {
                type = 'fix';
                description = `fix ${analysis.bugFixes[0]} issue in ${fileName}`;
            } else if (hasFunctions) {
                type = 'feat';
                description = `update ${analysis.allFunctions[0]} in ${fileName}`;
            } else if (hasClasses) {
                type = 'refactor';
                description = `refactor ${analysis.allClasses[0]} in ${fileName}`;
            } else if (ext === '.md' || ext === '.txt') {
                type = 'docs';
                description = `update ${fileName} documentation`;
            } else if (ext === '.css' || ext === '.scss' || ext === '.less') {
                type = 'style';
                description = `update styles in ${fileName}`;
            } else {
                type = 'chore';
                description = `update ${fileName}`;
            }
        }
    } else {
        if (hasBugFixes && hasFeatures) {
            type = 'feat';
            description = `add features and fix issues across ${changes.length} files`;
        } else if (hasBugFixes) {
            type = 'fix';
            const bugDesc = analysis.bugFixes.slice(0, 2).join(', ');
            description = `resolve ${bugDesc} issues in multiple files`;
        } else if (hasClasses) {
            type = 'feat';
            const classNames = analysis.allClasses.slice(0, 3).join(', ');
            description = `add ${classNames}${analysis.allClasses.length > 3 ? ' and more' : ''} components`;
        } else if (hasFunctions) {
            type = 'feat';
            const funcNames = analysis.allFunctions.slice(0, 3).join(', ');
            description = `implement ${funcNames}${analysis.allFunctions.length > 3 ? ' and more' : ''} functionality`;
        } else if (hasImports && hasNew) {
            type = 'feat';
            description = `integrate ${analysis.allImports.slice(0, 2).join(', ')} dependencies`;
        } else if (hasNew) {
            type = 'feat';
            const newFiles = changes.filter(c => c.status === 'added').map(c => path.basename(c.file, path.extname(c.file)));
            description = `add ${newFiles.slice(0, 3).join(', ')}${newFiles.length > 3 ? ' and more' : ''}`;
        } else if (hasDeleted) {
            type = 'chore';
            description = `remove ${changes.filter(c => c.status === 'deleted').length} files`;
        } else if (uniqueTypes.length === 1 && uniqueTypes[0] === '.md') {
            type = 'docs';
            description = `update documentation across ${changes.length} files`;
        } else if (analysis.totalAdditions > 50) {
            type = 'feat';
            description = `implement major changes (${analysis.totalAdditions} additions, ${analysis.totalDeletions} deletions)`;
        } else {
            const commonDir = findCommonDir(changes.map(c => c.file));
            if (commonDir) {
                type = 'refactor';
                description = `restructure ${commonDir} module`;
            } else {
                type = 'chore';
                description = `update ${changes.length} files with ${analysis.totalAdditions} additions and ${analysis.totalDeletions} deletions`;
            }
        }
    }
    
    const config = vscode.workspace.getConfiguration('autoCommitMessage');
    const useEmoji = config.get('useEmoji', false);
    const maxLength = config.get('maxLength', 72);
    
    const emojis: Record<string, string> = {
        feat: '✨',
        fix: '🐛',
        docs: '📝',
        style: '💄',
        refactor: '♻️',
        perf: '⚡',
        test: '✅',
        build: '📦',
        ci: '👷',
        chore: '🔧',
        revert: '⏪',
        security: '🔒'
    };
    
    let message = useEmoji ? `${emojis[type] || ''} ` : '';
    message += `${type}: ${description}`;
    
    if (message.length > maxLength) {
        message = message.substring(0, maxLength - 3) + '...';
    }
    
    return message;
}

function findCommonDir(paths: string[]): string | null {
    if (paths.length < 2) return null;
    const dirs = paths.map(p => path.dirname(p).split(/[\/\\]/).filter(Boolean));
    const minLen = Math.min(...dirs.map(d => d.length));
    const common: string[] = [];
    
    for (let i = 0; i < minLen; i++) {
        if (dirs.every(d => d[i] === dirs[0][i])) {
            common.push(dirs[0][i]);
        } else {
            break;
        }
    }
    
    return common.length > 0 ? common[common.length - 1] : null;
}

async function showDetailedAnalysis(analysis: any): Promise<void> {
    let content = '# 📊 Commit Analysis Report\n\n';
    content += `## 📈 Summary\n`;
    content += `- **Files Changed:** ${analysis.totalFiles}\n`;
    content += `- **Total Additions:** +${analysis.totalAdditions}\n`;
    content += `- **Total Deletions:** -${analysis.totalDeletions}\n`;
    
    if (analysis.allFunctions.length > 0) {
        content += `\n## 🔧 Functions Changed\n`;
        analysis.allFunctions.slice(0, 10).forEach((f: string) => {
            content += `- \`${f}()\`\n`;
        });
    }
    
    if (analysis.allClasses.length > 0) {
        content += `\n## 📦 Classes Changed\n`;
        analysis.allClasses.forEach((c: string) => {
            content += `- \`${c}\`\n`;
        });
    }
    
    if (analysis.bugFixes.length > 0) {
        content += `\n## 🐛 Bug Fixes Detected\n`;
        analysis.bugFixes.forEach((b: string) => {
            content += `- ${b}\n`;
        });
    }
    
    if (analysis.allImports.length > 0) {
        content += `\n## 📥 New Dependencies\n`;
        analysis.allImports.slice(0, 10).forEach((i: string) => {
            content += `- ${i}\n`;
        });
    }
    
    content += `\n## 📁 Files Changed\n`;
    analysis.fileAnalyses.forEach((fa: any) => {
        content += `\n### ${fa.file}\n`;
        content += `- Additions: +${fa.additions}, Deletions: -${fa.deletions}\n`;
        if (fa.functions.length > 0) {
            content += `- Functions: ${fa.functions.join(', ')}\n`;
        }
        if (fa.classes.length > 0) {
            content += `- Classes: ${fa.classes.join(', ')}\n`;
        }
    });
    
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    await vscode.window.showTextDocument(doc);
}

async function insertMessage(message: string): Promise<void> {
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (gitExtension && gitExtension.isActive) {
            const api = gitExtension.exports.getAPI(1);
            if (api.repositories && api.repositories.length > 0) {
                api.repositories[0].inputBox.value = message;
                return;
            }
        }
    } catch (error) {}
    
    await vscode.env.clipboard.writeText(message);
    vscode.window.showInformationMessage('📋 Message copied to clipboard!');
}

export function deactivate() {}