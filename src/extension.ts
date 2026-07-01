import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';

const exec = promisify(cp.exec);

// Commit type definitions with keywords and emojis
interface CommitType {
    type: string;
    description: string;
    keywords: string[];
    emoji: string;
    priority: number;
}

const COMMIT_TYPES: CommitType[] = [
    {
        type: 'feat',
        description: 'A new feature',
        keywords: ['add', 'create', 'implement', 'new', 'feature', 'introduce', 'support'],
        emoji: '✨',
        priority: 1
    },
    {
        type: 'fix',
        description: 'A bug fix',
        keywords: ['fix', 'resolve', 'repair', 'bug', 'issue', 'error', 'problem', 'crash', 'null', 'undefined'],
        emoji: '🐛',
        priority: 1
    },
    {
        type: 'docs',
        description: 'Documentation changes',
        keywords: ['document', 'readme', 'doc', 'comment', 'guide', 'manual', 'wiki'],
        emoji: '📝',
        priority: 2
    },
    {
        type: 'style',
        description: 'Code style changes',
        keywords: ['style', 'format', 'indent', 'whitespace', 'lint', 'prettify', 'beautify'],
        emoji: '💄',
        priority: 3
    },
    {
        type: 'refactor',
        description: 'Code refactoring',
        keywords: ['refactor', 'restructure', 'simplify', 'clean', 'reorganize', 'move', 'extract', 'rename'],
        emoji: '♻️',
        priority: 2
    },
    {
        type: 'perf',
        description: 'Performance improvements',
        keywords: ['performance', 'optimize', 'speed', 'fast', 'improve', 'enhance', 'efficient'],
        emoji: '⚡',
        priority: 2
    },
    {
        type: 'test',
        description: 'Adding or modifying tests',
        keywords: ['test', 'spec', 'mock', 'assert', 'jest', 'mocha', 'testing', 'coverage'],
        emoji: '✅',
        priority: 2
    },
    {
        type: 'build',
        description: 'Build system changes',
        keywords: ['build', 'webpack', 'babel', 'compiler', 'dependency', 'deps', 'bundle', 'package'],
        emoji: '📦',
        priority: 3
    },
    {
        type: 'ci',
        description: 'CI/CD changes',
        keywords: ['ci', 'pipeline', 'deploy', 'travis', 'jenkins', 'github action', 'workflow', 'docker'],
        emoji: '👷',
        priority: 3
    },
    {
        type: 'chore',
        description: 'Other changes',
        keywords: ['chore', 'update', 'upgrade', 'bump', 'version', 'release', 'config', 'setting', 'misc'],
        emoji: '🔧',
        priority: 4
    },
    {
        type: 'revert',
        description: 'Revert changes',
        keywords: ['revert', 'rollback', 'undo', 'backout'],
        emoji: '⏪',
        priority: 1
    }
];

interface FileChange {
    filePath: string;
    status: string;
    additions: number;
    deletions: number;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Auto Commit Message extension is now active');

