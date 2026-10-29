/**
 * Creates a Chrome Web Store-ready zip from the dist/ folder.
 * Source maps (.map files) are excluded to reduce package size.
 *
 * Usage:  node scripts/pack.mjs
 * Or via: npm run pack   (runs build:prod first)
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = join(root, 'dist');
const outPath = join(root, 'storagedump.zip');

function walkDir(dir, zip, base) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    const relPath = relative(base, fullPath);
    if (statSync(fullPath).isDirectory()) {
      walkDir(fullPath, zip, base);
    } else if (!relPath.endsWith('.map')) {
      zip.file(relPath, readFileSync(fullPath));
    }
  }
}

const zip = new JSZip();
walkDir(distDir, zip, distDir);

const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
});

writeFileSync(outPath, buffer);
console.log(`✓  storagedump.zip  (${(buffer.length / 1024).toFixed(1)} KB)`);
