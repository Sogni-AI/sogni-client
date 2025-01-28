# Sogni SDK for JavaScript & Node.js
This library provides an easy way to interact with the [Sogni AI Supernet](https://www.sogni.ai/supernet) - a DePIN protocol for creative AI. It is written in TypeScript and can be used 
in both TypeScript and JavaScript projects such as backend Node.js and browser environments.

Behind the scenes this SDK uses WebSocket connection for communication between clients, server, and workers. It harnesses an event-based API to interact with Supernet to make things super efficient.

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
In order to use Sogni Supernet you need an active Sogni account (in the form of a username and password) with a positive $tSOGNI balance. 
You can create a free account in our [Web App](https://app.sogni.ai) or [Mac App](https://www.sogni.ai/studio) which will give you tokens just for signing up and confirming your email. You can get daily bonus tokens by claiming them (under rewards) each 24-hours.

Your account is tied to a [Base](https://www.base.org/) Wallet that is created during signup. The current network is [Base Sepolia](https://chainlist.org/chain/84532) and will be [Base Mainnet](https://chainlist.org/chain/8453) after mainnet launch.

The Library will use a default provider if none is provided, but note that it is not guaranteed to be always available. It is recommended to use your own Node endpoint such as alchemy.com (free and paid plans). You can specify your own node in `jsonRpcUrl` settings below.

### Supernet Types
There are 2 worker network types available:
- `fast` - this network runs on high-end GPUs and is optimized for speed. It is more expensive than `relaxed` network at roughly 1 $tSOGNI token per render.
- `relaxed` - this network runs on Apple Mac devices and is optimized for cost. It is cheaper than `fast` network at roughly 0.5 $tSOGNI token per render.

In both options the more complex your query is (the more steps) the higher the cost in tokens.

### Inference definitions: Projects and Jobs
One request for image generation is called a **Project**. Project can generate one or more images. 
Each image is represented by a **Job**.

When you send a project to Supernet, it will be processed by one or more workers. The resulting images will be encrypted and 
uploaded to Sogni servers where it will be  stored for 24 hours. After this period images will be auto-deleted.

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
await client.account.login(USERNAME, PASSWORD);
// Now wait until list of available models is received.
// This step is only needed if you want to create project immediately.
const models = await client.projects.waitForModels();
// You can get list of available models any time from `client.projects.availableModels`
```
**Important Note:** 
- This sample assume you are using ES modules, which allow `await` on the top level, if you are CommomJS you will need to wrap `await` calls in an async function.
- Sogni is currently in Testnet phase, so you need to provide Base Sepolia network URL.
- `appId` must be unique string, UUID is recommended. It is used to identify your application.
- Only one connection per `appId` is allowed. If you try to connect with the same `appId` multiple times, the previous connection will be closed.

## Usage
After calling `login` method, the client will establish a WebSocket connection to Sogni Supernet. Within a short period of time the
client will receive current balance and list of available models. After this you can start using the client to generate images.

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
**Note:** Full project parameter list can be found in [ProjectParams](https://sdk-docs.sogni.ai/interfaces/ProjectParams.html) docs.

### Getting project status and results
In general there are 2 ways to work with API:
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

### Project parameters
Here is full list of project parameters that you can use:
- `modelId` - ID of the model to use for image generation.
- `positivePrompt` - text prompt that describes what you want to see in the image. Can be empty string.
- `negativePrompt` - text prompt that describes what you don't want to see in the image. Can be empty string.
- `stylePrompt` - text prompt that describes the style of the image. Can be empty string.
- `numberOfImages` - number of images to generate.
- `sizePreset` - ID of size preset to use. See **Detecting available output presets** section below.
- `steps` - number of steps. For most Stable Diffusion models, optimal value is 20. Flux models usually require 5-7 steps ([More info](https://docs.sogni.ai/learn/basics/inference-steps)).
- `guidance` - guidance scale. For most Stable Diffusion models, optimal value is 7.5 ([More info](https://docs.sogni.ai/learn/basics/guidance-scale)).
- `network` - network type to use, 'fast' or 'relaxed'. This parameter allow to override default network type for this project.
- `disableNSFWFilter` - disable NSFW filter for this project. NSFW filter is enabled by default and workers won't upload resulting images if they are detected as NSFW.
- `seed` - uint32 number to use as seed. If not provided, random seed will be used. If `numberOfImages` is greater than 1, provided seed will be user only for one of them. ([More info](https://docs.sogni.ai/learn/basics/generation-seed)).
- `numberOfPreviews` - number of preview images to generate. If not provided, no preview images will be generated.
- `scheduler` - scheduler to use ([More info](https://docs.sogni.ai/learn/advanced/schedulers)). For available options see type definition.
- `timeStepSpacing` - time step spacing algorithm ([More info](https://docs.sogni.ai/learn/advanced/schedulers)). For available options see type definition.
- `startingImage` - guide image in PNG format. Can be [File](https://developer.mozilla.org/en-US/docs/Web/API/File), [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) or [Buffer](https://nodejs.org/api/buffer.html)
- `startingImageStrength` - strong effect of starting image should be. From 0 to 1, default 0.5. 

TypeScript type definitions for project parameters can be found in [ProjectParams](https://sdk-docs.sogni.ai/interfaces/ProjectParams.html) docs.

### Detecting available output presets
You can get list of available output presets for a specific network and model using `client.projects.getOutputPresets` method.
```javascript
const presets = await client.projects.getSizePresets('fast', 'flux1-schnell-fp8');
console.log('Available output presets:', presets);
```
Sample response:
```json
[
    {
        "label": "Square",
        "id": "square",
        "width": 512,
        "height": 512,
        "ratio": "1:1",
        "aspect": "1"
    },
    {
        "label": "Square HD",
        "id": "square_hd",
        "width": 1024,
        "height": 1024,
        "ratio": "1:1",
        "aspect": "1"
    },
    {
        "label": "Portrait: Standard",
        "id": "portrait_7_9",
        "width": 896,
        "height": 1152,
        "ratio": "7:9",
        "aspect": "0.78"
    },
    {
        "label": "Portrait: 35mm",
        "id": "portrait_13_19",
        "width": 832,
        "height": 1216,
        "ratio": "13:19",
        "aspect": "0.68"
    },
    {
        "label": "Portrait: Mobile",
        "id": "portrait_4_7",
        "width": 768,
        "height": 1344,
        "ratio": "4:7",
        "aspect": "0.57"
    },
    {
        "label": "Portrait: Extended",
        "id": "portrait_5_12",
        "width": 640,
        "height": 1536,
        "ratio": "5:12",
        "aspect": "0.42"
    },
    {
        "label": "Landscape: Standard",
        "id": "landscape_9_7",
        "width": 1152,
        "height": 896,
        "ratio": "9:7",
        "aspect": "1.28"
    },
    {
        "label": "Landscape: 35mm",
        "id": "landscape_19_13",
        "width": 1216,
        "height": 832,
        "ratio": "19:13",
        "aspect": "1.46"
    },
    {
        "label": "Landscape: Widescreen",
        "id": "landscape_7_4",
        "width": 1344,
        "height": 768,
        "ratio": "7:4",
        "aspect": "1.75"
    },
    {
        "label": "Landscape: Ultrawide",
        "id": "landscape_12_5",
        "width": 1536,
        "height": 640,
        "ratio": "12:5",
        "aspect": "2.4"
    }
]
```


## Code examples
You can find more code examples in the [examples](https://github.com/Sogni-AI/sogni-client/tree/main/examples) directory.
