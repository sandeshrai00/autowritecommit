import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

// ── Binary / non-analyzable file extensions ──
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.wav', '.ogg', '.mov',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib',
  '.pyc', '.class', '.o', '.obj',
  '.min.js', '.min.css',
  '.map', '.wasm',
]);

// ── Language detection map ──
const LANG_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python',
  '.java': 'Java',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.cpp': 'C/C++', '.c': 'C/C++', '.h': 'C/C++', '.hpp': 'C/C++',
  '.css': 'CSS', '.scss': 'CSS', '.less': 'CSS', '.sass': 'CSS',
  '.html': 'HTML', '.htm': 'HTML',
  '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.md': 'Markdown', '.mdx': 'Markdown',
  '.sql': 'SQL',
  '.swift': 'Swift',
  '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.dart': 'Dart',
  '.r': 'R', '.rds': 'R',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.tf': 'Terraform', '.tfvars': 'Terraform',
  '.dockerfile': 'Docker', '.dockerignore': 'Docker',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.graphql': 'GraphQL', '.gql': 'GraphQL',
};

// ── Diff parsing helpers ──
interface ParsedDiff {
  filePath: string;
  additions: number;
  deletions: number;
  diff: string;
  bugfixes: string[];
  features: string[];
  refactors: string[];
  packagesAdded: string[];
  packagesRemoved: string[];
}

const BUG_RE = /fix|bug|issue|error|crash|null|undefined|broken|resolve|patch|correct|hotfix|workaround|defect/;
const FEAT_RE = /add|create|new|feature|implement|introduce|support|enable|allow|expose/;
const REFACTOR_RE = /refactor|restructure|simplify|clean|reorganize|move|extract|rename|migrate|consolidate/;
const PKG_RE = /[+-]\s*"(@?[^"]+)":\s*"[^"]+"/g;

function parseUnifiedDiff(stdout: string): Map<string, ParsedDiff> {
  const fileMap = new Map<string, ParsedDiff>();
  let currentFile = '';
  let currentDiff: ParsedDiff | null = null;

  for (const line of stdout.split('\n')) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (header) {
      if (currentFile && currentDiff) {
        fileMap.set(currentFile, currentDiff);
      }
      currentFile = header[2];
      currentDiff = {
        filePath: currentFile,
        additions: 0,
        deletions: 0,
        diff: '',
        bugfixes: [],
        features: [],
        refactors: [],
        packagesAdded: [],
        packagesRemoved: [],
      };
    }

    if (!currentDiff) continue;

    currentDiff.diff += line + '\n';

    if (line.startsWith('+') && !line.startsWith('+++')) {
      currentDiff.additions++;
      const clean = line.substring(1).toLowerCase().trim().substring(0, 80);
      if (BUG_RE.test(clean)) currentDiff.bugfixes.push(clean);
      if (FEAT_RE.test(clean)) currentDiff.features.push(clean);
      if (REFACTOR_RE.test(clean)) currentDiff.refactors.push(clean);

      const pkgMatch = line.match(/"(@?[^"]+)":\s*"[^"]+"/);
      if (pkgMatch && line.startsWith('+')) currentDiff.packagesAdded.push(pkgMatch[1]);
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      currentDiff.deletions++;
      const pkgMatch = line.match(/"(@?[^"]+)":\s*"[^"]+"/);
      if (pkgMatch && line.startsWith('-')) currentDiff.packagesRemoved.push(pkgMatch[1]);
    }
  }

  if (currentFile && currentDiff) {
    fileMap.set(currentFile, currentDiff);
  }

  return fileMap;
}

// ── Git execution with timeout ──
async function git(args: string[], cwd: string, maxBuffer = 50 * 1024 * 1024): Promise<string> {
  const cmd = `git ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' ')}`;
  const { stdout } = await execAsync(cmd, { cwd, maxBuffer, timeout: 60000 });
  return stdout;
}

// ── Analysis types ──
interface FileChange {
  filePath: string;
  fileName: string;
  fileExt: string;
  dirName: string;
  changeType: 'modified' | 'added' | 'untracked' | 'deleted' | 'renamed';
  staged: boolean;
  additions: number;
  deletions: number;
  content: string;
  diff: string;
  bugfixes: string[];
  features: string[];
  refactors: string[];
  functions: string[];
  classes: string[];
}

