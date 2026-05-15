#!/usr/bin/env node
// Sync the hosted Sogni creative-tools manifest from @sogni/creative-agent into
// the public SDK. Combines generation-tools.json (18 tools) and
// composition-tools.json (4 tools) into a single
// `src/Chat/sogniHostedTools.generated.json` so SDK consumers see the full
// canonical hosted creative-tools surface without depending on the private
// creative-agent package.
//
// Usage:
//   node scripts/sync-hosted-tools-manifest.mjs          # write
//   node scripts/sync-hosted-tools-manifest.mjs --check  # verify committed copy matches upstream

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const creativeAgentRoot = process.env.SOGNI_CREATIVE_AGENT_DIR
  ? process.env.SOGNI_CREATIVE_AGENT_DIR
  : join(root, '..', 'sogni-creative-agent');

const upstreamFiles = [
  'src/backbone/openai-tools/generation-tools.json',
  'src/backbone/openai-tools/composition-tools.json'
];

const outputRelative = 'src/Chat/sogniHostedTools.generated.json';
const outputPath = join(root, outputRelative);

const sources = upstreamFiles.map((rel) => {
  const abs = join(creativeAgentRoot, rel);
  if (!existsSync(abs)) {
    console.error(`Upstream tool manifest not found at ${abs}.`);
    console.error('Set SOGNI_CREATIVE_AGENT_DIR or check out @sogni/creative-agent as a sibling repo.');
    process.exit(1);
  }
  return { rel, abs, data: JSON.parse(readFileSync(abs, 'utf8')) };
});

const versions = sources
  .map((s) => s.data.version)
  .filter((v) => typeof v === 'string' && v.length > 0);
const compositeVersion = versions.length > 0 ? versions.join('+') : new Date().toISOString().slice(0, 10);

const tools = [];
const seen = new Set();
for (const src of sources) {
  if (!Array.isArray(src.data.tools)) continue;
  for (const tool of src.data.tools) {
    const name = tool?.function?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    tools.push(tool);
  }
}

const manifest = {
  version: compositeVersion,
  source: '@sogni/creative-agent hosted creative-tools surface (generation + composition)',
  upstreamFiles,
  tools
};

const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

const checkMode = process.argv.includes('--check');

if (checkMode) {
  if (!existsSync(outputPath)) {
    console.error(`Missing generated manifest: ${outputRelative}`);
    console.error('Run `npm run sync:hosted-tools-manifest` to create it.');
    process.exit(1);
  }
  const current = readFileSync(outputPath, 'utf8');
  if (current !== serialized) {
    console.error(`${outputRelative} is out of sync with @sogni/creative-agent.`);
    console.error('Run `npm run sync:hosted-tools-manifest` to refresh.');
    process.exit(1);
  }
  console.log(`${outputRelative} is in sync (${tools.length} tools).`);
  process.exit(0);
}

writeFileSync(outputPath, serialized);
console.log(`Wrote ${outputRelative} (${tools.length} tools, version ${compositeVersion}).`);
