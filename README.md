# JavaScript Client for Sogni AI API
This library provides a simple way to interact with the Sogni AI Supernet. It is written in TypeScript and can be used 
in both TypeScript and JavaScript projects. Library can be used in both Node.js and browser environments.

Sogni Supernet uses WebSocket connection for communication between clients, server and workers. Because of this library
uses event-based API to interact with Supernet.

## Installation
Add library to your project using npm or yarn:
```bash
npm install @sogni-ai/sogni-client
```
or
```bash
yarn add @sogni-ai/sogni-client
```
## Core concepts
In order to use Sogni Supernet you need active Sogni account with positive balance. 
You can create one in our [Web App](https://app.sogni.ai) or [Mac App](https://www.sogni.ai/studio).

Your account is tied to [Base](https://www.base.org/) Wallet that is created during signup process. 
Because of this client also need access to [Base](https://chainlist.org/chain/8453) or [Base Sepolia](https://chainlist.org/chain/84532) network in order to work.

Library will use default provider if none is provided, but note that it is not guaranteed to be always available.

### Supernet Types
There are 2 worker network types available:
- `fast` - this network runs on high-end GPUs and is optimized for speed. It is more expensive than `relaxed` network.
- `relaxed` - this network runs on Apple Mac devices and is optimized for cost. It is cheaper than `fast` network.

### Projects and Jobs
One request for image generation is called a **Project**. Project can generate one or more images. 
Each image is represented by a **Job**.

When you send a project to Supernet, it will be processed by one or more workers. Resulting images will be 
uploaded to Sogni servers and stored there for 24 hours. After this period images will be deleted.

## Client initialization
To initialize client you need to provide `appId`, and account credentials.

```javascript
import { SogniClient } from '@sogni-ai/sogni-client';

const USERNAME = 'your-username';
const PASSWORD = 'your-password';

// If using default provider
const options = {
  appId: 'your-app-id', // Required, must be unique string, UUID is recommended
  network: 'fast', // Network to use, 'fast' or 'relaxed'
}
// If using custom provider
const options ={
  appId: 'your-app-id', // Required, must be unique string, UUID is recommended
  jsonRpcUrl: 'https://sepolia.base.org', // Put your custom JSON-RPC URL here
  network: 'fast', // Network to use, 'fast' or 'relaxed'
}
const client = await SogniClient.createInstance(options);
// Login to Sogni account and establish WebSocket connection to Supernet
await client.login(USERNAME, PASSWORD);
// Now wait until list of available models is received.
// This step is only needed if you want to create project immediately.
const models = await client.waitForModels();
// You can get list of available models any time from `client.projects.availableModels`
```
**Important Note:** 
- This sample assume you are using ESM modules, if not you need to wrap `await` calls in async function.
- Sogni is currently in Testnet phase, so you need to provide Base Sepolia network URL.
- `appId` must be unique string, UUID is recommended. It is used to identify your application.
- Only one connection per `appId` is allowed. If you try to connect with the same `appId` multiple times, the previous connection will be closed.

## Usage
After calling `login` method, client will establish WebSocket connection to Sogni Supernet. Within short period of time
client will receive current balance and list of available models. After this you can start using client to generate images.

### Creating project
```javascript
// Find model that has the most workers
const mostPopularModel = client.projects.availableModels.reduce((a, b) =>
  a.workerCount > b.workerCount ? a : b
);
// Create a project using the most popular model
const project = await client.projects.create({
  modelId: mostPopularModel.id,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  steps: 20, 
  guidance: 7.5, 
  numberOfImages: 1
});
```
**Note:** Full project parameter list can be found in [ProjectParams](https://sogni-ai.github.io/sogni-client/interfaces/ProjectParams.html) docs.

### Getting project status and results
In general there are 3 ways to work with API:
1. Using promises or `async/await` syntax.
2. Listening events on `Project` and `Job` class instances.

#### Using promises
```javascript
const project = await client.projects.create({
  modelId: mostPopularModel.id,
  steps: 20,
  guidance: 7.5,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  numberOfImages: 4
});

project.on('progress', (progress) => {
  console.log('Project progress:', progress);
});

const imageUrls = await project.waitForCompletion();
// Now you can use image URLs to download images. 
// Note that images will be available for 24 hours only!
console.log('Image URLs:', imageUrls);
```

#### Using events
```javascript
const project = await client.projects.create({
  modelId: mostPopularModel.id,
  steps: 20,
  guidance: 7.5,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  numberOfImages: 4
});

// Fired when one of project jobs completed, you can get the resultUrl from the job
// without waiting for the entire project to complete
project.on('jobCompleted', (job) => {
  console.log('Job completed:', job.id, job.resultUrl);
});

// Fired when one of project jobs failed
project.on('jobFailed', (job) => {
  console.log('Job failed:', job.id, job.error);
});

// Receive project completion percentage in real-time
project.on('progress', (progress) => {
  // console.log('Project progress:', progress);
});

// Fired when the project is fully completed
project.on('completed', async (images) => {
  console.log('Project completed:', images);
});

// Fired when the project failed
project.on('failed', async (errorData) => {
  console.log('Project failed:', errorData);
});
```
## Code examples
You can find more code examples in the [examples](./examples) directory.