interface DeepAnalysis {
  languages: Set<string>;
  frameworks: Set<string>;
  packages: Set<string>;
  functions: { name: string; file: string }[];
  classes: { name: string; file: string }[];
  components: { name: string; file: string }[];
  apis: string[];
  models: string[];
  services: string[];
  utils: string[];
  configs: string[];
  styles: string[];
  tests: string[];
  docs: string[];
  deps: string[];
  summary: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
    newFiles: number;
    deletedFiles: number;
    modifiedFiles: number;
    stagedFiles: number;
    unstagedFiles: number;
  };
}

// ── Scalable file-content batch reader ──
const CONTENT_BATCH_SIZE = 50;

async function batchReadContents(
  changes: FileChange[],
  workspaceRoot: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const toRead = changes.filter(c => c.changeType !== 'deleted' && !BINARY_EXTS.has(c.fileExt));
  const total = toRead.length;

  for (let i = 0; i < total; i += CONTENT_BATCH_SIZE) {
    const batch = toRead.slice(i, i + CONTENT_BATCH_SIZE);
    await Promise.all(batch.map(async (change) => {
      try {
        const fullPath = path.join(workspaceRoot, change.filePath);
        const stat = await fs.promises.stat(fullPath).catch(() => null);
        if (!stat || stat.size > 1024 * 1024) return; // skip files > 1MB
        change.content = await fs.promises.readFile(fullPath, 'utf8');
      } catch { /* skip unreadable */ }
    }));
    if (onProgress) onProgress(Math.min(i + CONTENT_BATCH_SIZE, total), total);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Auto Commit Message');
  context.subscriptions.push(outputChannel);

  // ── Status bar button (always visible) ──
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'auto-commit-message.generateMessage';
  statusBarItem.text = '$(git-commit) Auto Commit';
  statusBarItem.tooltip = 'Generate a conventional commit message';
  statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // ── Refresh status bar on file saves / git events ──
  const refreshStatus = async () => {
    try {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders || !folders.length) { statusBarItem.text = '$(git-commit) Auto Commit'; return; }
      const root = folders[0].uri.fsPath;
      if (!fs.existsSync(path.join(root, '.git'))) { statusBarItem.text = '$(git-commit) Auto Commit'; return; }
      const { stdout } = await execAsync('git status --porcelain -u', { cwd: root, timeout: 5000 });
      const count = stdout.trim() ? stdout.split('\n').filter(l => l.trim()).length : 0;
      if (count > 0) {
        statusBarItem.text = `$(git-commit) Auto Commit \` ${count}`;
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      } else {
        statusBarItem.text = '$(git-commit) Auto Commit';
        statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
      }
    } catch {
      statusBarItem.text = '$(git-commit) Auto Commit';
    }
  };

  // Debounced refresh
  let refreshTimer: NodeJS.Timeout | undefined;
  const debouncedRefresh = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshStatus, 500);
  };

  // Listen for file saves and editor changes
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(debouncedRefresh),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document.uri.scheme === 'file') debouncedRefresh();
    }),
  );

  // Initial refresh
  setTimeout(refreshStatus, 1000);

  // ── Main command ──
  const command = vscode.commands.registerCommand(
    'auto-commit-message.generateMessage',
    async (scmResource?: any) => {
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
        location: vscode.ProgressLocation.Window,
        title: 'Auto Commit — analyzing changes...',
        cancellable: true,
      }, async (progress, token) => {
        try {
          // ── Phase 1: Validate ──
          progress.report({ increment: 0, message: 'Checking repository...' });
          if (token.isCancellationRequested) return;

          if (!fs.existsSync(path.join(workspaceRoot, '.git'))) {
            vscode.window.showErrorMessage('Not a Git repository');
            return;
          }

          // ── Phase 2: Get changes ──
          progress.report({ increment: 5, message: 'Scanning git status...' });
          if (token.isCancellationRequested) return;

          const changes = await getChanges(workspaceRoot);
          if (changes.length === 0) {
            vscode.window.showInformationMessage('No changes detected');
            return;
          }

          progress.report({ increment: 10, message: `Found ${changes.length} changed files` });
          if (token.isCancellationRequested) return;

          // ── Phase 3: Get diffs (batched, efficient) ──
          progress.report({ increment: 15, message: 'Fetching diffs...' });
          if (token.isCancellationRequested) return;

          await getDiffs(workspaceRoot, changes, outputChannel);

          // ── Phase 4: Read file content (batch, parallel, skip binary) ──
          progress.report({ increment: 30, message: `Reading ${changes.length} files...` });
          if (token.isCancellationRequested) return;

          await batchReadContents(changes, workspaceRoot, (done, total) => {
            if (token.isCancellationRequested) return;
            progress.report({
              increment: 0,
              message: `Reading files... ${done}/${total}`,
            });
          });

          // ── Phase 5: Analyze ──
          progress.report({ increment: 50, message: 'Analyzing code structure...' });
          if (token.isCancellationRequested) return;

          const analysis = analyzeChanges(changes);

          // ── Phase 6: Generate message ──
          progress.report({ increment: 80, message: 'Crafting commit message...' });
          if (token.isCancellationRequested) return;

          const config = vscode.workspace.getConfiguration('autoCommitMessage');
          const useEmoji = config.get<boolean>('useEmoji', false);
          const maxLength = config.get<number>('maxLength', 72);

          const { subject, body } = generateMessage(analysis, changes, useEmoji, maxLength);
          const fullMessage = body ? `${subject}\n\n${body}` : subject;

          // ── Phase 7: Insert ──
          progress.report({ increment: 95, message: 'Inserting into SCM...' });
          if (token.isCancellationRequested) return;

          await insertMessage(fullMessage, workspaceRoot);

          outputChannel.appendLine(`✅ ${subject}`);
          if (body) outputChannel.appendLine(body);

          // ── Phase 8: Show result (auto-dismiss status bar, 3s) ──
          vscode.window.setStatusBarMessage(
            `$(git-commit)  ${subject}` + ` (+${analysis.summary.totalAdditions} -${analysis.summary.totalDeletions})`,
            3000,
          );

          // Also show analysis button as a notification (auto-dismisses if ignored)
          setTimeout(() => {
            vscode.window.showInformationMessage(
              `$(git-commit)  **${subject}**`,
              '$(list-tree)  Full Analysis',
              '$(sync)  Retry',
            ).then(pick => {
              if (pick === '$(list-tree)  Full Analysis') {
                showReport(analysis, changes, subject);
              } else if (pick === '$(sync)  Retry') {
                vscode.commands.executeCommand('auto-commit-message.generateMessage', scmResource);
              }
            });
          }, 100);

          // Refresh status bar
          debouncedRefresh();

        } catch (error: any) {
          const msg = error?.message || String(error);
          outputChannel.appendLine(`❌ ${msg}`);
          vscode.window.showErrorMessage(`Auto Commit error: ${msg}`);
        }
      });
    },
  );

  context.subscriptions.push(command);
}