    const disposable = vscode.commands.registerCommand(
        'auto-commit-message.generateMessage',
        async () => {
            try {
                await generateAndInsertCommitMessage();
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Auto Commit: ${errorMessage}`);
                console.error('Auto Commit Message error:', error);
            }
        }
    );

    context.subscriptions.push(disposable);
}

async function generateAndInsertCommitMessage(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    
    if (!workspaceFolders || workspaceFolders.length === 0) {
        throw new Error('No workspace folder is open.');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    
    // Check if this is a git repository
    if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
        throw new Error('The workspace is not a Git repository.');
    }

    // Get staged changes first, fall back to unstaged changes
    let diff: string;
    let hasStagedChanges = true;
    
    try {
        diff = await executeGitCommand(workspaceRoot, 'git diff --staged --unified=5');
        if (!diff.trim()) {
            diff = await executeGitCommand(workspaceRoot, 'git diff --unified=5');
            hasStagedChanges = false;
        }
    } catch (error) {
        throw new Error('Failed to get git diff. Make sure git is installed and available in PATH.');
    }

    if (!diff.trim()) {
        vscode.window.showInformationMessage('No changes to generate a commit message.');
        return;
    }

    // Parse the diff to extract meaningful information
    const changes = parseGitDiff(diff);
    const message = generateCommitMessage(changes, diff, hasStagedChanges);
    
    // Insert the message into the SCM input box
    await insertIntoSCMInput(message);
    
    vscode.window.showInformationMessage(`Commit message generated: "${message}"`);
}

async function executeGitCommand(cwd: string, command: string): Promise<string> {
    try {
        const { stdout, stderr } = await exec(command, { cwd });
        
        if (stderr && !stderr.includes('warning:')) {
            console.warn('Git command warning:', stderr);
        }
        
        return stdout;
    } catch (error: any) {
        if (error.stderr) {
            throw new Error(error.stderr.trim());
        }
        throw error;
    }
}

function parseGitDiff(diff: string): FileChange[] {
    const changes: FileChange[] = [];
    const lines = diff.split('\n');
    let currentFile: FileChange | null = null;
    let currentAdditions = 0;
    let currentDeletions = 0;

    for (const line of lines) {
        // Detect file changes
        if (line.startsWith('diff --git')) {
            // Save previous file
            if (currentFile) {
                currentFile.additions = currentAdditions;
                currentFile.deletions = currentDeletions;
                changes.push(currentFile);
            }
            
            // Reset for new file
            const match = line.match(/diff --git a\/(.*?) b\/(.*)/);
            if (match) {
                currentFile = {
                    filePath: match[2] || match[1],
                    status: 'modified',
                    additions: 0,
                    deletions: 0
                };
                currentAdditions = 0;
                currentDeletions = 0;
            }
        } else if (line.startsWith('new file')) {
            if (currentFile) {
                currentFile.status = 'added';
            }
        } else if (line.startsWith('deleted file')) {
            if (currentFile) {
                currentFile.status = 'deleted';
            }
        } else if (line.startsWith('rename')) {
            if (currentFile) {
                currentFile.status = 'renamed';
            }
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            currentAdditions++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            currentDeletions++;
        }
    }

    // Save last file
    if (currentFile) {
        currentFile.additions = currentAdditions;
        currentFile.deletions = currentDeletions;
        changes.push(currentFile);
    }

    return changes;
}

function generateCommitMessage(
    changes: FileChange[],
    diff: string,
    hasStagedChanges: boolean
): string {
    const config = vscode.workspace.getConfiguration('autoCommitMessage');
    const useEmoji = config.get<boolean>('useEmoji', false);
    const maxLength = config.get<number>('maxLength', 72);
    const includeScope = config.get<boolean>('includeScope', false);

    if (changes.length === 0) {
        return 'chore: update files';
    }

    // Analyze changes to determine the primary type and description
    const analysis = analyzeChanges(changes, diff);
    
    // Build the commit message
    let message = analysis.type;
    
    // Add scope if applicable
    if (includeScope && analysis.scope) {
        message += `(${analysis.scope})`;
    }
    
    message += `: ${analysis.description}`;
    
    // Add emoji if configured
    if (useEmoji && analysis.emoji) {
        message = `${analysis.emoji} ${message}`;
    }
    
    // Truncate if too long
    if (message.length > maxLength) {
        message = message.substring(0, maxLength - 3) + '...';
    }
    
    return message;
}

function analyzeChanges(changes: FileChange[], diff: string): {
    type: string;
    scope: string | null;
    description: string;
    emoji: string;
} {
    // Collect all meaningful words from the diff
    const keywords = extractKeywords(changes, diff);
    const filePatterns = analyzeFilePatterns(changes);
    
    // Determine the most likely commit type
    const scoredTypes = COMMIT_TYPES.map(commitType => {
        let score = 0;
        
        // Score based on keyword matches
        for (const keyword of commitType.keywords) {
            if (keywords.has(keyword.toLowerCase())) {
                score += 2;
            }
        }
        
        // Score based on file patterns
        score += filePatterns.scoreForType(commitType.type);
        
        // Adjust by priority (lower priority number = more specific)
        const priorityFactor = (COMMIT_TYPES.length - commitType.priority) * 0.5;
        score += priorityFactor;
        
        return { commitType, score };
    });
    
    // Sort by score descending
    scoredTypes.sort((a, b) => b.score - a.score);
    
    const bestMatch = scoredTypes[0].commitType;
    
    // Generate description based on changes
    const description = generateDescription(changes, keywords, bestMatch.type);
    
    // Try to detect scope from file paths
    const scope = detectScope(changes);
    
    return {
        type: bestMatch.type,
        scope,
        description,
        emoji: bestMatch.emoji
    };
}

function extractKeywords(changes: FileChange[], diff: string): Set<string> {
    const keywords = new Set<string>();
    const contentWords = new Set<string>();
    
    // Extract words from file paths
    for (const change of changes) {
        const pathParts = change.filePath.toLowerCase().split(/[\/\\\-_.]/);
        for (const part of pathParts) {
            if (part.length > 2) {
                keywords.add(part);
                contentWords.add(part);
            }
        }
        
        // Add status-based keywords
        switch (change.status) {
            case 'added':
                keywords.add('add');
                keywords.add('new');
                break;
            case 'deleted':
                keywords.add('remove');
                keywords.add('delete');
                break;
            case 'renamed':
                keywords.add('rename');
                keywords.add('move');
                break;
        }
    }
    
    // Extract words from the diff content (lines that were added)
    const addedLines = diff.split('\n')
        .filter(line => line.startsWith('+') && !line.startsWith('+++'))
        .map(line => line.substring(1).trim())
        .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('#'));
    
    // Common programming keywords to look for
    const codeKeywords = [
        'function', 'class', 'method', 'variable', 'import', 'export',
        'return', 'async', 'await', 'const', 'let', 'var', 'type',
        'interface', 'enum', 'component', 'module', 'service', 'util',
        'api', 'route', 'controller', 'model', 'view', 'style',
        'button', 'input', 'form', 'page', 'layout', 'header', 'footer',
        'login', 'auth', 'user', 'data', 'config', 'error', 'log',
        'validate', 'parse', 'format', 'convert', 'transform', 'merge'
    ];
    
    for (const line of addedLines) {
        const words = line.split(/[\s\-_.{}()[\];:'",<>/\\|`~!@#$%^&*+=]+/);
        for (const word of words) {
            const lower = word.toLowerCase();
            if (lower.length > 2 && codeKeywords.includes(lower)) {
                keywords.add(lower);
            }
            if (word.match(/^[A-Z][a-z]+/)) {
                keywords.add(lower);
                contentWords.add(lower);
            }
        }
    }
    
    return keywords;
}

function analyzeFilePatterns(changes: FileChange[]): {
    scoreForType: (type: string) => number;
} {
    let docScore = 0;
    let testScore = 0;
    let styleScore = 0;
    let buildScore = 0;
    let ciScore = 0;
    
    for (const change of changes) {
        const path = change.filePath.toLowerCase();
        
        // Documentation patterns
        if (path.match(/\.(md|txt|rst|adoc)$/) || 
            path.includes('readme') || 
            path.includes('docs/') ||
            path.includes('documentation/')) {
            docScore += 3;
        }
        
        // Test patterns
        if (path.includes('test') || 
            path.includes('spec') || 
            path.match(/\.(test|spec)\.(ts|js|jsx|tsx|py|java|go)$/)) {
            testScore += 3;
        }
        
        // Style patterns
        if (path.match(/\.(css|scss|sass|less|styl)$/) ||
            path.includes('.style') ||
            path.includes('theme')) {
            styleScore += 2;
        }
        
        // Build patterns
        if (path.match(/(package\.json|yarn\.lock|package-lock\.json|pom\.xml|build\.gradle|Cargo\.toml)$/) ||
            path.match(/\.(config|rc)\.(js|ts|json|yaml|yml)$/) ||
            path.includes('webpack') || path.includes('babel')) {
            buildScore += 3;
        }
        
        // CI patterns
        if (path.includes('.github/') ||
            path.includes('.gitlab/') ||
            path.includes('jenkins') ||
            path.includes('docker') ||
            path.match(/^(Dockerfile|docker-compose\.yml|\.travis\.yml|\.drone\.yml)$/)) {
            ciScore += 3;
        }
    }
    
    return {
        scoreForType: (type: string): number => {
            switch (type) {
                case 'docs': return docScore;
                case 'test': return testScore;
                case 'style': return styleScore;
                case 'build': return buildScore;
                case 'ci': return ciScore;
                default: return 0;
            }
        }
    };
}

function generateDescription(
    changes: FileChange[],
    keywords: Set<string>,
    type: string
): string {
    // Generate a description based on the type and changes
    const fileNames = changes.map(c => path.basename(c.filePath, path.extname(c.filePath)));
    const meaningfulKeywords = Array.from(keywords).filter(k => 
        k.length > 3 && !['this', 'that', 'with', 'from', 'have', 'been', 'were'].includes(k)
    );
    
    // Try to create a meaningful description
    if (changes.length === 1) {
        const change = changes[0];
        const fileName = path.basename(change.filePath);
        const action = getActionForStatus(change.status, type);
        
        switch (type) {
            case 'feat':
                return `${action} ${fileName.split('.')[0]}`;
            case 'fix':
                return `${action} in ${fileName.split('.')[0]}`;
            case 'docs':
                return `${action} ${fileName}`;
            case 'style':
                return `format ${fileName}`;
            case 'refactor':
                return `refactor ${fileName.split('.')[0]}`;
            case 'test':
                return `${action} tests for ${fileName.split('.')[0]}`;
            case 'chore':
                return `${action} ${fileName}`;
            default:
                return `${action} ${fileName}`;
        }
    }
    
    // Multiple files - try to find common theme
    const commonPath = findCommonPath(changes.map(c => c.filePath));
    
    if (commonPath && commonPath.length > 3) {
        const action = changes.some(c => c.status === 'added') ? 'add' : 'update';
        return `${action} ${commonPath} components`;
    }
    
    // Fall back to keyword-based description
    if (meaningfulKeywords.length >= 2) {
        const action = changes.some(c => c.status === 'added') ? 'add' : 'update';
        return `${action} ${meaningfulKeywords.slice(0, 2).join(' ')}`;
    }
    
    // Generic description based on type
    return `update ${changes.length} files`;
}

function getActionForStatus(status: string, type: string): string {
    switch (status) {
        case 'added': return 'add';
        case 'deleted': return 'remove';
        case 'renamed': return 'rename';
        case 'modified':
        default:
            return type === 'fix' ? 'fix' : 'update';
    }
}

function findCommonPath(paths: string[]): string | null {
    if (paths.length === 0) return null;
    if (paths.length === 1) return path.dirname(paths[0]).split('/').pop() || null;
    
    const parts = paths.map(p => p.split('/'));
    const minLength = Math.min(...parts.map(p => p.length));
    let commonParts = [];
    
    for (let i = 0; i < minLength; i++) {
        const part = parts[0][i];
        if (parts.every(p => p[i] === part)) {
            commonParts.push(part);
        } else {
            break;
        }
    }
    
    return commonParts.length > 0 ? commonParts.join('/') : null;
}

function detectScope(changes: FileChange[]): string | null {
    // Try to detect a common scope from file paths
    const commonPath = findCommonPath(changes.map(c => path.dirname(c.filePath)));
    
    if (commonPath) {
        const scope = commonPath.split('/').pop() || commonPath;
        // Only use as scope if it's a meaningful directory name
        if (scope && scope.length > 2 && 
            !['src', 'lib', 'dist', 'build', 'public', 'assets'].includes(scope)) {
            return scope;
        }
    }
    
    // Try to detect scope from file names
    if (changes.length === 1) {
        const filePath = changes[0].filePath;
        const dirName = path.dirname(filePath).split('/').pop();
        if (dirName && dirName.length > 2 && dirName !== '.') {
            return dirName;
        }
    }
    
    return null;
}

async function insertIntoSCMInput(message: string): Promise<void> {
    // Try to use the Git extension API first
    try {
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        
        if (gitExtension && gitExtension.isActive) {
            const gitApi = gitExtension.exports.getAPI(1);
            
            if (gitApi && gitApi.repositories && gitApi.repositories.length > 0) {
                const repo = gitApi.repositories[0];
                repo.inputBox.value = message;
                return;
            }
        }
    } catch (error) {
        console.warn('Could not use Git extension API, trying fallback method:', error);
    }
    
    // Fallback: Try to use the command to focus on SCM and set the message
    try {
        // Attempt to set the commit message via the SCM input box
        await vscode.commands.executeCommand('workbench.view.scm');
        
        // Try to find and set the input box
        // This is a fallback and may not always work depending on VS Code version
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Use the built-in command to set the commit message
        await vscode.commands.executeCommand('git.commitAll', message);
        
    } catch (fallbackError) {
        // If all else fails, show the message and copy to clipboard
        await vscode.env.clipboard.writeText(message);
        vscode.window.showInformationMessage(
            `Generated message copied to clipboard: "${message}"`
        );
    }
}

export function deactivate() {
    console.log('Auto Commit Message extension is now deactivated');
}