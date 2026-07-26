// Copies the three.js browser build out of node_modules into public/vendor so
// the client has no runtime CDN dependency. Run after `npm install`.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'three', 'build');
const dest = path.join(root, 'public', 'vendor', 'three');
const files = ['three.module.min.js', 'three.core.min.js'];

if (!fs.existsSync(src)) {
  console.error('three.js not found in node_modules — run `npm install` first.');
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(src, f), path.join(dest, f));
  console.log(`vendored ${f}`);
}
