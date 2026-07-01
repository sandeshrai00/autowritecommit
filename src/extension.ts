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
        keywords: ['document', 'readme', 'doc', 'comment', 'guide', 'manual', 'wiki', 'md'],
        emoji: '📝',
        priority: 2
    },
    {
        type: 'style',
        description: 'Code style changes',
        keywords: ['style', 'format', 'indent', 'whitespace', 'lint', 'prettify', 'beautify', 'css'],
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
        keywords: ['chore', 'update', 'upgrade', 'bump', 'version', 'release', 'config', 'setting', 'misc', 'change', 'modify'],
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
    
    // Show activation message
    vscode.window.showInformationMessage('Auto Commit Message extension activated! Look for the ✨ button in Source Control.');
    
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
        vscode.window.showErrorMessage('Auto Commit: No workspace folder is open.');
        throw new Error('No workspace folder is open.');
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    console.log('Workspace root:', workspaceRoot);
    
    // Check if this is a git repository
    const gitDir = path.join(workspaceRoot, '.git');
    if (!fs.existsSync(gitDir)) {
        vscode.window.showErrorMessage('Auto Commit: The workspace is not a Git repository. Please open a Git repository.');
        throw new Error('The workspace is not a Git repository.');
    }

    // Try to get changes using multiple methods
    let hasChanges = false;
    let diff = '';
    
    // Method 1: Check staged changes
    try {
        console.log('Checking staged changes...');
        diff = await executeGitCommand(workspaceRoot, 'git diff --cached --name-status');
        if (diff.trim()) {
            hasChanges = true;
            console.log('Found staged changes:', diff);
            diff = await executeGitCommand(workspaceRoot, 'git diff --cached --unified=5');
        }
    } catch (error) {
        console.log('Error checking staged changes:', error);
    }

    // Method 2: If no staged changes, check unstaged changes
    if (!hasChanges) {
        try {
            console.log('Checking unstaged changes...');
            diff = await executeGitCommand(workspaceRoot, 'git diff --name-status');
            if (diff.trim()) {
                hasChanges = true;
                console.log('Found unstaged changes:', diff);
                diff = await executeGitCommand(workspaceRoot, 'git diff --unified=5');
            }
        } catch (error) {
            console.log('Error checking unstaged changes:', error);
        }
    }

    // Method 3: Check untracked files
    if (!hasChanges) {
        try {
            console.log('Checking untracked files...');
            const untracked = await executeGitCommand(workspaceRoot, 'git ls-files --others --exclude-standard');
            if (untracked.trim()) {
                hasChanges = true;
                console.log('Found untracked files:', untracked);
                diff = `Untracked files:\n${untracked}`;
            }
        } catch (error) {
            console.log('Error checking untracked files:', error);
        }
    }

    // Method 4: Check git status as last resort
    if (!hasChanges) {
        try {
            console.log('Checking git status...');
            const status = await executeGitCommand(workspaceRoot, 'git status --porcelain');
            if (status.trim()) {
                hasChanges = true;
                console.log('Found changes in status:', status);
                diff = `Git Status:\n${status}`;
            }
        } catch (error) {
            console.log('Error checking git status:', error);
        }
    }

    if (!hasChanges || !diff.trim()) {
        vscode.window.showInformationMessage('Auto Commit: No changes detected. Make some changes to your files first!');
        console.log('No changes found in repository');
        return;
    }

    // Parse the diff to extract meaningful information
    const changes = parseGitDiff(diff);
    console.log('Parsed changes:', changes);
    
    const message = generateCommitMessage(changes, diff);
    console.log('Generated message:', message);
    
    // Insert the message into the SCM input box
    await insertIntoSCMInput(message);
    
    vscode.window.showInformationMessage(`✅ Generated commit message: "${message}"`);
}

async function executeGitCommand(cwd: string, command: string): Promise<string> {
    try {
        console.log(`Executing: ${command}`);
        const { stdout, stderr } = await exec(command, { 
            cwd,
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });
        
        if (stderr && !stderr.includes('warning:')) {
            console.warn('Git command warning:', stderr);
        }
        
        return stdout;
    } catch (error: any) {
        console.error(`Git command failed: ${command}`, error);
        if (error.stderr) {
            throw new Error(error.stderr.trim());
        }
        throw error;
    }
}