// ── Get changed files via git status ──
async function getChanges(workspaceRoot: string): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  const stdout = await git(['status', '--porcelain', '-u'], workspaceRoot);
  if (!stdout.trim()) return changes;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const code = line.substring(0, 2).trim();
    // Handle renamed: "R  file -> newfile"
    let filePath = line.substring(3).trim();
    if (code === 'R ') {
      const parts = filePath.split(/\s+->\s+/);
      filePath = parts[parts.length - 1];
    }

    let changeType: FileChange['changeType'] = 'modified';
    let staged = false;

    if (code === '??') { changeType = 'untracked'; }
    else if (code === 'A ' || code === 'AM') { changeType = 'added'; staged = true; }
    else if (code === 'M ' || code === 'MM') { changeType = 'modified'; staged = true; }
    else if (code === 'D ' || code === 'AD') { changeType = 'deleted'; staged = true; }
    else if (code === 'R ') { changeType = 'renamed'; staged = true; }
    else if (code === ' M') { changeType = 'modified'; }
    else if (code === ' D') { changeType = 'deleted'; }

    const fileExt = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath);
    const dirName = path.dirname(filePath).split(/[/\\]/).pop() || 'root';

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
      diff: '',
      bugfixes: [],
      features: [],
      refactors: [],
      functions: [],
      classes: [],
    });
  }

  return changes;
}

