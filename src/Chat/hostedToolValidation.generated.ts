/* eslint-disable */
// @ts-nocheck — wrapper's tsconfig (and this file's) uses moduleResolution: 'node'
// (cannot read modern `exports` map at COMPILE time). At RUNTIME Node's
// exports-map require-condition resolves the subpath cleanly. The actual types
// resolve via the package's typesVersions for IDE intellisense; the type-check
// pass over this file is suppressed.
/**
 * Re-export shim for hosted tool validation. The validation logic now lives in
 * `@sogni-ai/sogni-intelligence-client/contracts`; this file remains so existing
 * internal callers (e.g. src/Chat/modelRouting.ts) keep working. New code should
 * import directly from `@sogni-ai/sogni-intelligence-client/contracts`.
 */

export type {
  HostedToolSchemaProperty,
  HostedToolSchema,
  HostedToolDefinition,
  ValidateHostedToolArgumentsOptions,
  HostedToolArgumentValidationResult,
  NormalizeHostedToolArgumentsResult
} from '@sogni-ai/sogni-intelligence-client/contracts';
export {
  validateAndNormalizeHostedToolArguments,
  validateHostedToolArguments,
  assertHostedToolArguments
} from '@sogni-ai/sogni-intelligence-client/contracts';
