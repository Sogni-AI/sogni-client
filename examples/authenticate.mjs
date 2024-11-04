import { SogniClient } from '@sogni-ai/sogni-client';
console.log('SogniClient:', SogniClient);

const client = await SogniClient.createInstance({
  appId: 'this-is-my-app-id',
  restEndpoint: 'https://api-staging.sogni.ai/',
  socketEndpoint: 'https://socket-staging.sogni.ai/',
  testnet: true
});

const loginData = await client.account.login('', '');

const balance = await client.account.refreshBalance();

console.log('Balance:', balance);
