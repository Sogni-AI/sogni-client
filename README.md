# Sogni SDK for JavaScript & Node.js
This library provides an easy way to interact with the [Sogni AI Supernet](https://www.sogni.ai/supernet) - a DePIN protocol for creative AI. It is written in TypeScript and can be used 
in both TypeScript and JavaScript projects such as backend Node.js and browser environments.

Behind the scenes this SDK uses WebSocket connection for communication between clients, server, and workers. It harnesses an event-based API to interact with Supernet to make things super efficient.
## Migration notes
### v3.x.x to v4.x.x
Version 4 adds support of video generation. There are following breaking changes:
- `type` is required when calling `sogni.projects.create(params)`, valid values are `image` and `video`. See code examples below.
- `numberOfImages` renamed to `numberOfMedia`

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
In order to use Sogni Supernet, you need an active Sogni account (in the form of a username and password) with a positive SOGNI or Spark token balance. 
You can create a free account in our [Web App](https://app.sogni.ai) or [Mac App](https://www.sogni.ai/studio) which will give you tokens just for signing up and confirming your email. You can get daily bonus tokens by claiming them (under rewards) each 24-hours.

Spark tokens can be purchased with a credit card in a Mac or Web app.

Your account is tied to a [Base](https://www.base.org/) Wallet that is created during signup.

### Supernet Types
There are 2 worker network types available:
- `fast` - this network runs on high-end GPUs and is optimized for speed. It is more expensive than `relaxed` network.
- `relaxed` - this network runs on Apple Mac devices and is optimized for cost. It is cheaper than `fast` network.

In both options, the more complex your query is (the more steps), the higher the cost in tokens.

### Inference definitions: Projects and Jobs
One request for image generation is called a **Project**. Project can generate one or more images. 
Each image is represented by a **Job**.

When you send a project to Supernet, it will be processed by one or more workers. The resulting images will be encrypted and 
uploaded to Sogni servers where it will be stored for 24 hours. After this period images will be auto-deleted.

## Client initialization
To initialize a client, you need to provide `appId`, and account credentials.

```javascript
import { SogniClient } from '@sogni-ai/sogni-client';

const USERNAME = 'your-username';
const PASSWORD = 'your-password';

const options = {
  appId: 'your-app-id', // Required, must be unique string, UUID is recommended
  network: 'fast', // Network to use, 'fast' or 'relaxed'
}

const sogni = await SogniClient.createInstance(options);
// Login to Sogni account and establish WebSocket connection to Supernet
await sogni.account.login(USERNAME, PASSWORD);
// Now wait until list of available models is received.
// This step is only needed if you want to create project immediately.
const models = await sogni.projects.waitForModels();
// You can get list of available models any time from `sogni.projects.availableModels`
```
**Important Note:** 
- This sample assume you are using ES modules, which allow `await` on the top level, if you are CommomJS you will need to wrap `await` calls in an async function.
- `appId` must be unique string, UUID is recommended. It is used to identify your application.
- Only one connection per `appId` is allowed. If you try to connect with the same `appId` multiple times, the previous connection will be closed.

## Usage
After calling `login` method, the client will establish a WebSocket connection to Sogni Supernet. Within a short period of time the
client will receive the current balance and list of available models. After this you can start using the client to generate images.

### Creating project
```javascript
// Find model that has the most workers
const mostPopularModel = sogni.projects.availableModels.reduce((a, b) =>
  a.workerCount > b.workerCount ? a : b
);
// Create a project using the most popular model
const project = await sogni.projects.create({
  type: 'image',
  modelId: mostPopularModel.id,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  steps: 20, 
  guidance: 7.5, 
  numberOfMedia: 1,
  outputFormat: 'jpg' // Can be 'png' or 'jpg', defaults to 'png'
});
```
**Note:** Full project parameter list can be found in [ProjectParams](https://sdk-docs.sogni.ai/interfaces/ProjectParams.html) docs.

### Getting project status and results
In general, there are 2 ways to work with API:
1. Using promises or `async/await` syntax.
2. Listening to events on `Project` and `Job` class instances.

#### Using promises
```javascript
const project = await sogni.projects.create({
  type: 'image',
  modelId: mostPopularModel.id,
  steps: 20,
  guidance: 7.5,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  numberOfMedia: 4
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
const project = await sogni.projects.create({
  type: 'image',
  modelId: mostPopularModel.id,
  steps: 20,
  guidance: 7.5,
  positivePrompt: 'A cat wearing a hat',
  negativePrompt:
    'malformation, bad anatomy, bad hands, missing fingers, cropped, low quality, bad quality, jpeg artifacts, watermark',
  stylePrompt: 'anime',
  numberOfMedia: 4
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
Here is a full list of project parameters that you can use:
- `modelId` - ID of the model to use for image generation.
- `positivePrompt` - text prompt that describes what you want to see in the image. Can be an empty string.
- `negativePrompt` - text prompt that describes what you don't want to see in the image. Can be an empty string.
- `stylePrompt` - text prompt that describes the style of the image. Can be an empty string.
- `numberOfImages` - number of images to generate.
- `tokenType` - select token type to pay for render. Can be either `sogni` or `spark`.
- `sizePreset` - optionally pass the ID of a size preset to use. If not passed, the default output is a square at 
either 512x512, 768x768 or 1024x1024 (SDXL and Flux) based on the default resolution of the selected model. 
See **Detecting available output presets** section below for available presets for your model. The token cost and 
render time of the job is heavily influenced by total pixel count where a 2048x2048 image is 4x the cost and render 
time of a 1024x1024 image as it is 4x the generated pixel count. You may also pass `custom` along with `width` and 
`height` project parameters to request a custom dimension. Note that not all size presets and custom aspect ratios 
produce consistently good results with all models. If your output features skewed anatomy or doubling of features 
you should experiment with a different model or output size.
- `width` - if 'sizePreset' is set to 'custom' you may pass a custom pixel width between 256 and 2048
- `height` - if 'sizePreset' is set to 'custom' you may pass a custom pixel height between 256 and 2048
- `steps` - number of inference steps between random pixels to final image. Higher steps generally lead to higher 
quality images and more details but varies by model, prompt, guidance, and desired look. For most Stable Diffusion 
models 20-40 steps is ideal with 20 being 2x faster to render than 40. For Flux 4 steps is optimal. Lightning, 
Turbo and LCM models are designed for quality output in as little as 1 step. ([More info](https://docs.sogni.ai/learn/basics/inference-steps)).
- `guidance` - guidance scale. For most Stable Diffusion models, optimal value is 7.5 ([More info](https://docs.sogni.ai/learn/basics/guidance-scale)).
- `network` - network type to use, `fast` or `relaxed`. This parameter allows to override default network type for this project.
- `disableNSFWFilter` - disable NSFW filter for this project. NSFW filter is enabled by default and workers won't upload resulting images if they are detected as NSFW.
- `seed` - uint32 number to use as seed. If not provided, random seed will be used. If `numberOfImages` is greater than 1, provided seed will be user only for one of them. ([More info](https://docs.sogni.ai/learn/basics/generation-seed)).
- `numberOfPreviews` - number of preview images to generate. If not provided, no preview images will be generated.
- `sampler` - sampler algorithm ([More info](https://docs.sogni.ai/sogni-studio/advanced/samplers-and-schedulers)). For available options, see the **"Samplers"** section below.
- `scheduler` - scheduler to use ([More info](https://docs.sogni.ai/sogni-studio/advanced/samplers-and-schedulers)). For available options, see the **"Schedulers"** section below.
- `startingImage` - guide image in PNG format. Can be [File](https://developer.mozilla.org/en-US/docs/Web/API/File), [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) or [Buffer](https://nodejs.org/api/buffer.html)
- `startingImageStrength` - strong effect of starting image should be. From 0 to 1, default 0.5. 
- `controlNet` - Stable Diffusion ControlNet parameters. See **ControlNets** section below for more info.
- `outputFormat` - output image format. Can be `png` or `jpg`. If not specified, `png` will be used. JPG format results in smaller file sizes but may have slightly lower quality due to compression.

TypeScript type definitions for project parameters can be found in [ProjectParams](https://sdk-docs.sogni.ai/interfaces/ProjectParams.html) docs.

### Detecting available output presets
You can get a list of available output presets for a specific network and model using `sogni.projects.getOutputPresets` method.
```javascript
const presets = await sogni.projects.getSizePresets('fast', 'flux1-schnell-fp8');
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

### Samplers
Samplers control the denoising process — the sequence of steps that transforms random noise into your final image.

Available sampler options:

| Option          | Description                         |
|-----------------|-------------------------------------|
| `dfs_sd3`       | Discrete Flow Sampler (SD3)         |
| `dpm_pp`        | DPM Solver Multistep (DPM-Solver++) |
| `dpm_pp_sde`    | DPM++ SDE                           |
| `dpm_pp_2m`     | DPM++ 2M                            |
| `euler`         | Euler                               |
| `euler_a`       | Euler a                             |
| `lcm`           | LCM (Latent Consistency Model)      |
| `pndm_plms`     | PNDM (Pseudo-linear multi-step)     |

**IMPORTANT:** Sampler compatibility depends on model and network. See [Samplers and Schedulers](https://docs.sogni.ai/sogni-studio/advanced/samplers-and-schedulers) docs for more info.

### Schedulers
Control how steps are distributed. For more info see [Schedulers and Samplers](https://docs.sogni.ai/sogni-studio/advanced/samplers-and-schedulers#schedulers) docs.

Available scheduler options:

| Option        | Description |
|---------------|-------------|
| `beta`        | Beta        |
| `ddim`        | DDIM        |
| `karras`      | Karras      | 
| `kl_optimal`  | KL Optimal  | 
| `leading`     | Automatic   |
| `linear`      | Automatic   |
| `normal`      | Normal      |
| `sgm_uniform` | SGM Uniform | 
| `simple`      | Simple      |

### ControlNets
**EXPERIMENTAL FEATURE:** This feature is still in development and may not work as expected. Use at your own risk.

ControlNet is a neural network that controls image generation in Stable Diffusion by adding extra conditions. See more 
info and usage samples in [ControlNets](https://docs.sogni.ai/learn/basics/controlnet) docs for Sogni Studio.

To use ControlNet in your project, you need to provide `controlNet` object with the following properties:
- `name` - name of the ControlNet to use. Currently supported:
  - `canny`
  - `depth`
  - `inpaint`
  - `instrp2p`
  - `lineart`
  - `lineartanime`
  - `mlsd`
  - `normalbae`
  - `openpose`
  - `scribble`
  - `segmentation`
  - `shuffle`
  - `softedge`
  - `tile`
  - `instantid`
- `image` - input image. Image size should match the size of the generated image. Can be [File](https://developer.mozilla.org/en-US/docs/Web/API/File), [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) or [Buffer](https://nodejs.org/api/buffer.html)
- `strength` - ControlNet strength 0 to 1. 0 full control to prompt, 1 full control to ControlNet
- `mode` - How control and prompt should be weighted. Can be:
  - `balanced` - (default) balanced, no preference between prompt and control model
  - `prompt_priority` - the prompt has more impact than the model
  - `cn_priority` - the controlnet model has more impact than the prompt
- `guidanceStart` - step when ControlNet first applied, 0 means first step, 1 means last step. Must be less than guidanceEnd
- `guidanceEnd` - step when ControlNet last applied, 0 means first step, 1 means last step. Must be greater than guidanceStart

Example:
```javascript
const cnImage = fs.readFileSync('./cn.jpg');
const project = await sogni.projects.create({
  type: 'image',
  network: 'fast',
  modelId: 'coreml-cyberrealistic_v70_768',
  numberOfMedia: 1,
  positivePrompt: 'make men look older',
  steps: 20,
  guidance: 7.5,
  controlNet: {
    name: 'instrp2p',
    image: cnImage
  }
});
```
Full ControlNet type definition:
```typescript
export type ControlNetName =
  | 'canny'
  | 'depth'
  | 'inpaint'
  | 'instrp2p'
  | 'lineart'
  | 'lineartanime'
  | 'mlsd'
  | 'normalbae'
  | 'openpose'
  | 'scribble'
  | 'segmentation'
  | 'shuffle'
  | 'softedge'
  | 'tile'
  | 'instantid';

export type ControlNetMode = 'balanced' | 'prompt_priority' | 'cn_priority';
export interface ControlNetParams {
  name: ControlNetName;
  image?: File | Buffer | Blob;
  strength?: number;
  mode?: ControlNetMode;
  guidanceStart?: number;
  guidanceEnd?: number;
}
```


## Code examples
You can find more code examples in the [examples](https://github.com/Sogni-AI/sogni-client/tree/main/examples) directory.
