import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await Promise.all([
  cp(join(root, 'index.html'), join(dist, 'index.html')),
  cp(join(root, 'web-vendor'), join(dist, 'web-vendor'), { recursive: true }),
  build({
    entryPoints: [join(root, 'app.js')],
    outfile: join(dist, 'app.js'),
    bundle: true,
    format: 'iife',
    target: ['chrome105', 'edge105', 'safari15'],
    minify: true,
    legalComments: 'none',
    charset: 'utf8'
  }),
  build({
    entryPoints: [join(root, 'styles.css')],
    outfile: join(dist, 'styles.css'),
    bundle: true,
    minify: true,
    legalComments: 'none'
  })
]);

console.log(`Built static frontend: ${dist}`);
for (const relativePath of ['index.html', 'styles.css', 'app.js', 'web-vendor/chart.umd.js', 'web-vendor/xlsx.full.min.js']) {
  const path = join(dist, relativePath);
  const [info, content] = await Promise.all([stat(path), readFile(path)]);
  const brotliSize = brotliCompressSync(content, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 }
  }).byteLength;
  console.log(`  ${relativePath.padEnd(31)} ${formatBytes(info.size).padStart(9)} raw  ${formatBytes(brotliSize).padStart(9)} br`);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}
