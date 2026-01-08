# Sogni SDK for JavaScript & Node.js
This library provides an easy way to interact with the [Sogni Supernet](https://www.sogni.ai/supernet) - a DePIN protocol for creative AI inference. It is written in TypeScript and can be used
in both TypeScript and JavaScript projects such as backend Node.js and browser environments.

Behind the scenes this SDK uses a WebSocket connection for communication between clients, server, and workers. It harnesses an event-based API to interact with Supernet to make things super efficient.

## Features
- 🎨 **Image Generation** - Create images with the latest frontier Open Source models like Stable Diffusion, Z-Image Turbo, and Flux
- 🎨 **Image Edit** - Modify, merge, restyle, and transform images using prompts and/or multiple reference images using powerful models like Qwen Image Edit.
- 🎬 **Video Generation** - Generate videos using **Wan 2.2 14B FP8** models with five workflow types:
  - Text-to-Video (t2v) - Generate videos from text prompts
  - Image-to-Video (i2v) - Animate static images
  - Sound-to-Video (s2v) - Generate videos synchronized with audio
  - Animate-Move - Transfer motion from reference video to image subject
  - Animate-Replace - Replace subjects in videos while preserving motion
- ⚡ **Fast & Relaxed Networks** - Choose between high-speed GPU network or cost-effective Mac network
- 🔄 **Real-time Progress** - Event-based API with progress tracking and live updates
- 🎯 **Advanced Controls** - Fine-tune generation with samplers, schedulers, ControlNets, and more
## Migration notes
### v3.x.x to v4.x.x
Version 4 adds support for video generation, including the new **Wan 2.2 14B FP8** model family with five workflow types (text-to-video, image-to-video, sound-to-video, animate-move, and animate-replace). There are the following breaking changes:
- `type` is required when calling `sogni.projects.create(params)`, valid values are `image` and `video`. See code examples below.
- `numberOfImages` renamed to `numberOfMedia`
- `hasResultImage` in `Job` class is now `hasResultMedia`
- `Job` and `Project` classes now have `type` property that can be `image` or `video`

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
- `fast` - this network runs on high-end GPUs and is optimized for speed. It is more expensive than `relaxed` network. **Required for video generation**.
- `relaxed` - this network runs on Apple Mac devices and is optimized for cost. It is cheaper than `fast` network. Supports image generation only.

In both options, the more complex your query is (the more steps), the higher the cost in tokens.

### Inference definitions: Projects and Jobs
One request for image or video generation is called a **Project**. A project can generate one or more images or videos.
Each generated image or video is represented by a **Job**.

When you send a project to Supernet, it will be processed by one or more workers. The resulting media will be encrypted and
uploaded to Sogni servers where it will be stored for 24 hours. After this period, media files will be auto-deleted.

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
client will receive the current balance and list of available models. After this you can start using the client to generate images or videos.

It is advised to watch for `connected` and `disconnected` events on the client instance to be notified when the connection is established or lost:
```typescript
// Will be triggered when the client is connected to Supernet
sogni.client.on('connected', ({network}) => {
  console.log('Connected to Supernet:', network);
});

// Will be triggered when websocket connection is lost or the client is disconnected from Supernet
sogni.client.on('disconnected', ({code, reason}) => {
  console.log('Disconnected from Supernet:', code, reason);
});
```

## Image Generation

Sogni supports a wide range of models for image generation. You can find a list of available models in 
`sogni.projects.availableModels` property during runtime or query it using `sogni.projects.getAvailableModels()` method.

For a start, you can try FLUX.1 \[schnell\] with the following parameters:
```javascript
const fluxDefaults = {
  modelId: 'flux1-schnell-fp8',
  steps: 4,
  guidance: 1
}
```

### Creating an image project
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


## Video Generation with Wan 2.2 Models

The Sogni SDK supports advanced video generation workflows powered by **Wan 2.2 14B FP8** models. These models are available on the `fast` network and support various video generation workflows.

### Available Wan 2.2 Workflows

The Wan 2.2 model family supports five distinct video generation workflows:

1. **Text-to-Video (t2v)** - Generate videos from text prompts
2. **Image-to-Video (i2v)** - Animate a static image into a video (First and Last Frame supported)
3. **Sound-to-Video (s2v)** - Bring a character in an image to life with video and audio synchronization including lip syncing
4. **Animate-Move** - Transfer character motion and emotion from a reference video to a subject from an image into a new video
5. **Animate-Replace** - Replace a subject in a video while preserving motion

### Model Variants

Each workflow has two model variants optimized for different use cases:

- **Speed variant** (with `_lightx2v` suffix) - Faster inference (4-step), good quality
- **Quality variant** (without `_lightx2v`) - Slower inference, best quality

Example model IDs:
- `wan_v2.2-14b-fp8_t2v_lightx2v` (Text-to-Video, speed)
- `wan_v2.2-14b-fp8_t2v` (Text-to-Video, quality)
- `wan_v2.2-14b-fp8_i2v_lightx2v` (Image-to-Video, speed)
- `wan_v2.2-14b-fp8_i2v` (Image-to-Video, quality)
- `wan_v2.2-14b-fp8_s2v_lightx2v` (Sound-to-Video, speed)
- `wan_v2.2-14b-fp8_s2v` (Sound-to-Video, quality)
- `wan_v2.2-14b-fp8_animate-move_lightx2v` (Animate-Move, speed)
- `wan_v2.2-14b-fp8_animate-replace_lightx2v` (Animate-Replace, speed)

### Video Parameters

When creating video projects, you can specify:

- `fps` - Frames per second: 16 or 32 (default: 16)
- `frames` - Number of frames: 17-161 (default: 81, which is ~5 seconds at 16fps)
- `width` - Video width in pixels
- `height` - Video height in pixels
- `steps` - Increase inference steps to increase quality
- `seed` - Random seed for reproducibility
- `referenceImage` - Reference image for workflows that require it (i2v, s2v, animate-move, animate-replace)
- `referenceVideo` - Reference video for animate workflows (animate-move, animate-replace)
- `referenceAudio` - Reference audio for sound-to-video workflow

### Text-to-Video Example

```javascript
const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',
  modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
  positivePrompt: 'A serene ocean wave crashing on a beach at sunset',
  fps: 16,
  frames: 81,
  width: 512,
  height: 512
});

const videoUrls = await project.waitForCompletion();
console.log('Video URL:', videoUrls[0]);
```

### Image-to-Video Example

```javascript
const referenceImage = fs.readFileSync('./input-image.png');

const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',
  modelId: 'wan_v2.2-14b-fp8_i2v_lightx2v',
  positivePrompt: 'camera zooms in slowly',
  referenceImage: referenceImage,
  fps: 16,
  frames: 81
});

const videoUrls = await project.waitForCompletion();
```

### Sound-to-Video Example

```javascript
const referenceImage = fs.readFileSync('./image.jpg');
const referenceAudio = fs.readFileSync('./audio.m4a');

const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',
  modelId: 'wan_v2.2-14b-fp8_s2v_lightx2v',
  referenceImage: referenceImage,
  referenceAudio: referenceAudio,
  fps: 16,
  frames: 81
});

const videoUrls = await project.waitForCompletion();
```

### Animate-Move Example

Transfer motion from a reference video to a subject in an image:

```javascript
const referenceImage = fs.readFileSync('./subject.jpg');
const referenceVideo = fs.readFileSync('./motion-source.mp4');

const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',
  modelId: 'wan_v2.2-14b-fp8_animate-move_lightx2v',
  referenceImage: referenceImage,
  referenceVideo: referenceVideo,
  fps: 16,
  frames: 81
});

const videoUrls = await project.waitForCompletion();
```

### Animate-Replace Example

Replace a subject in a video while preserving the original motion:

```javascript
const referenceImage = fs.readFileSync('./new-subject.jpg');
const referenceVideo = fs.readFileSync('./original-video.mp4');

const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',
  modelId: 'wan_v2.2-14b-fp8_animate-replace_lightx2v',
  referenceImage: referenceImage,
  referenceVideo: referenceVideo,
  fps: 16,
  frames: 81
});

const videoUrls = await project.waitForCompletion();
```

## Code Examples

The [examples](https://github.com/Sogni-AI/sogni-client/tree/main/examples) directory contains working examples for all workflows:

### Image Workflow Examples
- **`workflow_text_to_image.mjs`** - Text-to-image generation with multiple model options
- **`workflow_image_edit.mjs`** - Reference-based image generation using context images

### Video Workflow Examples
- **`workflow_text_to_video.mjs`** - Text-to-video generation with WAN 2.2 models
- **`workflow_image_to_video.mjs`** - Animate static images into videos
- **`workflow_sound_to_video.mjs`** - Audio-synchronized video generation with lip-sync
- **`workflow_video_to_video.mjs`** - Motion transfer and character replacement (Animate-Move/Animate-Replace)

### Basic Examples
- **`promise_based.mjs`** - Image generation using promises/async-await
- **`event_driven.js`** - Image generation using event listeners

### Featured Models

The workflow examples showcase a few powerful open-source frontier models supported by Sogni Supernet:

| Model ID | Description | Use Case |
|----------|-------------|----------|
| `z_image_turbo_bf16` | **Z-Image Turbo** - Ultra-fast 4-step generation | Quick text-to-image prototyping and iteration |
| `qwen_image_edit_2511_fp8_lightning` | **Qwen Image Edit Lightning** - Fast 4-step editing | Rapid reference-based image generation |
| `qwen_image_edit_2511_fp8` | **Qwen Image Edit** - High quality 20-step editing | Professional image editing with context awareness |
| `wan_v2.2-14b-fp8_t2v_lightx2v` | **Wan 2.2 T2V** - Text-to-video | Generate videos from text prompts |

All workflow examples include:
- Interactive model and parameter selection
- Balance checking and cost confirmation
- Real-time progress tracking with ETA
- Error handling with detailed feedback
- Automatic file download and preview

Run any workflow example:
```bash
cd examples
npm install
node workflow_text_to_image.mjs
node workflow_image_edit.mjs
node workflow_text_to_video.mjs
```
