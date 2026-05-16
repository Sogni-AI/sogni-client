/* eslint-disable */
// @ts-nocheck — this file's tsconfig uses moduleResolution: 'node' which cannot
// read modern `exports` maps at compile time. Runtime resolution via Node's
// exports-map require-condition resolves the subpath correctly; IDE intellisense
// follows package.json typesVersions. Type-check is suppressed on this file only.
//
// Back-compat re-export. New code should import directly from
// `@sogni-ai/sogni-intelligence-client/contracts`.

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
