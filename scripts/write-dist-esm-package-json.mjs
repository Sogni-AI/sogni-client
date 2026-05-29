#!/usr/bin/env node
// Writes `dist-esm/package.json` containing only `{ "type": "module" }`.
// Node's resolver treats `.js` files in a directory tree as CommonJS unless
// the closest enclosing package.json sets `type: "module"`. Without this
// marker, Node ESM consumers importing `dist-esm/index.js` (via the package
// exports map) hit a "Unexpected token 'export'" parse error.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const target = join(root, 'dist-esm', 'package.json');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ type: 'module' }, null, 2)}\n`);
console.log(`Wrote ${target}`);
