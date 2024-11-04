import SogniClient from '@sogni-ai/sogni-client';

const client = await SogniClient.createInstance({
  appId: 'this-is-my-app-id',
  restEndpoint: 'https://api-staging.sogni.ai/',
  socketEndpoint: 'https://socket-staging.sogni.ai/',
  testnet: true
});

const loginData = client.account.login('', '');

const balance = await client.account.getBalance();

console.log('Balance:', balance);