// ── Get diffs efficiently via batched git commands ──
async function getDiffs(workspaceRoot: string, changes: FileChange[], log: vscode.OutputChannel): Promise<void> {
  // Single git diff calls — much faster than per-file
  const stagedFiles = changes.filter(c => c.staged && c.changeType !== 'deleted');
  const unstagedFiles = changes.filter(c => !c.staged && c.changeType === 'modified');
  const untrackedFiles = changes.filter(c => c.changeType === 'untracked');
  const deletedFiles = changes.filter(c => c.changeType === 'deleted');

  // ── Staged diffs ──
  if (stagedFiles.length > 0) {
    try {
      const stdout = await git(['diff', '--cached', '-p'], workspaceRoot);
      const parsed = parseUnifiedDiff(stdout);
      for (const change of stagedFiles) {
        const info = parsed.get(change.filePath);
        if (info) {
          change.diff = info.diff;
          change.additions = info.additions;
          change.deletions = info.deletions;
          change.bugfixes = info.bugfixes;
          change.features = info.features;
          change.refactors = info.refactors;
        }
      }
    } catch (e: any) {
      log.appendLine(`Warning: staged diff failed: ${e.message}`);
    }
  }

  // ── Unstaged diffs ──
  if (unstagedFiles.length > 0) {
    try {
      const stdout = await git(['diff', '-p'], workspaceRoot);
      const parsed = parseUnifiedDiff(stdout);
      for (const change of unstagedFiles) {
        const info = parsed.get(change.filePath);
        if (info) {
          change.diff = info.diff;
          change.additions = info.additions;
          change.deletions = info.deletions;
          change.bugfixes = info.bugfixes;
          change.features = info.features;
          change.refactors = info.refactors;
        }
      }
    } catch (e: any) {
      log.appendLine(`Warning: unstaged diff failed: ${e.message}`);
    }
  }

  // ── Untracked files (diff against /dev/null) — batch them too ──
  if (untrackedFiles.length > 0) {
    // For many untracked files, just get numstat, skip full diff
    try {
      const numstat = await git(
        ['diff', '--no-index', '--numstat', '/dev/null', '.'],
        workspaceRoot,
        10 * 1024 * 1024,
      ).catch(() => '');

      if (numstat) {
        for (const line of numstat.split('\n')) {
          const parts = line.trim().split('\t');
          if (parts.length >= 3) {
            const fpath = parts[2];
            const change = untrackedFiles.find(c => c.filePath === fpath);
            if (change) {
              change.additions = parseInt(parts[0]) || 0;
              change.deletions = parseInt(parts[1]) || 0;
            }
          }
        }
      }
    } catch { /* numstat not always available for /dev/null */ }
  }

  // ── Deleted files: get diff from staged/cached ──
  if (deletedFiles.length > 0) {
    try {
      const stdout = await git(['diff', '--cached', '-p', '--diff-filter=D'], workspaceRoot);
      const parsed = parseUnifiedDiff(stdout);
      for (const change of deletedFiles) {
        const info = parsed.get(change.filePath);
        if (info) {
          change.diff = info.diff;
          change.deletions = info.deletions;
        }
      }
    } catch { /* ok */ }
  }
}