function parseGitDiff(diff: string): FileChange[] {
    const changes: FileChange[] = [];
    
    // If it's untracked files or status
    if (diff.startsWith('Untracked files:') || diff.startsWith('Git Status:')) {
        const lines = diff.split('\n').filter(line => line.trim());
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line) {
                let filePath = line;
                let status = 'untracked';
                
                // Handle git status format
                if (line.length > 3 && line[2] === ' ') {
                    const statusCode = line.substring(0, 2).trim();
                    filePath = line.substring(3).trim();
                    
                    if (statusCode === '??') status = 'untracked';
                    else if (statusCode === 'A') status = 'added';
                    else if (statusCode === 'M') status = 'modified';
                    else if (statusCode === 'D') status = 'deleted';
                    else if (statusCode === 'R') status = 'renamed';
                    else status = 'modified';
                }
                
                changes.push({
                    filePath,
                    status,
                    additions: 1,
                    deletions: 0
                });
            }
        }
        return changes;
    }
    
    // Parse regular diff
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

    // If no changes were parsed but diff exists, create generic changes
    if (changes.length === 0 && diff.trim()) {
        changes.push({
            filePath: 'files',
            status: 'modified',
            additions: 1,
            deletions: 0
        });
    }

    return changes;
}

function generateCommitMessage(changes: FileChange[], diff: string): string {
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
    
    // Default to feat if no good match
    let bestMatch = scoredTypes[0].commitType;
    if (scoredTypes[0].score < 1) {
        bestMatch = COMMIT_TYPES.find(t => t.type === 'chore') || bestMatch;
    }
    
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
    
    // Extract words from file paths
    for (const change of changes) {
        const filePath = change.filePath.toLowerCase();
        const pathParts = filePath.split(/[\/\\\-_.]/);
        for (const part of pathParts) {
            if (part.length > 1) {
                keywords.add(part);
            }
        }
        
        // Add file extension as keyword
        const ext = path.extname(change.filePath).toLowerCase();
        if (ext) {
            keywords.add(ext.replace('.', ''));
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
            case 'untracked':
                keywords.add('add');
                keywords.add('new');
                break;
        }
    }
    
    // Extract words from the diff content
    if (diff && !diff.startsWith('Untracked files:') && !diff.startsWith('Git Status:')) {
        const addedLines = diff.split('\n')
            .filter(line => line.startsWith('+') && !line.startsWith('+++'))
            .map(line => line.substring(1).trim())
            .filter(line => line.length > 0);
        
        for (const line of addedLines) {
            const words = line.split(/[\s\-_.{}()[\];:'",<>/\\|`~!@#$%^&*+=]+/);
            for (const word of words) {
                const lower = word.toLowerCase();
                if (lower.length > 2) {
                    keywords.add(lower);
                }
            }
        }
    }
    
    console.log('Extracted keywords:', Array.from(keywords));
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
        const filePath = change.filePath.toLowerCase();
        
        // Documentation patterns
        if (filePath.match(/\.(md|txt|rst|adoc)$/) || 
            filePath.includes('readme') || 
            filePath.includes('docs/') ||
            filePath.includes('documentation/')) {
            docScore += 3;
        }
        
        // Test patterns
        if (filePath.includes('test') || 
            filePath.includes('spec') || 
            filePath.match(/\.(test|spec)\.(ts|js|jsx|tsx|py|java|go)$/)) {
            testScore += 3;
        }
        
        // Style patterns
        if (filePath.match(/\.(css|scss|sass|less|styl)$/) ||
            filePath.includes('.style') ||
            filePath.includes('theme')) {
            styleScore += 2;
        }
        
        // Build patterns
        if (filePath.match(/(package\.json|yarn\.lock|package-lock\.json|pom\.xml|build\.gradle|Cargo\.toml)$/) ||
            filePath.match(/\.(config|rc)\.(js|ts|json|yaml|yml)$/) ||
            filePath.includes('webpack') || filePath.includes('babel')) {
            buildScore += 3;
        }
        
        // CI patterns
        if (filePath.includes('.github/') ||
            filePath.includes('.gitlab/') ||
            filePath.includes('jenkins') ||
            filePath.includes('docker') ||
            filePath.match(/^(Dockerfile|docker-compose\.yml|\.travis\.yml|\.drone\.yml)$/)) {
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
    if (changes.length === 0) {
        return 'update files';
    }
    
    // Generate a description based on the type and changes
    const fileNames = changes.map(c => path.basename(c.filePath, path.extname(c.filePath)));
    
    // Try to create a meaningful description
    if (changes.length === 1) {
        const change = changes[0];
        const fileName = path.basename(change.filePath);
        const action = getActionForStatus(change.status, type);
        
        switch (type) {
            case 'feat':
                return `${action} ${fileName}`;
            case 'fix':
                return `fix ${fileName}`;
            case 'docs':
                return `${action} ${fileName}`;
            case 'style':
                return `format ${fileName}`;
            case 'refactor':
                return `refactor ${fileName}`;
            case 'test':
                return `${action} tests for ${fileName}`;
            case 'chore':
                return `${action} ${fileName}`;
            default:
                return `${action} ${fileName}`;
        }
    }
    
    // Multiple files - try to find common theme
    const commonPath = findCommonPath(changes.map(c => c.filePath));
    
    if (commonPath && commonPath.length > 3) {
        const action = changes.some(c => c.status === 'added' || c.status === 'untracked') ? 'add' : 'update';
        return `${action} ${commonPath} components`;
    }
    
    // Use the most common file extension or name
    const extensions = changes.map(c => path.extname(c.filePath));
    const mostCommonExt = extensions.sort((a, b) =>
        extensions.filter(v => v === a).length - extensions.filter(v => v === b).length
    ).pop() || '';
    
    if (mostCommonExt && mostCommonExt.length > 0) {
        const action = changes.some(c => c.status === 'added' || c.status === 'untracked') ? 'add' : 'update';
        return `${action} ${mostCommonExt.replace('.', '')} files`;
    }
    
    // Generic description based on type and file count
    const action = changes.some(c => c.status === 'added' || c.status === 'untracked') ? 'add' : 'update';
    return `${action} ${changes.length} files`;
}

function getActionForStatus(status: string, type: string): string {
    switch (status) {
        case 'added':
        case 'untracked':
            return 'add';
        case 'deleted':
            return 'remove';
        case 'renamed':
            return 'rename';
        case 'modified':
        default:
            return type === 'fix' ? 'fix' : 'update';
    }
}

function findCommonPath(paths: string[]): string | null {
    if (paths.length === 0) return null;
    if (paths.length === 1) {
        const dir = path.dirname(paths[0]);
        return dir !== '.' ? dir.split('/').pop() || null : null;
    }
    
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
            !['src', 'lib', 'dist', 'build', 'public', 'assets', '.'].includes(scope)) {
            return scope;
        }
    }
    
    return null;
}

async function insertIntoSCMInput(message: string): Promise<void> {
    console.log('Inserting message into SCM:', message);
    
    // Try multiple methods to insert the message
    try {
        // Method 1: Use the Git extension API
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        
        if (gitExtension && gitExtension.isActive) {
            const gitApi = gitExtension.exports.getAPI(1);
            
            if (gitApi && gitApi.repositories && gitApi.repositories.length > 0) {
                const repo = gitApi.repositories[0];
                repo.inputBox.value = message;
                console.log('Message inserted via Git API');
                return;
            }
        }
    } catch (error) {
        console.warn('Method 1 failed:', error);
    }
    
    // Method 2: Try SCM view provider
    try {
        const scmView = vscode.scm;
        // Try to set through the active SCM provider
        console.log('Trying SCM provider method');
        await vscode.commands.executeCommand('workbench.view.scm');
        await new Promise(resolve => setTimeout(resolve, 200));
    } catch (error) {
        console.warn('Method 2 failed:', error);
    }
    
    // Method 3: Copy to clipboard as fallback
    try {
        await vscode.env.clipboard.writeText(message);
        vscode.window.showInformationMessage(
            `Generated message copied to clipboard: "${message}"\nPaste it in the commit message box (Ctrl+V).`
        );
        console.log('Message copied to clipboard');
    } catch (error) {
        console.error('All methods failed:', error);
        throw new Error('Could not insert commit message');
    }
}

export function deactivate() {
    console.log('Auto Commit Message extension is now deactivated');
}