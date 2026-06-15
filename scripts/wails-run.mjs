import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);

if (!args.length) {
  console.error('Usage: node scripts/wails-run.mjs <wails args...>');
  process.exit(1);
}

const env = { ...process.env };
const goEnv = spawnSync('go', ['env', 'GOPATH'], { encoding: 'utf8' });
const goPath = goEnv.status === 0 ? goEnv.stdout.trim() : join(homedir(), 'go');
const goBin = join(goPath, 'bin');
const localWails = join(goBin, process.platform === 'win32' ? 'wails.exe' : 'wails');
const command = existsSync(localWails) ? localWails : (process.platform === 'win32' ? 'wails.exe' : 'wails');

env.PATH = [goBin, env.PATH || ''].filter(Boolean).join(delimiter);

const child = spawnSync(command, args, {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32'
});

if (child.error) {
  console.error(child.error.message);
  process.exit(1);
}
process.exit(child.status ?? 1);
