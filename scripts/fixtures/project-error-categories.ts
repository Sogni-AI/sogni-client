import type { ErrorData, Job, Project } from '@sogni-ai/sogni-client';
import type { JobErrorData } from '../../dist/ApiClient/WebSocketClient/events.js';

// The published contract accepts all coarse categories carried by the server,
// including categories an older SDK or application does not yet recognize.
const categories = [
  'content_policy',
  'input_validation',
  'timeout',
  'result_storage',
  'cancelled',
  'vendor_failed',
  'asset_resolution',
  'vendor_transient',
  'future_category'
] as const;

for (const vendorFailureCategory of categories) {
  const error = { code: 5000, message: 'Generation failed', vendorFailureCategory };
  const publicError: ErrorData = error;
  const jobError: Job['error'] = error;
  const projectError: Project['error'] = error;
  const wire: JobErrorData = {
    jobID: 'project',
    isFromWorker: false,
    error: 5000,
    error_message: error.message,
    vendorFailureCategory
  };
  void [publicError, jobError, projectError, wire];
}

const legacy: ErrorData = { code: 5000, message: 'Generation failed' };
// @ts-expect-error A category remains an optional string, not a numeric code.
legacy.vendorFailureCategory = 123;
// @ts-expect-error A category does not accept detailed structured diagnostics.
legacy.vendorFailureCategory = { message: 'Generation failed' };
