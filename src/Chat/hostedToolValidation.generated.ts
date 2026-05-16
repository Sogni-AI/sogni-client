/* eslint-disable */
// @ts-nocheck — wrapper's tsconfig (and this file's) uses moduleResolution: 'node'
// (cannot read modern `exports` map at COMPILE time). At RUNTIME Node's
// exports-map require-condition resolves the subpath cleanly. The actual types
// resolve via the package's typesVersions for IDE intellisense; the type-check
// pass over this file is suppressed.
/**
 * Phase 8.3 of the Creative Agent Master Plan: this file used to be a
 * generated copy of the validator from
 * @sogni/creative-agent/src/backbone/reference/toolValidation.ts (synced via
 * `scripts/sync-hosted-tool-validation.mjs`). The same validation logic is now
 * carved out into `@sogni-ai/sogni-intelligence-client/contracts` (Phase 8.3-prep
 * moved it from backbone/reference to contracts/hostedToolValidation.ts in
 * @sogni/creative-agent itself, then the public mid-tier re-exports it).
 *
 * This file remains as a thin re-export shim so existing internal callers
 * (src/Chat/modelRouting.ts, anything else still using `./hostedToolValidation.generated`)
 * keep working. New code should import directly from
 * `@sogni-ai/sogni-intelligence-client/contracts`.
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
