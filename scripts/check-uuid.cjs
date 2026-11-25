/**
 * Regression test for the SDK's id generator (src/lib/getUUID.ts).
 *
 * Every id stays an uppercase version 4 UUID (the Mac app expects uppercase),
 * comes from the runtime's cryptographically secure generator, and is
 * independent of the ids generated before it: no long run of hex digits from
 * one id reappears in any of the next 256. A generator that slides a window
 * over one shared random buffer makes neighbours share runs of 15 to 24 of the
 * 32 digits and fails here. Math.random is never consulted, and a runtime
 * without Web Crypto throws instead of degrading.
 *
 * Runs against compiled `dist/`.
 */

'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');

const getUUID = require('../dist/lib/getUUID.js').default;

const UPPERCASE_V4 = /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const NEIGHBOURS = 256;
// Independent ids share a longer run by chance about once in 100,000 runs of this whole check.
const MAX_SHARED_HEX_RUN = 10;

function longestSharedRun(a, b) {
  let best = 0;
  const previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      if (previous[j] > best) best = previous[j];
      diagonal = above;
    }
  }
  return best;
}

function assertIndependent(ids, label) {
  const digits = ids.map((id) => id.replace(/-/g, ''));
  let worst = 0;
  for (let i = 0; i < digits.length; i++) {
    for (let j = i + 1; j <= i + NEIGHBOURS && j < digits.length; j++) {
      const run = longestSharedRun(digits[i], digits[j]);
      if (run > worst) worst = run;
      assert.ok(
        run <= MAX_SHARED_HEX_RUN,
        `${label}: ids ${i} and ${j} share a ${run}-digit run (${ids[i]} / ${ids[j]})`
      );
    }
  }
  return worst;
}

function withGlobalCrypto(value, fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    else delete globalThis.crypto;
  }
}

function withoutMathRandom(fn) {
  const original = Math.random;
  Math.random = () => {
    throw new Error('Math.random must not be used for ids');
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

function generate(count) {
  return withoutMathRandom(() => Array.from({ length: count }, () => getUUID()));
}

// 1. Default runtime (Node 22: crypto.randomUUID).
assert.equal(
  typeof globalThis.crypto?.randomUUID,
  'function',
  'premise: Node exposes crypto.randomUUID'
);
const native = generate(600);
native.forEach((id) => assert.match(id, UPPERCASE_V4));
assert.equal(new Set(native).size, native.length, 'no duplicate ids');
const nativeWorst = assertIndependent(native, 'crypto.randomUUID');

// 2. crypto.randomUUID is the source when present.
let randomUUIDCalls = 0;
withGlobalCrypto(
  {
    randomUUID: () => {
      randomUUIDCalls += 1;
      return 'b3c1f0e2-9a4d-4c5e-8f60-112233445566';
    },
    getRandomValues: () => {
      throw new Error('getRandomValues must not be used when randomUUID exists');
    }
  },
  () => assert.equal(getUUID(), 'B3C1F0E2-9A4D-4C5E-8F60-112233445566')
);
assert.equal(randomUUIDCalls, 1);

// 3. A page served over plain HTTP has getRandomValues but no randomUUID.
let getRandomValuesCalls = 0;
const fallback = withGlobalCrypto(
  {
    getRandomValues: (array) => {
      getRandomValuesCalls += 1;
      return nodeCrypto.getRandomValues(array);
    }
  },
  () => generate(600)
);
assert.equal(getRandomValuesCalls, 600);
fallback.forEach((id) => assert.match(id, UPPERCASE_V4));
assert.equal(new Set(fallback).size, fallback.length, 'no duplicate ids from getRandomValues');
const fallbackWorst = assertIndependent(fallback, 'crypto.getRandomValues');

// The version and variant bits are forced whatever the random bytes are.
for (const fill of [0x00, 0xff]) {
  const id = withGlobalCrypto({ getRandomValues: (array) => array.fill(fill) }, () => getUUID());
  assert.match(id, UPPERCASE_V4, `bytes all 0x${fill.toString(16)}`);
}
assert.equal(
  withGlobalCrypto({ getRandomValues: (array) => array.fill(0) }, () => getUUID()),
  '00000000-0000-4000-8000-000000000000'
);

// 4. No Web Crypto at all: throw, never fall back to Math.random.
for (const runtimeCrypto of [undefined, {}]) {
  withGlobalCrypto(runtimeCrypto, () =>
    withoutMathRandom(() => assert.throws(() => getUUID(), /no Web Crypto API/))
  );
}

console.log(
  `getUUID checks passed (longest shared run between neighbours: randomUUID ${nativeWorst}, getRandomValues ${fallbackWorst} of 32 digits)`
);
