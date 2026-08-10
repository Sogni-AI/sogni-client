// Regenerates scripts/fixtures/hosted-tool-alias-parity.generated.json.
//
// WHY THIS EXISTS
// ---------------
// The parity fixture is a golden vector (originally produced by
// @sogni/creative-agent) that proves the direct creative-agent tool aliases
// resolve to the hosted `creative-tools` API definitions the SDK mirrors from
// `@sogni-ai/sogni-protocol`. It carries two kinds of data per tool:
//
//   1. Alias-contract fields  — `creativeToolName`, `executionMode`,
//      `argumentAliasTargets`, `mediaAliasTargets`. These come from
//      creative-agent's `tool-aliases.json` and are NOT derivable from the
//      protocol manifest, so this generator PRESERVES them verbatim.
//   2. Protocol schema snapshots — `hostedSchemaSha256`, `hostedRequired`,
//      `hostedPropertyNames`. These are fingerprints of each hosted tool's
//      JSON-Schema and MUST track `@sogni-ai/sogni-protocol`. When protocol
//      bumps its tool schemas (e.g. new model enum values), these snapshots
//      drift and `scripts/check-chat-model-routing.cjs` goes red.
//
// Previously there was no generator, so the snapshots could silently desync
// from the pinned protocol. Run this after any `@sogni-ai/sogni-protocol` bump
// (and after `npm run build`, since it reads the built manifest):
//
//   npm run build && node scripts/generate-hosted-tool-alias-parity.mjs
//
// Use `--check` to fail (non-zero) instead of writing, for CI drift detection.
//
// SOURCE OF TRUTH: the SDK's `SogniTools.all` (dist), which is generated from
// `@sogni-ai/sogni-protocol/manifests/openai-tools.json` by
// scripts/generate-hosted-tools-manifest.mjs (plus its documented SDK-local
// compatibility patches). Snapshotting `SogniTools.all` guarantees the fixture
// matches exactly what the SDK ships and what the parity test checks.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { SogniTools } = require('../dist/Chat/tools.js');
const protocolVersion = require('@sogni-ai/sogni-protocol/package.json').version;

const fixturePath = join(
  process.cwd(),
  'scripts',
  'fixtures',
  'hosted-tool-alias-parity.generated.json'
);
const checkOnly = process.argv.includes('--check');

// Must match scripts/check-chat-model-routing.cjs byte-for-byte so the
// snapshots we write are exactly what the parity test recomputes.
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableValue(entryValue)])
  );
}

function sha256(value) {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const sdkToolsByName = new Map(SogniTools.all.map((tool) => [tool.function.name, tool]));

const violations = [];
const changes = [];

const nextTools = fixture.tools.map((vector) => {
  const tool = sdkToolsByName.get(vector.hostedToolName);
  if (!tool) {
    violations.push(
      `SDK is missing hosted tool "${vector.hostedToolName}" (present in the fixture)`
    );
    return vector;
  }

  const parameters = tool.function.parameters || {};
  const properties = parameters.properties || {};
  const propertyNames = Object.keys(properties);

  // Alias targets are the meaningful contract: every aliased argument/media
  // field MUST still exist as a property. A missing one is a real breaking
  // change in the protocol schema, not a snapshot to silently refresh.
  for (const target of [...vector.argumentAliasTargets, ...vector.mediaAliasTargets]) {
    if (!Object.prototype.hasOwnProperty.call(properties, target)) {
      violations.push(
        `${vector.hostedToolName}: alias target "${target}" no longer exists on the hosted schema`
      );
    }
  }

  const nextVector = {
    creativeToolName: vector.creativeToolName,
    executionMode: vector.executionMode,
    hostedToolName: vector.hostedToolName,
    sdkToolName: vector.sdkToolName,
    hostedSchemaSha256: sha256({ name: tool.function.name, parameters }),
    hostedRequired: parameters.required || [],
    hostedPropertyNames: propertyNames,
    argumentAliasTargets: vector.argumentAliasTargets,
    mediaAliasTargets: vector.mediaAliasTargets
  };

  if (nextVector.hostedSchemaSha256 !== vector.hostedSchemaSha256) {
    const added = propertyNames.filter((name) => !vector.hostedPropertyNames.includes(name));
    const removed = vector.hostedPropertyNames.filter((name) => !propertyNames.includes(name));
    const detail = [];
    if (added.length) detail.push(`+props: ${added.join(', ')}`);
    if (removed.length) detail.push(`-props: ${removed.join(', ')}`);
    if (!arraysEqual(vector.hostedRequired, nextVector.hostedRequired)) {
      detail.push(`required: [${vector.hostedRequired}] -> [${nextVector.hostedRequired}]`);
    }
    changes.push(
      `  ${vector.hostedToolName}: schema fingerprint changed${detail.length ? ` (${detail.join('; ')})` : ' (values/enums only)'}`
    );
  }

  return nextVector;
});

if (violations.length) {
  console.error('Refusing to regenerate — alias-contract violations found:');
  for (const violation of violations) console.error(`  - ${violation}`);
  console.error('\nThis indicates a genuine breaking change in @sogni-ai/sogni-protocol.');
  console.error('Reconcile the SDK alias layer / creative-agent tool-aliases before regenerating.');
  process.exit(1);
}

if (!changes.length) {
  console.log(
    `Parity fixture already in sync with @sogni-ai/sogni-protocol@${protocolVersion}. No changes.`
  );
  process.exit(0);
}

console.log(`Protocol: @sogni-ai/sogni-protocol@${protocolVersion}`);
console.log('Schema snapshot changes:');
for (const change of changes) console.log(change);

if (checkOnly) {
  console.error('\n--check: parity fixture is OUT OF SYNC. Run without --check to regenerate.');
  process.exit(1);
}

const next = {
  version: fixture.version,
  source: fixture.source,
  description: fixture.description,
  tools: nextTools
};

await writeFile(fixturePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
console.log(`\nWrote ${fixturePath} (${nextTools.length} tools).`);