// ── Deep analysis ──
function analyzeChanges(changes: FileChange[]): DeepAnalysis {
  const analysis: DeepAnalysis = {
    languages: new Set(),
    frameworks: new Set(),
    packages: new Set(),
    functions: [],
    classes: [],
    components: [],
    apis: [],
    models: [],
    services: [],
    utils: [],
    configs: [],
    styles: [],
    tests: [],
    docs: [],
    deps: [],
    summary: {
      totalFiles: changes.length,
      totalAdditions: 0,
      totalDeletions: 0,
      newFiles: changes.filter(c => c.changeType === 'added' || c.changeType === 'untracked').length,
      deletedFiles: changes.filter(c => c.changeType === 'deleted').length,
      modifiedFiles: changes.filter(c => c.changeType === 'modified').length,
      stagedFiles: changes.filter(c => c.staged).length,
      unstagedFiles: changes.filter(c => !c.staged).length,
    },
  };

  for (const change of changes) {
    const ext = change.fileExt;
    const content = change.content || '';
    const fileName = change.fileName.toLowerCase();
    const filePath = change.filePath.toLowerCase();

    // ── Languages ──
    const lang = LANG_MAP[ext];
    if (lang) analysis.languages.add(lang);

    // ── Frameworks ──
    const lc = content.toLowerCase();
    if (lc.includes('react')) analysis.frameworks.add('React');
    if (lc.includes('vue')) analysis.frameworks.add('Vue');
    if (lc.includes('angular')) analysis.frameworks.add('Angular');
    if (lc.includes('next')) analysis.frameworks.add('Next.js');
    if (lc.includes('express')) analysis.frameworks.add('Express');
    if (lc.includes('django')) analysis.frameworks.add('Django');
    if (lc.includes('flask')) analysis.frameworks.add('Flask');
    if (lc.includes('spring')) analysis.frameworks.add('Spring');
    if (lc.includes('fastapi')) analysis.frameworks.add('FastAPI');
    if (lc.includes('tailwind')) analysis.frameworks.add('Tailwind CSS');
    if (lc.includes('prisma')) analysis.frameworks.add('Prisma');
    if (lc.includes('typeorm')) analysis.frameworks.add('TypeORM');

    // ── Functions ──
    const fnMatches = content.matchAll(/(?:function|def|func)\s+(\w+)/g);
    for (const m of fnMatches) {
      if (m[1] && m[1].length > 2 && !analysis.functions.some(f => f.name === m[1])) {
        analysis.functions.push({ name: m[1], file: change.filePath });
        change.functions.push(m[1]);
      }
    }
    const arrowMatches = content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
    for (const m of arrowMatches) {
      if (m[1] && !analysis.functions.some(f => f.name === m[1])) {
        analysis.functions.push({ name: m[1], file: change.filePath });
        change.functions.push(m[1]);
      }
    }

    // ── Classes ──
    const clsMatches = content.matchAll(/class\s+(\w+)/g);
    for (const m of clsMatches) {
      if (m[1] && !analysis.classes.some(c => c.name === m[1])) {
        analysis.classes.push({ name: m[1], file: change.filePath });
        change.classes.push(m[1]);
      }
    }

    // ── Components (exports) ──
    const compMatches = content.matchAll(/export\s+(?:default\s+)?(?:function|class|const)\s+(\w+)/g);
    for (const m of compMatches) {
      if (m[1] && !analysis.components.some(c => c.name === m[1])) {
        analysis.components.push({ name: m[1], file: change.filePath });
      }
    }

    // ── Path-based categorization ──
    if (filePath.includes('/api/') || filePath.includes('/routes/') || filePath.includes('/controllers/')) {
      analysis.apis.push(change.filePath);
    }
    if (filePath.includes('/models/') || filePath.includes('/entities/') || filePath.includes('/schemas/')) {
      analysis.models.push(change.filePath);
    }
    if (filePath.includes('/services/') || filePath.includes('/providers/')) {
      analysis.services.push(change.filePath);
    }
    if (filePath.includes('/utils/') || filePath.includes('/helpers/') || filePath.includes('/lib/')) {
      analysis.utils.push(change.filePath);
    }
    if (fileName.includes('config') || fileName.includes('.env') || fileName.includes('setting')) {
      analysis.configs.push(change.filePath);
    }
    if (filePath.includes('/styles/') || filePath.includes('/css/') || ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less') {
      analysis.styles.push(change.filePath);
    }
    if (fileName.includes('test') || fileName.includes('spec') || filePath.includes('/tests/') || filePath.includes('/__tests__/')) {
      analysis.tests.push(change.filePath);
    }
    if (ext === '.md' || ext === '.mdx' || fileName.includes('readme') || filePath.includes('/docs/')) {
      analysis.docs.push(change.filePath);
    }

    // ── Totals from diff ──
    analysis.summary.totalAdditions += change.additions;
    analysis.summary.totalDeletions += change.deletions;

    // ── Dependencies (package.json) ──
    if (fileName === 'package.json' && change.changeType !== 'deleted') {
      try {
        const pkg = JSON.parse(content);
        if (pkg.dependencies) Object.keys(pkg.dependencies).forEach(d => analysis.packages.add(d));
        if (pkg.devDependencies) Object.keys(pkg.devDependencies).forEach(d => analysis.packages.add(d));
      } catch { /* skip */ }
    }
    change.bugfixes.forEach(b => {
      if (!analysis.deps.includes(b) && analysis.deps.length < 50) analysis.deps.push(b);
    });
  }

  return analysis;
}

