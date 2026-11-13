#!/usr/bin/env node
/**
 * Transport checks for `sogni.changelog.*` (`/v1/changelog`).
 *
 * The SDK must read the public changelog from a client that is not signed in
 * without sending credentials, send every filter under its wire name (lists
 * comma-separated, `actionRequired` only when true, the cursor as given),
 * unwrap each response, and surface the API's errors as `ApiError`, including
 * the 404 / errorCode 204 of an unknown entry.
 *
 * Run: npm run test:changelog
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SogniClient, ApiError } = require('../dist/index.js');

const BASE = 'https://api.example.test';

const ENTRY = {
  id: '2026-11-10-sdk-js-javascript-sdk-5-80-0',
  url: 'https://www.sogni.ai/changelog/2026-11-10-sdk-js-javascript-sdk-5-80-0',
  title: 'JavaScript SDK 5.80.0',
  summary: 'projects: type and send opt-in SAM 3 video selection options',
  bodyMarkdown: '### Features',
  type: 'release',
  audiences: ['developer'],
  products: ['sdk-js'],
  version: '5.80.0',
  links: [
    {
      label: 'GitHub release',
      url: 'https://github.com/Sogni-AI/sogni-client/releases/tag/v5.80.0'
    }
  ],
  actionRequired: false,
  effectiveAt: null,
  publishedAt: '2026-11-10T12:00:00.000Z',
  updatedAt: '2026-11-10T12:00:00.000Z'
};

const realFetch = globalThis.fetch;
let calls = [];
let nextResponse;
function respondWith(status, payload, headers = {}) {
  nextResponse = { status, payload, headers };
}
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method ?? 'GET', init });
  const { status, payload, headers } = nextResponse;
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
};

async function check(name, fn) {
  calls = [];
  await fn();
  console.log(`  ok - ${name}`);
}

function query(call) {
  return Object.fromEntries(new URL(call.url).searchParams);
}

async function run() {
  // A REST-only client that never signed in: the changelog needs no account.
  const sogni = await SogniClient.createInstance({ disableSocket: true, restEndpoint: BASE });

  await check('list reads the first page without credentials and unwraps data', async () => {
    respondWith(200, { status: 'success', data: { entries: [ENTRY], nextCursor: 'next-1' } });
    const page = await sogni.changelog.list();
    assert.deepEqual(page, { entries: [ENTRY], nextCursor: 'next-1' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/v1/changelog`);
    assert.equal(calls[0].method, 'GET');
    const headers = calls[0].init.headers ?? {};
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers['api-key'], undefined);
    assert.equal(calls[0].init.credentials, undefined);
  });

  await check('list sends every filter under its wire name', async () => {
    respondWith(200, { status: 'success', data: { entries: [], nextCursor: null } });
    const page = await sogni.changelog.list({
      audience: ['developer', 'worker'],
      product: 'sdk-js',
      type: ['release', 'deprecated'],
      since: '2026-11-01',
      until: '2026-11-13T09:00:00-08:00',
      actionRequired: true,
      limit: 3,
      cursor: 'eyJwIjoiMjAyNi0xMS0xMFQxMjowMDowMC4wMDBaIn0'
    });
    assert.deepEqual(page, { entries: [], nextCursor: null });
    assert.deepEqual(query(calls[0]), {
      audience: 'developer,worker',
      product: 'sdk-js',
      type: 'release,deprecated',
      since: '2026-11-01',
      until: '2026-11-13T09:00:00-08:00',
      actionRequired: 'true',
      limit: '3',
      cursor: 'eyJwIjoiMjAyNi0xMS0xMFQxMjowMDowMC4wMDBaIn0'
    });
    // The offset sign survives encoding; a raw '+' would read as a space.
    assert.match(calls[0].url, /until=2026-11-13T09%3A00%3A00-08%3A00/);
  });

  await check(
    'list sends single values as given and leaves actionRequired out unless true',
    async () => {
      respondWith(200, { status: 'success', data: { entries: [], nextCursor: null } });
      await sogni.changelog.list({
        audience: 'artist',
        product: ['create', 'api'],
        actionRequired: false
      });
      assert.deepEqual(query(calls[0]), { audience: 'artist', product: 'create,api' });
      await sogni.changelog.list({ since: '2026-11-01T17:00:00+00:00' });
      assert.equal(query(calls[1]).since, '2026-11-01T17:00:00+00:00');
    }
  );

  await check('get reads one entry by its encoded id', async () => {
    respondWith(200, { status: 'success', data: { entry: ENTRY } });
    assert.deepEqual(await sogni.changelog.get(ENTRY.id), ENTRY);
    assert.equal(calls[0].url, `${BASE}/v1/changelog/${ENTRY.id}`);
    await sogni.changelog.get('a/b c');
    assert.equal(calls[1].url, `${BASE}/v1/changelog/a%2Fb%20c`);
  });

  await check('an unknown entry surfaces the API 404 with errorCode 204', async () => {
    respondWith(404, { status: 'error', errorCode: 204, message: 'Changelog entry not found' });
    await assert.rejects(sogni.changelog.get('does-not-exist'), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      assert.equal(error.payload.errorCode, 204);
      assert.equal(error.message, 'Changelog entry not found');
      return true;
    });
  });

  await check('an empty id reaches the list, not an entry, and reads as not found', async () => {
    respondWith(200, { status: 'success', data: { entries: [ENTRY], nextCursor: null } });
    await assert.rejects(sogni.changelog.get(''), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      assert.equal(error.payload.errorCode, 204);
      return true;
    });
    assert.equal(calls[0].url, `${BASE}/v1/changelog/`);
  });

  await check('products reads the product list', async () => {
    const products = [
      { id: 'create', label: 'Sogni Create', audiences: ['artist'] },
      { id: 'sdk-js', label: 'JavaScript SDK', audiences: ['developer'] }
    ];
    respondWith(200, { status: 'success', data: { products } });
    assert.deepEqual(await sogni.changelog.products(), products);
    assert.equal(calls[0].url, `${BASE}/v1/changelog/products`);
  });

  await check("the API's own message, status and retry wait survive an error", async () => {
    respondWith(400, {
      status: 'error',
      errorCode: 102,
      message: 'limit must be a positive integer'
    });
    await assert.rejects(sogni.changelog.list({ limit: 0 }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 400);
      assert.equal(error.payload.errorCode, 102);
      assert.equal(error.message, 'limit must be a positive integer');
      return true;
    });
    assert.equal(query(calls[0]).limit, '0');
    respondWith(
      503,
      { status: 'error', errorCode: 135, message: 'The changelog is temporarily unavailable' },
      { 'Retry-After': '60' }
    );
    await assert.rejects(sogni.changelog.products(), (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.retryAfter, 60);
      return true;
    });
  });

  sogni.dispose();

  await check('the changelog types are exported from the package root', async () => {
    const declarations = fs.readFileSync(path.join(__dirname, '../dist/index.d.ts'), 'utf8');
    const block = declarations.match(/export type \{([^}]*)\} from '\.\/Changelog\/types\.js';/);
    assert.ok(block, 'the root declarations must re-export ./Changelog/types.js');
    const names = block[1]
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    for (const name of [
      'ChangelogAudience',
      'ChangelogEntry',
      'ChangelogEntryType',
      'ChangelogLink',
      'ChangelogProduct',
      'ListChangelogOptions',
      'ListChangelogResult'
    ]) {
      assert.ok(names.includes(name), `${name} must be exported from the package root`);
    }
    assert.match(declarations, /\bchangelog: ChangelogApi;/);
  });
}

run()
  .then(() => {
    globalThis.fetch = realFetch;
    console.log('changelog API checks passed');
  })
  .catch((error) => {
    globalThis.fetch = realFetch;
    console.error(error);
    process.exit(1);
  });
