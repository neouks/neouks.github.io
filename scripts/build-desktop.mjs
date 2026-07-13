import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const TARGETS = {
  mac: {
    label: 'macOS universal',
    platform: 'darwin/universal',
    extraArgs: []
  },
  windows: {
    label: 'Windows x64 + NSIS',
    platform: 'windows/amd64',
    extraArgs: ['-nsis', '-webview2', 'download']
  }
};

const usage = `Usage:
  npm run build:desktop
  npm run build:desktop -- --target mac
  npm run build:desktop -- --target windows
  npm run build:desktop -- --target all --upx
  npm run build:desktop -- --target all --no-optimize

Options:
  --target <all|mac|windows>  Build target. Defaults to all.
  --upx                       Compress final binaries with UPX if installed.
  --no-optimize               Disable size optimization flags.
  --dry-run                   Print Wails build commands only.
  --help                      Show this help.
`;

let target = 'all';
let optimize = true;
let useUpx = false;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--help' || arg === '-h') {
    console.log(usage);
    process.exit(0);
  }
  if (arg === '--target') {
    target = args[++i] || '';
    continue;
  }
  if (arg.startsWith('--target=')) {
    target = arg.slice('--target='.length);
    continue;
  }
  if (arg === '--no-optimize') {
    optimize = false;
    continue;
  }
  if (arg === '--upx') {
    useUpx = true;
    continue;
  }
  if (arg === '--dry-run') {
    dryRun = true;
    continue;
  }
  console.error(`Unknown option: ${arg}\n`);
  console.error(usage);
  process.exit(1);
}

const selectedTargets = target === 'all' ? ['mac', 'windows'] : [target];
const invalidTarget = selectedTargets.find(item => !TARGETS[item]);

if (invalidTarget) {
  console.error(`Invalid target: ${invalidTarget}`);
  console.error(usage);
  process.exit(1);
}

if (useUpx && !commandExists(process.platform === 'win32' ? 'upx.exe' : 'upx')) {
  console.warn('UPX was requested, but the upx command was not found. Continuing without -upx.');
  useUpx = false;
}

const optimizeArgs = optimize ? ['-trimpath', '-ldflags', '-s -w'] : [];
const upxArgs = useUpx ? ['-upx', '-upxflags', '--best --lzma'] : [];

for (const [index, key] of selectedTargets.entries()) {
  const config = TARGETS[key];
  const wailsArgs = [
    'build',
    ...(index === 0 ? ['-clean'] : []),
    '-platform',
    config.platform,
    ...optimizeArgs,
    ...upxArgs,
    ...config.extraArgs
  ];

  console.log(`\n==> Building ${config.label}`);
  console.log(`node scripts/wails-run.mjs ${quoteArgs(wailsArgs)}`);

  if (dryRun) continue;

  const result = spawnSync(process.execPath, ['scripts/wails-run.mjs', ...wailsArgs], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('\nDesktop build complete. Output: build/bin/');

function commandExists(command) {
  const pathEntries = (process.env.PATH || '').split(delimiter).filter(Boolean);
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';')
    : [''];
  const names = /\.[^\\/]+$/.test(command)
    ? [command]
    : extensions.map(ext => `${command}${ext.toLowerCase()}`);
  return pathEntries.some(dir => names.some(name => existsSync(join(dir, name))));
}

function quoteArgs(items) {
  return items.map(item => (/\s/.test(item) ? JSON.stringify(item) : item)).join(' ');
}
