#!/usr/bin/env node

/**
 * Seedance 2.5 reference/edit/extend example for both the direct Projects API
 * and semantic Creative Agent workflow tools.
 *
 * Dry-run examples (no upload or generation):
 *   node workflow_seedance_2_5_r2v.mjs "Use @Image1 for the product and @Video1 for camera motion" --task-type reference --image product.jpg --video motion.mp4 --dry-run
 *   node workflow_seedance_2_5_r2v.mjs "Edit @Video1. Replace the background using @Image1; preserve the subject and timing" --task-type edit --video source.mp4 --image background.jpg --duration 5 --dry-run
 *   node workflow_seedance_2_5_r2v.mjs "Extend @Video1 after its ending; preserve the cast, scene, pacing, and sound" --task-type extend --video source.mp4 --duration 8 --dry-run
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SogniClient } from '../dist/index.js';
import { loadCredentials } from './credentials.mjs';

const DEFAULT_ENDPOINT = 'https://api.sogni.ai';
const DEFAULT_MODEL = 'seedance-2-5';
const DEFAULT_RESOLUTION = '720p';
const TASK_TYPES = new Set(['reference', 'edit', 'extend']);
const LAYERS = new Set(['direct', 'creative-agent']);

const MODEL_CONFIG = {
  'seedance-2-5': {
    hostedSelector: 'seedance2-5',
    maxDuration: 30,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    limits: { images: 30, videos: 10, audios: 10, total: 50 },
    supportsTaskType: true,
    audioOnlyReference: true
  },
  'seedance-2-0': {
    hostedSelector: 'seedance2',
    maxDuration: 15,
    resolutions: ['480p', '720p', '1080p', '4k'],
    defaultResolution: '1080p',
    limits: { images: 9, videos: 3, audios: 3, total: 12 },
    supportsTaskType: false,
    audioOnlyReference: false
  },
  'seedance-2-0-mini': {
    hostedSelector: 'seedance2-mini',
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    limits: { images: 9, videos: 3, audios: 3, total: 12 },
    supportsTaskType: false,
    audioOnlyReference: false
  },
  'seedance-2-0-fast': {
    hostedSelector: null,
    maxDuration: 15,
    resolutions: ['480p', '720p'],
    defaultResolution: '720p',
    limits: { images: 9, videos: 3, audios: 3, total: 12 },
    supportsTaskType: false,
    audioOnlyReference: false
  }
};

const DIMENSIONS = {
  '480p': { width: 864, height: 496 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 }
};

const MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime']
]);

const DEFAULT_PROMPTS = {
  reference: 'Use @Image1 for the subject and @Video1 for camera motion in a cohesive new clip.',
  edit: 'Edit @Video1. Change the environment while preserving the subject, timing, and sound.',
  extend: 'Extend @Video1 after its ending; preserve the cast, scene, pacing, and sound.'
};

export function parseArgs(args = process.argv.slice(2)) {
  const options = {
    prompt: '',
    taskType: 'reference',
    layer: 'direct',
    model: DEFAULT_MODEL,
    duration: 5,
    durationProvided: false,
    resolution: DEFAULT_RESOLUTION,
    images: [],
    videos: [],
    audios: [],
    numberOfMedia: 1,
    generateAudio: true,
    endpoint: process.env.SOGNI_REST_ENDPOINT || DEFAULT_ENDPOINT,
    dryRun: false,
    watch: false,
    json: false,
    help: false
  };
  const positional = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      return value;
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--task-type') options.taskType = next().toLowerCase();
    else if (arg === '--layer' || arg === '--api') options.layer = next().toLowerCase();
    else if (arg === '--direct') options.layer = 'direct';
    else if (arg === '--creative-agent' || arg === '--agent') options.layer = 'creative-agent';
    else if (arg === '--model') options.model = next().toLowerCase();
    else if (arg === '--duration') {
      options.duration = Number(next());
      options.durationProvided = true;
    } else if (arg === '--resolution') options.resolution = next().toLowerCase();
    else if (arg === '--image' || arg === '--reference-image') options.images.push(next());
    else if (arg === '--video' || arg === '--reference-video') options.videos.push(next());
    else if (arg === '--audio' || arg === '--reference-audio') options.audios.push(next());
    else if (arg === '--number' || arg === '--batch') options.numberOfMedia = Number(next());
    else if (arg === '--no-audio') options.generateAudio = false;
    else if (arg === '--generate-audio') options.generateAudio = true;
    else if (arg === '--endpoint') options.endpoint = next().replace(/\/+$/, '');
    else if (arg === '--dry-run' || arg === '--no-execute') options.dryRun = true;
    else if (arg === '--watch') options.watch = true;
    else if (arg === '--json') options.json = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }

  options.prompt = positional.join(' ').trim() || DEFAULT_PROMPTS[options.taskType] || '';
  return options;
}

export function modelConfig(model) {
  const config = MODEL_CONFIG[model];
  if (!config) {
    throw new Error(`--model must be one of: ${Object.keys(MODEL_CONFIG).join(', ')}`);
  }
  return config;
}

export function resolutionDimensions(resolution) {
  const dimensions = DIMENSIONS[resolution];
  if (!dimensions) throw new Error('--resolution must be 480p, 720p, 1080p, or 4k.');
  return dimensions;
}

export function validateOptions(options) {
  if (!TASK_TYPES.has(options.taskType)) {
    throw new Error('--task-type must be reference, edit, or extend.');
  }
  if (!LAYERS.has(options.layer)) {
    throw new Error('--layer must be direct or creative-agent.');
  }
  const config = modelConfig(options.model);
  if (!config.resolutions.includes(options.resolution)) {
    throw new Error(
      `${options.model} supports ${config.resolutions.join('/')} output, not ${options.resolution}.`
    );
  }
  if (
    !Number.isFinite(options.duration) ||
    options.duration < 4 ||
    options.duration > config.maxDuration
  ) {
    throw new Error(
      `${options.model} duration must be between 4 and ${config.maxDuration} seconds.`
    );
  }
  if (
    !Number.isInteger(options.numberOfMedia) ||
    options.numberOfMedia < 1 ||
    options.numberOfMedia > 16
  ) {
    throw new Error('--number/--batch must be an integer from 1 to 16.');
  }
  if (!options.prompt.trim()) throw new Error('A prompt is required.');

  const counts = {
    images: options.images.length,
    videos: options.videos.length,
    audios: options.audios.length
  };
  const total = counts.images + counts.videos + counts.audios;
  for (const kind of ['images', 'videos', 'audios']) {
    if (counts[kind] > config.limits[kind]) {
      throw new Error(`${options.model} supports at most ${config.limits[kind]} ${kind}.`);
    }
  }
  if (total > config.limits.total) {
    throw new Error(`${options.model} supports at most ${config.limits.total} total media files.`);
  }
  if (options.taskType === 'reference' && total === 0) {
    throw new Error('reference requires at least one loose image, video, or audio reference.');
  }
  if ((options.taskType === 'edit' || options.taskType === 'extend') && counts.videos === 0) {
    throw new Error(`${options.taskType} requires at least one source video as @Video1.`);
  }
  if (options.layer === 'direct' && options.taskType === 'edit' && !options.durationProvided) {
    throw new Error("Direct edit requires --duration set to @Video1's source duration.");
  }
  if (!config.supportsTaskType && options.taskType !== 'reference') {
    throw new Error(`${options.taskType} is exposed by this example only for Seedance 2.5.`);
  }
  if (
    !config.audioOnlyReference &&
    counts.audios > 0 &&
    counts.images === 0 &&
    counts.videos === 0
  ) {
    throw new Error(
      `${options.model} audio references require at least one image or video reference.`
    );
  }

  if (options.layer === 'creative-agent') {
    if (!config.hostedSelector) {
      throw new Error(
        `${options.model} has no current Creative Agent selector; use --layer direct.`
      );
    }
    if (
      options.taskType === 'edit' &&
      (counts.videos !== 1 || counts.images > 1 || counts.audios > 0)
    ) {
      throw new Error('Creative Agent edit accepts one source video and at most one source image.');
    }
    if (
      options.taskType === 'extend' &&
      (counts.videos !== 1 || counts.images > 0 || counts.audios > 0)
    ) {
      throw new Error(
        'Creative Agent extend accepts exactly one source video and no supplemental media.'
      );
    }
  }
  return options;
}

function addReferenceUrls(target, urls) {
  if (urls.images.length) target.referenceImageUrls = urls.images;
  if (urls.videos.length) target.referenceVideoUrls = urls.videos;
  if (urls.audios.length) target.referenceAudioUrls = urls.audios;
}

export function buildDirectProjectParams(options, urls) {
  const { width, height } = resolutionDimensions(options.resolution);
  const params = {
    type: 'video',
    network: 'fast',
    tokenType: 'spark',
    modelId: options.model,
    positivePrompt: options.prompt,
    numberOfMedia: options.numberOfMedia,
    duration: options.duration,
    fps: 24,
    width,
    height,
    generateAudio: options.generateAudio,
    outputFormat: 'mp4'
  };
  addReferenceUrls(params, urls);
  if (modelConfig(options.model).supportsTaskType) params.seedanceTaskType = options.taskType;
  return params;
}

function negativeIndices(count) {
  return Array.from({ length: count }, (_, index) => -index - 1);
}

export function buildCreativeAgentRequest(options, urls) {
  const config = modelConfig(options.model);
  const common = {
    prompt: options.prompt,
    videoModel: config.hostedSelector,
    generateAudio: options.generateAudio
  };
  let toolName;
  let args;

  if (options.taskType === 'reference') {
    toolName = 'generate_video';
    args = {
      ...common,
      expandPrompt: true,
      duration: options.duration,
      targetResolution: Number.parseInt(options.resolution, 10),
      numberOfVariations: options.numberOfMedia,
      ...(urls.images.length ? { referenceImageIndices: negativeIndices(urls.images.length) } : {}),
      ...(urls.videos.length ? { referenceVideoIndices: negativeIndices(urls.videos.length) } : {}),
      ...(urls.audios.length ? { referenceAudioIndices: negativeIndices(urls.audios.length) } : {})
    };
  } else if (options.taskType === 'edit') {
    toolName = 'video_to_video';
    args = {
      ...common,
      expandPrompt: true,
      videoSourceIndex: -1,
      controlMode: 'seedance-v2v',
      targetResolution: Number.parseInt(options.resolution, 10),
      ...(urls.images.length ? { sourceImageIndex: -1 } : {})
    };
  } else {
    toolName = 'extend_video';
    args = {
      prompt: options.prompt,
      duration: options.duration,
      videoIndex: -1,
      videoModel: config.hostedSelector
    };
  }

  return {
    tokenType: 'spark',
    mediaReferences: [
      ...urls.images.map((url) => ({ kind: 'image', url })),
      ...urls.videos.map((url) => ({ kind: 'video', url })),
      ...urls.audios.map((url) => ({ kind: 'audio', url }))
    ],
    input: {
      title: `Seedance ${options.taskType} example`,
      steps: [{ id: `seedance_${options.taskType}`, toolName, arguments: args }]
    }
  };
}

function contentTypeForPath(filePath, kind) {
  const contentType = MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
  if (!contentType || !contentType.startsWith(`${kind}/`)) {
    throw new Error(`Unsupported ${kind} file: ${filePath}`);
  }
  return contentType;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${response.status} ${payload?.message || payload?.error?.message || response.statusText}`
    );
  }
  return payload;
}

async function uploadLocalMedia(credentials, options, input, kind) {
  if (!credentials.apiKey) {
    throw new Error(`Uploading local ${kind} files requires SOGNI_API_KEY or an HTTPS URL.`);
  }
  const filePath = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  const contentType = contentTypeForPath(filePath, kind);
  const endpointPath = kind === 'image' ? '/v1/image' : '/v1/media';
  const params = new URLSearchParams({
    jobId: `seedance-r2v-example-${crypto.randomUUID()}`,
    type:
      kind === 'image' ? 'referenceImage' : kind === 'video' ? 'referenceVideo' : 'referenceAudio',
    contentType
  });
  if (kind === 'image') params.set('imageId', crypto.randomUUID());
  const headers = { 'api-key': credentials.apiKey };
  const upload = await requestJson(
    `${options.endpoint}${endpointPath}/uploadUrl?${params.toString()}`,
    { headers }
  );
  const uploadUrl = upload?.data?.uploadUrl;
  if (!uploadUrl) throw new Error(`Upload response omitted data.uploadUrl for ${input}`);
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: await fs.readFile(filePath)
  });
  if (!put.ok) throw new Error(`Failed to upload ${input}: ${put.status} ${put.statusText}`);
  const download = await requestJson(
    `${options.endpoint}${endpointPath}/downloadUrl?${params.toString()}`,
    { headers }
  );
  if (!download?.data?.downloadUrl) {
    throw new Error(`Download response omitted data.downloadUrl for ${input}`);
  }
  return download.data.downloadUrl;
}

async function resolveInput(credentials, options, input, kind, index) {
  if (/^https:\/\//i.test(input)) return input;
  if (/^https?:\/\//i.test(input) || /^data:/i.test(input)) {
    throw new Error(`${kind} references must be local files or HTTPS URLs.`);
  }
  if (options.dryRun) {
    return `https://dry-run.invalid/${kind}/${index + 1}-${encodeURIComponent(path.basename(input))}`;
  }
  return uploadLocalMedia(credentials, options, input, kind);
}

export async function resolveMediaUrls(credentials, options) {
  return {
    images: await Promise.all(
      options.images.map((input, index) =>
        resolveInput(credentials, options, input, 'image', index)
      )
    ),
    videos: await Promise.all(
      options.videos.map((input, index) =>
        resolveInput(credentials, options, input, 'video', index)
      )
    ),
    audios: await Promise.all(
      options.audios.map((input, index) =>
        resolveInput(credentials, options, input, 'audio', index)
      )
    )
  };
}

function showHelp() {
  console.log(`
Seedance 2.5 R2V Operations Example

Usage:
  node workflow_seedance_2_5_r2v.mjs "prompt" --task-type reference|edit|extend [options]

Options:
  --task-type <type>       reference (default), edit, or extend
  --layer <layer>          direct (default) or creative-agent
  --model <id>             seedance-2-5 (default), seedance-2-0, -mini, or -fast
  --duration <seconds>     4-30 for 2.5; 4-15 for the 2.0 family (default: 5)
                           Required for direct edit and must equal @Video1's source duration.
                           For extend, this is the new continuation duration.
  --resolution <tier>     480p or 720p for 2.5 (default: 720p)
  --image <path|https>     Loose image reference; repeatable as @Image1, @Image2, ...
  --video <path|https>     Video reference; repeatable as @Video1, @Video2, ...
  --audio <path|https>     Loose audio reference; repeatable as @Audio1, @Audio2, ...
  --number <n>             Variations, 1-16 (default: 1)
  --no-audio               Request silent output
  --dry-run                Validate and print the request without uploading or generating
  --watch                  Stream Creative Agent workflow events after starting
  --endpoint <url>         REST endpoint for local uploads
  --json                   Print raw result JSON

Semantics:
  reference -> direct seedanceTaskType="reference"; Creative Agent generate_video
  edit      -> direct seedanceTaskType="edit"; Creative Agent video_to_video
  extend    -> direct seedanceTaskType="extend"; Creative Agent extend_video

Seedance 2.5 accepts 30 images, 10 videos, 10 audios, and 50 files total. Audio-only
reference is valid. Edit/extend require @Video1. The 2.0 family keeps 9/3/3/12,
4-15 seconds, requires visual media when audio is attached, and omits seedanceTaskType.
Local files use the existing Sogni signed upload flow; hosted media must use HTTPS.
`);
}

async function createClient(credentials, options) {
  const config = {
    appId: `sogni-seedance-r2v-${options.layer}-${Date.now()}`,
    network: 'fast'
  };
  if (credentials.apiKey) config.apiKey = credentials.apiKey;
  if (process.env.SOGNI_SOCKET_ENDPOINT) config.socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  if (process.env.SOGNI_REST_ENDPOINT) config.restEndpoint = process.env.SOGNI_REST_ENDPOINT;
  if (process.env.SOGNI_TESTNET === 'true') config.testnet = true;
  if (options.layer === 'creative-agent') config.disableSocket = true;
  return SogniClient.createInstance(config);
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    showHelp();
    return;
  }
  validateOptions(options);
  const credentials = options.dryRun ? {} : await loadCredentials();
  const urls = await resolveMediaUrls(credentials, options);
  const request =
    options.layer === 'direct'
      ? buildDirectProjectParams(options, urls)
      : buildCreativeAgentRequest(options, urls);

  if (options.dryRun) {
    console.log(JSON.stringify({ layer: options.layer, request }, null, 2));
    return;
  }

  if (options.layer === 'creative-agent' && !credentials.apiKey) {
    throw new Error('Creative Agent workflows require SOGNI_API_KEY.');
  }
  const sogni = await createClient(credentials, options);
  try {
    if (!credentials.apiKey) await sogni.account.login(credentials.username, credentials.password);
    if (options.layer === 'direct') {
      const project = await sogni.projects.create(request);
      console.log(`Project: ${project.id}`);
      const results = await project.waitForCompletion();
      console.log(options.json ? JSON.stringify(results, null, 2) : results.join('\n'));
      return;
    }

    const workflow = await sogni.workflows.start(request);
    console.log(
      options.json ? JSON.stringify(workflow, null, 2) : `Workflow: ${workflow.workflowId}`
    );
    if (options.watch && workflow.workflowId) {
      for await (const event of sogni.workflows.streamEvents(workflow.workflowId)) {
        console.log(`[${event.id || '-'}] ${event.event}`);
      }
    }
  } finally {
    sogni.dispose();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
