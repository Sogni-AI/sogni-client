const assert = require('node:assert/strict');

const { SogniClient } = require('../dist/index.js');

async function main() {
  const restOnly = await SogniClient.createInstance({ disableSocket: true });
  assert.equal(restOnly.apiClient.socketEnabled, false);
  assert.equal(restOnly.apiClient.appId, 'rest-only');
  restOnly.dispose();

  const socketClient = await SogniClient.createInstance({ appId: ' stable-app ' });
  assert.equal(socketClient.apiClient.socketEnabled, true);
  assert.equal(socketClient.apiClient.appId, 'stable-app');
  socketClient.dispose();

  await assert.rejects(
    SogniClient.createInstance({}),
    /appId is required when WebSocket connections are enabled/
  );

  console.log('REST-only client configuration checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
