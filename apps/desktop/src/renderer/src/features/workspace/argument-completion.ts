import { isRecordableCommand } from '../../../../shared/history.js';
export interface ArgumentCompletion {
  command: string;
  description: string;
}
const catalog: Record<string, readonly (readonly [string, string])[]> = {
  git: [
    ['status', 'Show working-tree changes'],
    ['log', 'Show commit history'],
    ['diff', 'Show changes between versions'],
    ['show', 'Show an object or commit'],
    ['branch', 'List or manage branches'],
    ['help', 'Open Git help'],
    ['--help', 'Show Git help'],
    ['--version', 'Show the Git version'],
  ],
  'git status': [
    ['--short', 'Use short status output'],
    ['--branch', 'Include branch and tracking information'],
    ['--porcelain', 'Use stable machine-readable output'],
    ['--ignored', 'Include ignored files'],
  ],
  'git log': [
    ['--oneline', 'Show one line per commit'],
    ['--graph', 'Draw the commit graph'],
    ['--all', 'Include all refs'],
    ['--decorate', 'Show ref names'],
    ['--stat', 'Show change statistics'],
  ],
  'git diff': [
    ['--stat', 'Show change statistics'],
    ['--name-only', 'Show changed filenames'],
    ['--name-status', 'Show filenames and change types'],
    ['--cached', 'Show staged changes'],
    ['--check', 'Check for whitespace errors'],
  ],
  'git show': [
    ['--stat', 'Show change statistics'],
    ['--name-only', 'Show changed filenames'],
    ['--oneline', 'Use a one-line commit header'],
  ],
  'git branch': [
    ['--all', 'Include remote-tracking branches'],
    ['--remotes', 'List remote-tracking branches'],
    ['--verbose', 'Include commit information'],
  ],
  npm: [
    ['install', 'Install project dependencies'],
    ['ci', 'Install from the lockfile'],
    ['run', 'Run a package script'],
    ['test', 'Run the package test script'],
    ['outdated', 'List outdated dependencies'],
    ['list', 'List installed dependencies'],
    ['help', 'Open npm help'],
  ],
  'npm install': [
    ['--save-dev', 'Save as a development dependency'],
    ['--ignore-scripts', 'Skip lifecycle scripts'],
    ['--package-lock-only', 'Update only the lockfile'],
  ],
  'npm ci': [
    ['--ignore-scripts', 'Skip lifecycle scripts'],
    ['--no-audit', 'Do not submit an audit report'],
  ],
  'npm run': [
    ['--if-present', 'Do not fail when the script is missing'],
    ['--silent', 'Reduce npm log output'],
  ],
  'npm test': [['--silent', 'Reduce npm log output']],
  ls: [
    ['-a', 'Include hidden entries'],
    ['-l', 'Use long listing output'],
    ['-h', 'Use human-readable sizes with long output'],
    ['-d', 'List directories themselves'],
    ['-R', 'List subdirectories recursively'],
  ],
};

// shortcut: options before operands only; extend command grammars with tested value/operand rules.
export function argumentCompletions(prefix: string): ArgumentCompletion[] {
  if (!isRecordableCommand(prefix) || !/^[A-Za-z0-9_. -]+$/u.test(prefix) || prefix.startsWith(' '))
    return [];
  const words = prefix.split(/ +/u);
  if (words.length < 2) return [];
  const partial = words.pop()!;
  const command = words.shift()!;
  const subcommand =
    (command === 'git' || command === 'npm') && words.length ? words.shift() : undefined;
  const context = subcommand === undefined ? command : `${command} ${subcommand}`;
  if (!Object.hasOwn(catalog, context)) return [];
  const entries = catalog[context]!;
  if (words.some((word) => !word.startsWith('-') || !entries.some(([value]) => value === word)))
    return [];
  const before = prefix.slice(0, prefix.length - partial.length);
  return entries
    .filter(
      ([value]) =>
        value.startsWith(partial) && value.length > partial.length && !words.includes(value),
    )
    .map(([value, description]) => ({ command: before + value, description }));
}
