/**
 * Regression tests for the hosts `mediaInputToInlineDataUri` will fetch.
 *
 * Chat vision and the SDK-side chat tools turn an HTTPS link to Sogni-hosted
 * media into an inline data URI before sending it. Sogni's signed result and
 * upload links are served from S3 Transfer Acceleration hosts
 * (`<bucket>.s3-accelerate.amazonaws.com`) and, after the move to Cloudflare
 * R2, from four exact R2 bucket hosts on Sogni's account. Anything else on
 * `r2.cloudflarestorage.com` or `r2.dev` belongs to some other Cloudflare
 * customer and must be refused like any other remote URL.
 *
 * Runs against compiled `dist/` output, like the sibling check-* scripts.
 */

'use strict';

const assert = require('node:assert/strict');

const { mediaInputToInlineDataUri } = require('../dist/lib/mediaValidation.js');

const R2_ACCOUNT_HOST = '234df6a88ee221ecac622f8b1a9609e0.r2.cloudflarestorage.com';
const R2_OUTPUT_HOSTS = [
  `generation-output-production.${R2_ACCOUNT_HOST}`,
  `generation-output-staging.${R2_ACCOUNT_HOST}`
];
const R2_INPUT_HOSTS = [
  `generation-input-production.${R2_ACCOUNT_HOST}`,
  `generation-input-staging.${R2_ACCOUNT_HOST}`
];
const S3_ACCELERATE_HOSTS = [
  'complete-images-production.s3-accelerate.amazonaws.com',
  'complete-images-staging.s3-accelerate.amazonaws.com',
  'artist-upload-production.s3-accelerate.amazonaws.com',
  'artist-upload-staging.s3-accelerate.amazonaws.com',
  'complete-images-production.s3-accelerate.dualstack.amazonaws.com'
];
// Hosts that were already trusted; kept here so the change cannot drop them.
const EXISTING_TRUSTED_HOSTS = [
  'cdn.sogni.ai',
  'complete-images-production.s3.amazonaws.com',
  'complete-images-production.s3.us-east-1.amazonaws.com'
];

const REFUSED_HOSTS = [
  // The same bucket name on another Cloudflare account.
  'generation-output-production.ffffffffffffffffffffffffffffffff.r2.cloudflarestorage.com',
  'generation-input-production.ffffffffffffffffffffffffffffffff.r2.cloudflarestorage.com',
  // Another bucket on Sogni's account.
  `attacker-bucket.${R2_ACCOUNT_HOST}`,
  `generation-output-dev.${R2_ACCOUNT_HOST}`,
  // The bare account host and the shared R2 suffix.
  R2_ACCOUNT_HOST,
  'r2.cloudflarestorage.com',
  // Public r2.dev buckets.
  'pub-0123456789abcdef0123456789abcdef.r2.dev',
  'generation-output-production.r2.dev',
  // Suffix and prefix tricks.
  `generation-output-production.${R2_ACCOUNT_HOST}.evil.example`,
  `evil-generation-output-production.${R2_ACCOUNT_HOST}`,
  `x.generation-output-production.${R2_ACCOUNT_HOST}`,
  'complete-images-production.s3-accelerate.amazonaws.com.evil.example',
  'complete-images-production.s3-accelerate.amazonaws.co',
  's3-accelerate.amazonaws.com',
  'evil.example'
];

// A valid 1x1 PNG, so an accepted URL passes the inline-image validation.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

const signedUrl = (host) =>
  `https://${host}/2026-09-29/job-1/image.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=abc`;

const fetchCalls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  return new Response(PNG_1X1, {
    status: 200,
    headers: { 'content-type': 'image/png', 'content-length': String(PNG_1X1.length) }
  });
};

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function expectFetched(url) {
  fetchCalls.length = 0;
  const dataUri = await mediaInputToInlineDataUri(url, 'image');
  assert.equal(dataUri, `data:image/png;base64,${PNG_1X1.toString('base64')}`);
  assert.equal(fetchCalls.length, 1, 'expected exactly one fetch');
  assert.equal(new URL(fetchCalls[0].url).href, new URL(url).href);
  assert.equal(fetchCalls[0].init.redirect, 'error');
}

async function expectRefused(url) {
  fetchCalls.length = 0;
  await assert.rejects(
    () => mediaInputToInlineDataUri(url, 'image'),
    /remote URLs are not allowed/
  );
  assert.equal(fetchCalls.length, 0, 'a refused URL must never be fetched');
}

async function main() {
  for (const host of R2_OUTPUT_HOSTS) {
    await check(`fetches R2 output host ${host}`, () => expectFetched(signedUrl(host)));
  }
  for (const host of R2_INPUT_HOSTS) {
    await check(`fetches R2 input host ${host}`, () => expectFetched(signedUrl(host)));
  }
  await check('matches an upper-cased R2 host', () =>
    expectFetched(signedUrl(R2_OUTPUT_HOSTS[0].toUpperCase()))
  );
  for (const host of S3_ACCELERATE_HOSTS) {
    await check(`fetches S3 Transfer Acceleration host ${host}`, () =>
      expectFetched(signedUrl(host))
    );
  }
  for (const host of EXISTING_TRUSTED_HOSTS) {
    await check(`still fetches ${host}`, () => expectFetched(signedUrl(host)));
  }

  for (const host of REFUSED_HOSTS) {
    await check(`refuses ${host}`, () => expectRefused(signedUrl(host)));
  }
  await check('refuses a Sogni R2 host over plain http', () =>
    expectRefused(signedUrl(R2_OUTPUT_HOSTS[0]).replace('https://', 'http://'))
  );
  await check('refuses a Sogni R2 host with embedded credentials', () =>
    expectRefused(signedUrl(`user:pass@${R2_OUTPUT_HOSTS[0]}`))
  );
  await check('refuses an S3 Transfer Acceleration host over plain http', () =>
    expectRefused(signedUrl(S3_ACCELERATE_HOSTS[0]).replace('https://', 'http://'))
  );
  await check('refuses a Sogni host named only in the path', () =>
    expectRefused(`https://evil.example/${R2_OUTPUT_HOSTS[0]}/image.png`)
  );

  console.log(`remote media host checks passed (${passed} checks)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