// ── Message generation (accurate, scoped, multi-file aware) ──
function generateMessage(
  analysis: DeepAnalysis,
  changes: FileChange[],
  useEmoji: boolean,
  maxLength: number,
): { subject: string; body: string } {
  const total = changes.length;
  const staged = changes.filter(c => c.staged);
  const hasStaged = staged.length > 0;

  // Collect all diffs for bugfix/feature/refactor signals
  const allBugfixes = changes.flatMap(c => c.bugfixes);
  const allFeatures = changes.flatMap(c => c.features);
  const allRefactors = changes.flatMap(c => c.refactors);
  const hasBugfixes = allBugfixes.length > 0;
  const hasFeatures = allFeatures.length > 0;
  const hasRefactors = allRefactors.length > 0;
  const hasComponents = analysis.components.length > 0;
  const hasFunctions = analysis.functions.length > 0;
  const hasClasses = analysis.classes.length > 0;
  const hasApis = analysis.apis.length > 0;
  const hasModels = analysis.models.length > 0;
  const hasServices = analysis.services.length > 0;
  const hasTests = analysis.tests.length > 0;
  const hasDocs = analysis.docs.length > 0;
  const hasStyles = analysis.styles.length > 0;
  const hasConfigs = analysis.configs.length > 0;

  // Infer scope from directory structure
  const dirCounts = new Map<string, number>();
  for (const c of changes) {
    const dir = c.dirName;
    dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1);
  }
  let scope = '';
  const maxDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (maxDir && maxDir[1] >= Math.ceil(total * 0.4) && maxDir[1] >= 2 && maxDir[0] !== 'root') {
    scope = maxDir[0];
  }

  // ── Build subject ──
  let type: string;
  let description: string;

  if (total === 1) {
    // ── Single file ──
    const c = changes[0];
    const name = path.basename(c.filePath, c.fileExt);

    if (c.changeType === 'untracked' || c.changeType === 'added') {
      type = 'feat';
      if (hasComponents) description = `add ${analysis.components[0].name} component`;
      else if (hasFunctions) description = `add ${analysis.functions[0].name}`;
      else if (hasClasses) description = `add ${analysis.classes[0].name} class`;
      else if (hasApis) description = `add ${name} API endpoint`;
      else if (hasModels) description = `add ${name} model`;
      else if (hasServices) description = `add ${name} service`;
      else if (hasTests) description = `add tests for ${name}`;
      else if (hasDocs) description = `add ${name} docs`;
      else if (hasStyles) description = `add ${name} styles`;
      else description = `add ${name}`;
    } else if (c.changeType === 'deleted') {
      type = 'chore';
      description = `remove ${name}`;
    } else {
      // Modified
      if (hasBugfixes) {
        type = 'fix';
        description = allBugfixes[0].substring(0, 50);
      } else if (hasRefactors) {
        type = 'refactor';
        const fns = analysis.functions.slice(0, 3).map(f => f.name).join(', ');
        description = fns ? `${name}: ${fns}` : name;
      } else if (hasFunctions) {
        type = 'feat';
        description = `update ${analysis.functions[0].name} in ${name}`;
      } else if (hasFeatures) {
        type = 'feat';
        description = `enhance ${name}`;
      } else if (hasTests) {
        type = 'test';
        description = `update tests for ${name}`;
      } else if (hasDocs) {
        type = 'docs';
        description = `update ${name} docs`;
      } else if (hasStyles) {
        type = 'style';
        description = `update ${name} styles`;
      } else if (hasConfigs) {
        type = 'chore';
        description = `update ${name} config`;
      } else {
        type = 'chore';
        description = `update ${name}`;
      }
    }
  } else {
    // ── Multiple files ──

    // Detect primary change type
    const categories: string[] = [];
    if (hasComponents) categories.push('components');
    if (hasApis) categories.push('API');
    if (hasModels) categories.push('models');
    if (hasServices) categories.push('services');
    if (hasTests) categories.push('tests');
    if (hasDocs) categories.push('docs');
    if (hasStyles) categories.push('styles');
    if (hasConfigs) categories.push('config');
    if (analysis.utils.length > 0) categories.push('utils');

    const newFiles = analysis.summary.newFiles;
    const deletedFiles = analysis.summary.deletedFiles;
    const modFiles = analysis.summary.modifiedFiles;

    // For small changes (<=3 files), use file names
    if (total <= 3 && !hasBugfixes) {
      const names = changes.map(c => path.basename(c.filePath, c.fileExt));
      if (hasFeatures && hasComponents) {
        type = 'feat';
        description = `${names.join(', ')}: ${analysis.components[0].name}`;
      } else if (hasFunctions) {
        type = 'feat';
        description = `${names.join(', ')}: ${analysis.functions.slice(0, 2).map(f => f.name).join(', ')}`;
      } else if (hasApis) {
        type = 'feat';
        description = `${names.join(', ')}: API updates`;
      } else if (hasTests) {
        type = 'test';
        description = names.join(', ');
      } else if (hasStyles) {
        type = 'style';
        description = names.join(', ');
      } else if (hasConfigs) {
        type = 'chore';
        description = names.join(', ');
      } else {
        type = 'feat';
        description = names.join(', ');
      }
    } else if (hasBugfixes && hasFeatures) {
      type = 'feat';
      description = `${total} files: features & fixes`;
    } else if (hasBugfixes) {
      type = 'fix';
      description = `${total} files: ${allBugfixes.length} issues`;
    } else if (hasFeatures && hasComponents) {
      type = 'feat';
      description = `${analysis.components.slice(0, 2).map(c => c.name).join(', ')}${analysis.components.length > 2 ? '...' : ''}`;
    } else if (hasRefactors && total > 2) {
      type = 'refactor';
      description = categories.length > 0
        ? `restructure ${categories.slice(0, 3).join(', ')}`
        : `${total} files`;
    } else if (newFiles > total / 2) {
      type = 'feat';
      description = `${newFiles} new files`;
    } else if (deletedFiles > 0 && newFiles === 0) {
      type = 'chore';
      description = `${deletedFiles} files removed`;
    } else if (analysis.packages.size > 0 && total <= 5) {
      type = 'build';
      description = `deps: ${[...analysis.packages].slice(0, 2).join(', ')}`;
    } else if (categories.length >= 2) {
      type = 'feat';
      description = `${total} files: ${categories.slice(0, 2).join(', ')}`;
    } else if (categories.length === 1) {
      type = 'feat';
      description = `${total} files: ${categories[0]}`;
    } else {
      type = 'feat';
      description = `${total} files (+${analysis.summary.totalAdditions} -${analysis.summary.totalDeletions})`;
    }
  }

  // ── Build subject with scope ──
  const emojis: Record<string, string> = {
    feat: '✨', fix: '🐛', docs: '📝', style: '💄', refactor: '♻️',
    perf: '⚡', test: '✅', build: '📦', ci: '👷', chore: '🔧',
  };

  let subject = '';
  if (useEmoji) subject += `${emojis[type] || ''} `;

  if (scope) {
    subject += `${type}(${scope}): ${description}`;
  } else {
    subject += `${type}: ${description}`;
  }

  // Enforce max length on subject
  if (subject.length > maxLength) {
    subject = subject.substring(0, maxLength - 3).trimEnd() + '...';
  }

  // ── Build body with full detail ──
  const bodyParts: string[] = [];

  bodyParts.push(`**${total} files changed** (+${analysis.summary.totalAdditions} -${analysis.summary.totalDeletions})`);

  // Per-file summary
  bodyParts.push(`\n📁 **Files**`);
  for (const c of changes) {
    const icon = c.changeType === 'added' || c.changeType === 'untracked' ? '+' :
                 c.changeType === 'deleted' ? '-' : '~';
    const fileLine = `- ${icon} \`${c.filePath}\``;
    let details: string[] = [];
    if (c.functions.length > 0) details.push(`func: ${c.functions[0]}`);
    if (c.classes.length > 0) details.push(`class: ${c.classes[0]}`);
    if (c.bugfixes.length > 0) details.push(`fix: ${c.bugfixes[0].substring(0, 60)}`);
    if (c.features.length > 0) details.push(`feat: ${c.features[0].substring(0, 60)}`);
    if (c.refactors.length > 0) details.push(`refactor`);
    if (c.additions || c.deletions) details.push(`+${c.additions} -${c.deletions}`);
    bodyParts.push(fileLine + (details.length ? ` (${details.join(', ')})` : ''));
  }

  if (allBugfixes.length > 0) {
    const unique = [...new Set(allBugfixes)].slice(0, 5);
    bodyParts.push(`\n🐛 **Bug fixes**\n${unique.map(b => `- ${b.substring(0, 80)}`).join('\n')}`);
  }

  if (allFeatures.length > 0) {
    const unique = [...new Set(allFeatures)].slice(0, 5);
    bodyParts.push(`\n✨ **Features**\n${unique.map(f => `- ${f.substring(0, 80)}`).join('\n')}`);
  }

  const body = bodyParts.join('\n');

  return { subject, body };
}

