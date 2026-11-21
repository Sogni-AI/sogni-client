'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { SogniClient } = require('../dist/index.js');
const RestClient = require('../dist/lib/RestClient.js').default;
const TokenAuthManager = require('../dist/lib/AuthManager/TokenAuthManager.js').default;
const { openRemoteEncryptedMedia } = require('../dist/lib/mediaEncryption/remote.js');
const logger = { info() {}, warn() {}, error() {}, debug() {} };

(async () => {
  const received = [];
  let firstOrigin;
  let secondOrigin;
  async function handle(req, res) {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({
      origin: `http://${req.headers.host}`,
      path: req.url,
      headers: req.headers,
      method: req.method,
      body
    });
    const url = new URL(req.url, firstOrigin);
    if (url.pathname === '/end') {
      res.setHeader('Content-Type', 'application/json');
      res.end('{}');
      return;
    }
    let location = url.searchParams.get('target') || `${secondOrigin}/end`;
    if (url.pathname === '/v1/account/refresh-token') location = '/hops?count=20';
    if (url.pathname === '/hops') {
      const count = Number(url.searchParams.get('count'));
      location = count > 1 ? `/hops?count=${count - 1}` : '/end';
    }
    res.writeHead(Number(url.searchParams.get('status') || 302), { Location: location });
    res.end();
  }
  const first = http.createServer(handle);
  const second = http.createServer(handle);
  first.listen(0, '127.0.0.1');
  second.listen(0, '127.0.0.1');
  await Promise.all([once(first, 'listening'), once(second, 'listening')]);
  firstOrigin = `http://127.0.0.1:${first.address().port}`;
  secondOrigin = `http://127.0.0.1:${second.address().port}`;
  const sdk = await SogniClient.createInstance({
    disableSocket: true,
    apiKey: 'local-placeholder',
    restEndpoint: firstOrigin,
    logger
  });
  const credentials = {
    'ApI-KeY': 'local-placeholder',
    Authorization: 'local-placeholder',
    Cookie: 'local=placeholder',
    'X-Keep': 'yes'
  };
  const auth = {
    sessionVersion: 0,
    async authenticateRequest(init) {
      return { ...init, headers: { ...init.headers, ...credentials } };
    }
  };
  const rest = new RestClient(firstOrigin, auth, logger);
  const last = () => received.at(-1);
  const CREDENTIALS = ['api-key', 'authorization', 'cookie'];
  const assertNoCredentials = () => {
    for (const request of received.filter((r) => r.origin === secondOrigin)) {
      for (const name of ['api-key', 'authorization', 'cookie'])
        assert.equal(request.headers[name], undefined, name);
    }
  };
  try {
    await rest.get('/redirect');
    assert.equal(last().origin, secondOrigin);
    assertNoCredentials();
    for (const status of [301, 302, 303, 307, 308]) {
      received.length = 0;
      await rest.post(`/redirect?status=${status}&target=/end`, { value: 'one' });
      assert.equal(last().origin, firstOrigin);
      assert.equal(last().headers['api-key'], 'local-placeholder');
      assert.equal(last().headers.authorization, 'local-placeholder');
      assert.equal(last().headers.cookie, 'local=placeholder');
      assert.equal(last().method, [307, 308].includes(status) ? 'POST' : 'GET');
      assert.equal(last().body, [307, 308].includes(status) ? '{"value":"one"}' : '');
      if (![307, 308].includes(status)) assert.equal(last().headers['content-type'], undefined);
      received.length = 0;
      await rest.post(`/redirect?status=${status}`, { value: 'one' });
      assertNoCredentials();
      assert.equal(last().headers['x-keep'], 'yes');
    }
    // Authenticated requests follow as many redirects as fetch does and fail the same way.
    const fetchFailed = (cause) => (error) => {
      assert.equal(error.name, 'TypeError');
      assert.equal(error.message, 'fetch failed');
      assert.match(String(error.cause?.message), cause);
      return true;
    };
    received.length = 0;
    await rest.get('/hops?count=20');
    assert.equal(received.length, 21);
    received.length = 0;
    await assert.rejects(() => rest.get('/hops?count=21'), fetchFailed(/redirect count exceeded/));
    assert.equal(received.length, 21);
    for (const [target, cause] of [
      ['data:application/json,{}', /HTTP\(S\) scheme/],
      ['ftp://127.0.0.1/end', /HTTP\(S\) scheme/],
      [`${firstOrigin.replace('http://', 'http://user:pass@')}/end`, /cross origin/],
      ['http://[::1', /Invalid URL/]
    ]) {
      received.length = 0;
      await assert.rejects(
        () => rest.get(`/redirect?target=${encodeURIComponent(target)}`),
        fetchFailed(cause)
      );
      assert.equal(received.length, 1);
    }
    // Returning through the original origin does not restore stripped headers.
    received.length = 0;
    const back = `${secondOrigin}/redirect?target=${encodeURIComponent(firstOrigin + '/redirect')}`;
    await rest.get('/redirect?target=' + encodeURIComponent(back));
    assertNoCredentials();
    assert.equal(received[2].headers['api-key'], undefined);

    const paths = [
      ['Chat', () => sdk.chat.chatRunFetch('/redirect')],
      ['Worlds', () => sdk.worlds.buildFetch('/redirect')],
      ['Replay', () => sdk.replay.fetch('/redirect')],
      ['CreativeWorkflows', () => sdk.workflows.fetch('/redirect')],
      ['Templates', () => sdk.workflows.templates.fetch('/redirect')],
      [
        'MediaEncryption',
        () =>
          sdk.mediaEncryption.fetchDecrypted(firstOrigin + '/redirect', {
            init: { headers: credentials }
          })
      ],
      [
        'RemoteMedia',
        () =>
          assert.rejects(
            () =>
              openRemoteEncryptedMedia(firstOrigin + '/redirect', async () => new Uint8Array(32), {
                init: { headers: credentials }
              }),
            /byte-range support/
          )
      ]
    ];
    for (const [name, call] of paths) {
      received.length = 0;
      const result = await call();
      if (result instanceof Response) await result.body?.cancel();
      assert.equal(last().origin, secondOrigin, name);
      assertNoCredentials();
      console.log(`${name} redirect path passed`);
    }
    const tokens = new TokenAuthManager(firstOrigin, logger);
    tokens._refreshToken = 'local-placeholder';
    tokens._refreshTokenExpiresAt = new Date(Date.now() + 60000);
    await assert.rejects(() => tokens._renewToken(), fetchFailed(/redirect count exceeded/));
    const { fetchWithCredentials } = require('../dist/lib/fetchWithCredentials.js');
    for (const headers of [new Headers(credentials), Object.entries(credentials)]) {
      received.length = 0;
      const response = await fetchWithCredentials(firstOrigin + '/redirect', { headers });
      await response.body.cancel();
      assertNoCredentials();
      assert.equal(new Headers(headers).get('api-key'), 'local-placeholder');
    }
    // Unauthenticated requests retain fetch's existing redirect limit.
    const anonymous = new RestClient(
      firstOrigin,
      {
        sessionVersion: 0,
        async authenticateRequest(init) {
          return init;
        }
      },
      logger
    );
    await anonymous.get('/hops?count=20');
    // An explicit redirect mode is passed to fetch unchanged.
    received.length = 0;
    const manual = await fetchWithCredentials(firstOrigin + '/redirect', {
      headers: credentials,
      redirect: 'manual'
    });
    await manual.body?.cancel();
    assert.equal(manual.status, 302);
    assert.equal(received.length, 1);
    received.length = 0;
    await assert.rejects(
      () =>
        fetchWithCredentials(firstOrigin + '/redirect', {
          headers: credentials,
          redirect: 'error'
        }),
      fetchFailed(/unexpected redirect/)
    );
    assert.equal(received.length, 1);
    // http to https on the same host keeps credentials, as fetch kept api-key before.
    const realFetch = globalThis.fetch;
    const hops = [];
    const chains = {
      'http://api.example.test/start': 'https://api.example.test/next',
      'https://api.example.test/next': 'https://api.example.test/end',
      'http://api.example.test:8080/start': 'https://api.example.test:8080/end',
      'http://api.example.test/port': 'https://api.example.test:8443/end',
      'http://api.example.test:8080/port': 'https://api.example.test/end',
      'http://api.example.test/host': 'https://cdn.example.test/end',
      'http://api.example.test/down': 'https://api.example.test/back',
      'https://api.example.test/back': 'http://api.example.test/end'
    };
    globalThis.fetch = async (url, init) => {
      const headers = new Headers(init?.headers);
      hops.push({ url, keys: CREDENTIALS.map((name) => headers.get(name)) });
      const to = chains[url];
      if (to) return new Response(null, { status: 301, headers: { Location: to } });
      return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
    };
    const kept = ['local-placeholder', 'local-placeholder', 'local=placeholder'];
    const dropped = [null, null, null];
    try {
      for (const [start, expected] of [
        ['http://api.example.test/start', [kept, kept, kept]],
        ['http://api.example.test:8080/start', [kept, kept]],
        ['http://api.example.test/port', [kept, dropped]],
        ['http://api.example.test:8080/port', [kept, dropped]],
        ['http://api.example.test/host', [kept, dropped]],
        ['http://api.example.test/down', [kept, kept, dropped]]
      ]) {
        hops.length = 0;
        await fetchWithCredentials(start, { headers: credentials });
        assert.deepEqual(
          hops.map((hop) => hop.keys),
          expected,
          start
        );
      }
      hops.length = 0;
      const upgraded = new RestClient('http://api.example.test', auth, logger);
      assert.deepEqual(await upgraded.get('/start'), {});
      assert.deepEqual(hops.at(-1).keys, kept);
    } finally {
      globalThis.fetch = realFetch;
    }
    for (const method of ['HEAD', 'PUT']) {
      received.length = 0;
      const response = await fetchWithCredentials(
        firstOrigin + '/redirect?status=303&target=/end',
        { headers: credentials, method }
      );
      await response.body?.cancel();
      assert.equal(last().method, method === 'HEAD' ? 'HEAD' : 'GET');
    }
    const aborted = AbortSignal.abort();
    await assert.rejects(
      () =>
        fetchWithCredentials(firstOrigin + '/redirect', { headers: credentials, signal: aborted }),
      { name: 'AbortError' }
    );
    const fs = require('node:fs');
    const vm = require('node:vm');
    const browser = {
      exports: {},
      require(id) {
        assert.equal(id, './isNodejs.js');
        return { default: false, __esModule: true };
      },
      fetch(url, init) {
        return Promise.resolve({ url, init });
      }
    };
    vm.runInNewContext(
      fs.readFileSync(require.resolve('../dist/lib/fetchWithCredentials.js'), 'utf8'),
      browser
    );
    const browserInit = { headers: credentials };
    const browserResult = await browser.exports.fetchWithCredentials(firstOrigin, browserInit);
    assert.equal(browserResult.init, browserInit);
    assert.equal(browserResult.init.redirect, undefined);
    const wsOptions = await sdk.apiClient.auth.socketOptions();
    assert.equal(wsOptions.followRedirects, undefined);
    const WebSocket = require('ws');
    received.length = 0;
    const socket = new WebSocket(firstOrigin.replace('http:', 'ws:') + '/redirect', wsOptions);
    const socketError = await new Promise((resolve) => socket.once('error', resolve));
    assert.match(socketError.message, /Unexpected server response: 302/);
    assert.equal(received.length, 1);
    assert.equal(received[0].origin, firstOrigin);
    console.log('REST redirect checks passed');
  } finally {
    first.closeAllConnections();
    second.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => first.close(resolve)),
      new Promise((resolve) => second.close(resolve))
    ]);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
