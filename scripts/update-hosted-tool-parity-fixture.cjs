// Refresh the SDK schema snapshot after reviewing a protocol/compatibility update.
// Alias mappings remain owned by creative-agent. SDK-local compatibility patches
// intentionally make its public schema differ from the unpatched hosted schema.
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { SogniTools } = require('../dist/Chat/tools.js');

const fixturePath = join(__dirname, 'fixtures/hosted-tool-alias-parity.generated.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const byName = new Map(SogniTools.all.map((tool) => [tool.function.name, tool.function]));
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stable(item)]));
};

for (const vector of fixture.tools) {
  const tool = byName.get(vector.hostedToolName);
  if (!tool) throw new Error(`Missing SDK hosted tool: ${vector.hostedToolName}`);
  const parameters = tool.parameters || {};
  const properties = parameters.properties || {};
  for (const target of [...vector.argumentAliasTargets, ...vector.mediaAliasTargets]) {
    if (!Object.prototype.hasOwnProperty.call(properties, target)) {
      throw new Error(`Missing alias target ${vector.hostedToolName}.${target}`);
    }
  }
  vector.hostedSchemaSha256 = createHash('sha256')
    .update(JSON.stringify(stable({ name: tool.name, parameters }))).digest('hex');
  vector.hostedRequired = parameters.required || [];
  vector.hostedPropertyNames = Object.keys(properties);
}
writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
console.log('Updated SDK schema snapshots; retained canonical alias mappings.');