// ── Insert message into SCM input ──
async function insertMessage(message: string, workspaceRoot: string): Promise<void> {
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt?.isActive) {
      const api = gitExt.exports.getAPI(1);
      if (api?.repositories) {
        const repo = api.repositories.find((r: any) => r.rootUri.fsPath === workspaceRoot)
          || api.repositories[0];
        if (repo) {
          repo.inputBox.value = message;
          return;
        }
      }
    }
  } catch { /* fallback to clipboard */ }

  // Fallback: if no staged changes, auto-stage all
  try {
    await execAsync('git add -A', { cwd: workspaceRoot, timeout: 10000 });
  } catch { /* ok */ }

  // Insert again after staging
  try {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (gitExt?.isActive) {
      const api = gitExt.exports.getAPI(1);
      if (api?.repositories) {
        const repo = api.repositories.find((r: any) => r.rootUri.fsPath === workspaceRoot)
          || api.repositories[0];
        if (repo) {
          repo.inputBox.value = message;
          return;
        }
      }
    }
  } catch { /* fallback */ }

  // Last resort: copy to clipboard
  await vscode.env.clipboard.writeText(message);
  vscode.window.showInformationMessage('Commit message copied to clipboard (SCM unavailable)');
}

// ── Full analysis report ──
async function showReport(analysis: DeepAnalysis, changes: FileChange[], subject: string): Promise<void> {
  const s = analysis.summary;
  let report = `# 🔍 Auto Commit Analysis\n\n`;
  report += `**Message:** \`${subject}\`\n\n`;
  report += '## 📊 Summary\n\n';
  report += `| Metric | Count |\n|--------|------:|\n`;
  report += `| Total Files | ${s.totalFiles} |\n`;
  report += `| New Files | ${s.newFiles} |\n`;
  report += `| Deleted | ${s.deletedFiles} |\n`;
  report += `| Modified | ${s.modifiedFiles} |\n`;
  report += `| Staged | ${s.stagedFiles} |\n`;
  report += `| Unstaged | ${s.unstagedFiles} |\n`;
  report += `| Additions | +${s.totalAdditions} |\n`;
  report += `| Deletions | -${s.totalDeletions} |\n\n`;

  if (analysis.languages.size > 0) {
    report += '## 💻 Languages\n' + [...analysis.languages].map(l => `- ${l}`).join('\n') + '\n\n';
  }
  if (analysis.frameworks.size > 0) {
    report += '## 🏗️ Frameworks\n' + [...analysis.frameworks].map(f => `- ${f}`).join('\n') + '\n\n';
  }
  if (analysis.components.length > 0) {
    report += '## 🧩 Components\n' + analysis.components.map(c => `- \`${c.name}\` → ${c.file}`).join('\n') + '\n\n';
  }
  if (analysis.functions.length > 0) {
    const shown = analysis.functions.slice(0, 20);
    report += '## 🔧 Functions\n' + shown.map(f => `- \`${f.name}()\` → ${f.file}`).join('\n');
    if (analysis.functions.length > 20) report += `\n- … and ${analysis.functions.length - 20} more`;
    report += '\n\n';
  }
  if (analysis.classes.length > 0) {
    report += '## 📦 Classes\n' + analysis.classes.map(c => `- \`${c.name}\` → ${c.file}`).join('\n') + '\n\n';
  }

  report += '## 📁 Changed Files\n';
  report += changes.map(c => {
    const icon = c.staged ? '📌' : '  ';
    return `- ${icon} \`${c.filePath}\` (${c.changeType})${c.additions ? ` +${c.additions}` : ''}${c.deletions ? ` -${c.deletions}` : ''}`;
  }).join('\n');

  report += '\n\n---\n*Generated by Auto Commit Message*';

  const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
  await vscode.window.showTextDocument(doc);
}

export function deactivate() {}
