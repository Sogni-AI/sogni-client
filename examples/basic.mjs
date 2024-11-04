import { SogniClient } from '@sogni-ai/sogni-client';
console.log('SogniClient:', SogniClient);

const client = await SogniClient.createInstance({
  appId: 'this-is-my-app-id',
  restEndpoint: 'https://api-staging.sogni.ai/',
  socketEndpoint: 'https://socket-staging.sogni.ai/',
  testnet: true
});

client.projects.once('availableModels', async () => {
  console.log('available models updated:', client.projects.availableModels);
  const project = await client.projects.create({
    modelId: client.projects.availableModels[0].id,
    steps: 5,
    guidance: 7.5,
    positivePrompt: 'Cat in a hat',
    negativePrompt:
      'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
    stylePrompt: 'anime',
    numberOfImages: 1
  });
  project.on('progress', (progress) => {
    console.log('progress:', progress);
  });
  project.on('completed', async (images) => {
    console.log('project completed');
    console.log('images:', images);
  });
});

await client.account.login('your_login', '123456');
