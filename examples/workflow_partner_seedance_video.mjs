#!/usr/bin/env node

/**
 * Partner Seedance Video Example
 *
 * Exercises Seedance through the API paths that match each use case:
 * - T2V defaults to /v1/chat/completions with normal OpenAI-style tool calling.
 * - Media-bearing I2V/IA2V/V2V default to /v1/creative-agent/workflows
 *   hosted_tool_sequence, using uploaded local media or HTTPS media URLs.
 *
 * Examples:
 *   node workflow_partner_seedance_video.mjs
 *   node workflow_partner_seedance_video.mjs "The Slothicorn mascot launches SEEDANCE 2.0 on SOGNI with a spoken teaser line" --duration 4
 *   node workflow_partner_seedance_video.mjs "The Slothicorn mascot launches SEEDANCE 2.0 on SOGNI with a spoken teaser line" --fast --duration 4 --no-audio
 *   node workflow_partner_seedance_video.mjs "slow cinematic reveal" --context portrait.jpg
 *   node workflow_partner_seedance_video.mjs "transition from day to night" --mode i2v --image day.jpg --end-image night.jpg
 *   node workflow_partner_seedance_video.mjs "the portrait sings with stage lighting" --mode ia2v --context portrait.jpg --audio speech.m4a
 *   node workflow_partner_seedance_video.mjs "turn the clip into a polished perfume commercial" --video source.mp4
 *   node workflow_partner_seedance_video.mjs "preserve the product from the image while restyling the video" --mode v2v --video source.mp4 --context product.jpg
 *   node workflow_partner_seedance_video.mjs "Use @Video1 as the source clip, @Video2 and @Video3 for edit rhythm, @Image1 for product identity, @Image2 for palette, @Audio1 for music, @Audio2 for ambience, and @Audio3 for sound accents. Keep the product silhouette consistent." --workflow --mode v2v --video a.mp4 --video b.mp4 --video c.mp4 --context 1.jpg --context 2.jpg --audio a.m4a --audio b.m4a --audio c.m4a
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import {
  askMultilinePrompt,
  askQuestion,
  displayConfig
} from './workflow-helpers.mjs';

const DEFAULT_LLM_MODEL = 'qwen3.6-35b-a3b-gguf-iq4xs';
const DEFAULT_REST_ENDPOINT = 'https://api.sogni.ai';
const SEEDANCE_FPS = 24;
const DEFAULT_PROMPT =
  'A glass whale glides through a rain-slick neon city at night, refracting street lights through its transparent body as the camera drifts alongside it. Cinematic science-fiction mood, graceful motion, premium lighting, crisp reflections, subtle water trails, polished short-film finish.';

const SEEDANCE_MODELS = {
  t2v: {
    seedance2: { id: 'seedance-2-0_t2v', name: 'Seedance 2.0 T2V' },
    'seedance2-fast': { id: 'seedance-2-0-fast_t2v', name: 'Seedance 2.0 Fast T2V' }
  },
  i2v: {
    seedance2: { id: 'seedance-2-0_i2v', name: 'Seedance 2.0 I2V' },
    'seedance2-fast': { id: 'seedance-2-0-fast_i2v', name: 'Seedance 2.0 Fast I2V' }
  },
  ia2v: {
    seedance2: { id: 'seedance-2-0_ia2v', name: 'Seedance 2.0 Image+Audio' }
  },
  v2v: {
    seedance2: { id: 'seedance-2-0_v2v', name: 'Seedance 2.0 V2V' }
  }
};

const TOOL_ARGUMENT_KEYS = {
  sogni_generate_video: new Set([
    'prompt',
    'expand_prompt',
    'reference_image_url',
    'reference_image_end_url',
    'reference_image_urls',
    'reference_video_urls',
    'reference_audio_urls',
    'reference_audio_identity_url',
    'audio_identity_strength',
    'first_frame_strength',
    'last_frame_strength',
    'width',
    'height',
    'duration',
    'fps',
    'generate_audio',
    'model',
    'number_of_variations',
    'seed'
  ]),
  sogni_sound_to_video: new Set([
    'prompt',
    'expand_prompt',
    'reference_audio_url',
    'reference_audio_urls',
    'reference_image_url',
    'reference_image_urls',
    'reference_video_urls',
    'audio_start',
    'duration',
    'generate_audio',
    'width',
    'height',
    'model',
    'number_of_variations',
    'seed'
  ]),
  sogni_video_to_video: new Set([
    'prompt',
    'expand_prompt',
    'reference_video_url',
    'reference_video_urls',
    'control_mode',
    'reference_image_url',
    'reference_image_urls',
    'reference_audio_urls',
    'reference_audio_identity_url',
    'audio_identity_strength',
    'video_start',
    'duration',
    'generate_audio',
    'width',
    'height',
    'model',
    'number_of_variations',
    'seed'
  ])
};

const EXAMPLES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(EXAMPLES_DIR, 'test-assets', 'placeholder.jpg');
const DEFAULT_END_IMAGE = path.join(EXAMPLES_DIR, 'test-assets', 'placeholder2.jpg');
const DEFAULT_AUDIO = path.join(EXAMPLES_DIR, 'test-assets', 'placeholder.m4a');
const DEFAULT_VIDEO = path.join(EXAMPLES_DIR, 'test-assets', 'placeholder.mp4');

const MIME_BY_EXTENSION = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.wav', 'audio/wav'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime']
]);

function hasMediaInputs(options) {
  return Boolean(
    options.images.length ||
      options.audios.length ||
      options.videos.length ||
      options.endImage ||
      options.audioIdentity
  );
}

function displayLocalPath(filePath) {
  if (/^https?:\/\//i.test(filePath)) return filePath;
  const relative = path.relative(process.cwd(), filePath);
  return relative && !relative.startsWith('..') ? relative : filePath;
}

function parseMediaList(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBooleanOption(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`${label} must be true or false.`);
}

function addMediaValues(options, key, values) {
  for (const value of values) {
    options[key].push(value);
  }
  if (key === 'images' && !options.image && options.images.length > 0) {
    options.image = options.images[0];
  } else if (key === 'audios' && !options.audio && options.audios.length > 0) {
    options.audio = options.audios[0];
  } else if (key === 'videos' && !options.video && options.videos.length > 0) {
    options.video = options.videos[0];
  }
}

async function chooseFromList(title, choices, defaultIndex = 0) {
  console.log(`\n${title}\n`);
  choices.forEach((choice, index) => {
    const marker = index === defaultIndex ? ' (default)' : '';
    console.log(`  ${index + 1}. ${choice.label}${marker}`);
    if (choice.description) {
      console.log(`     ${choice.description}`);
    }
  });
  console.log();

  const answer = await askQuestion(
    `Enter choice [1-${choices.length}] (default: ${defaultIndex + 1}): `
  );
  if (!answer.trim()) return choices[defaultIndex];

  const index = Number.parseInt(answer, 10) - 1;
  if (index >= 0 && index < choices.length) {
    return choices[index];
  }

  console.log(`  -> Invalid choice, using ${choices[defaultIndex].label}.`);
  return choices[defaultIndex];
}

async function askYesNoWithDefault(question, defaultValue) {
  const answer = await askQuestion(question);
  if (!answer.trim()) return defaultValue;
  const normalized = answer.toLowerCase();
  if (normalized === 'y' || normalized === 'yes') return true;
  if (normalized === 'n' || normalized === 'no') return false;
  console.log(`  -> Invalid answer, using ${defaultValue ? 'yes' : 'no'}.`);
  return defaultValue;
}

async function askNumberWithDefault(question, defaultValue, { min, max, integer = false } = {}) {
  const answer = await askQuestion(question);
  if (!answer.trim()) return defaultValue;

  const parsed = integer ? Number.parseInt(answer, 10) : Number.parseFloat(answer);
  if (!Number.isFinite(parsed)) {
    console.log(`  -> Invalid number, using ${defaultValue}.`);
    return defaultValue;
  }
  if (min !== undefined && parsed < min) {
    console.log(`  -> Minimum is ${min}, using ${min}.`);
    return min;
  }
  if (max !== undefined && parsed > max) {
    console.log(`  -> Maximum is ${max}, using ${max}.`);
    return max;
  }
  return integer ? Math.trunc(parsed) : parsed;
}

async function askOptionalSeed(defaultValue) {
  const defaultText = Number.isInteger(defaultValue) ? String(defaultValue) : 'random';
  const answer = await askQuestion(`Seed [${defaultText}]: `);
  if (!answer.trim() || answer.toLowerCase() === 'random') return defaultValue;

  const parsed = Number.parseInt(answer, 10);
  if (!Number.isInteger(parsed)) {
    console.log('  -> Invalid seed, using random.');
    return undefined;
  }
  return parsed;
}

function supportsFastTier(mode) {
  return mode === 't2v' || mode === 'i2v';
}

function selectedTierLabel(options) {
  return selectedModelId(options).includes('fast') ? 'Seedance 2.0 Fast' : 'Seedance 2.0';
}

function dimensionPresets(options) {
  const fast = selectedModelId(options).includes('fast');
  if (fast) {
    return [
      {
        label: 'Landscape 16:9 - 1280x720',
        description: 'Fast tier default, 720p-capped.',
        width: 1280,
        height: 720
      },
      {
        label: 'Vertical 9:16 - 720x1280',
        description: 'Short-form social format on the fast tier.',
        width: 720,
        height: 1280
      },
      {
        label: 'Square - 720x720',
        description: 'Compact square output within the fast tier cap.',
        width: 720,
        height: 720
      },
      {
        label: 'Custom size',
        description: 'Enter width and height manually.',
        custom: true
      }
    ];
  }

  return [
    {
      label: 'Cinematic landscape - 1920x1088',
      description: 'Full Seedance default for polished widescreen video.',
      width: 1920,
      height: 1088
    },
    {
      label: 'Vertical social - 1088x1920',
      description: 'Portrait format for reels, shorts, and mobile-first spots.',
      width: 1088,
      height: 1920
    },
    {
      label: 'Square premium - 1088x1088',
      description: 'Balanced square format for feeds and product showcases.',
      width: 1088,
      height: 1088
    },
    {
      label: 'Custom size',
      description: 'Enter width and height manually.',
      custom: true
    }
  ];
}

function printInteractiveIntro() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║          Partner Seedance 2.0 Video Workflow             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Seedance coverage in this example:');
  console.log('  - Text-to-video, image-to-video, image+audio-to-video, and video-to-video');
  console.log('  - Full Seedance 2.0 and Seedance 2.0 Fast tiers where the API exposes both');
  console.log('  - Native audio generation, keyframe interpolation, V2V restyling, and multimodal context');
  console.log('  - Hosted creative workflows with uploaded local media or HTTPS references');
}

async function promptReferenceList(options, key, label) {
  const answer = await askQuestion(`${label} (comma-separated paths or HTTPS URLs, optional): `);
  addMediaValues(options, key, parseMediaList(answer));
}

async function promptMode(options) {
  if (options.mode) return;

  const selection = await chooseFromList(
    'Choose the Seedance workflow:',
    [
      {
        label: 'Text-to-video',
        value: 't2v',
        description: 'Pure prompt-driven video. Can use hosted workflow or chat tool execution.'
      },
      {
        label: 'Image-to-video',
        value: 'i2v',
        description: 'Animate a reference image, optionally with an end keyframe and extra context.'
      },
      {
        label: 'Image+audio-to-video',
        value: 'ia2v',
        description: 'Drive a reference image with speech, music, or sound as a Seedance media workflow.'
      },
      {
        label: 'Video-to-video',
        value: 'v2v',
        description: 'Transform, restyle, or guide a source video with image/audio/video context.'
      }
    ],
    0
  );
  options.mode = selection.value;
}

async function promptTier(options) {
  if (options.model) return;

  if (!supportsFastTier(options.mode)) {
    options.fast = false;
    console.log(
      `\nSeedance 2.0 Fast is not exposed for ${options.mode.toUpperCase()}; using the full Seedance 2.0 tier.`
    );
    return;
  }

  const defaultIndex = options.fast ? 1 : 0;
  const selection = await chooseFromList(
    'Choose the Seedance tier:',
    [
      {
        label: 'Seedance 2.0',
        value: 'full',
        description: 'Full-quality external API model with 1920x1088 default output.'
      },
      {
        label: 'Seedance 2.0 Fast',
        value: 'fast',
        description: 'Lower-latency tier for T2V/I2V with a 720p output cap.'
      }
    ],
    defaultIndex
  );
  options.fast = selection.value === 'fast';
}

async function promptModeMedia(options) {
  console.log();
  console.log('Media references can be local paths or HTTPS URLs.');
  console.log('Use @Image1, @Video1, and @Audio1 in the prompt to assign each reference a role.');

  if (options.mode === 't2v') {
    if (!hasMediaInputs(options)) {
      const addContext = await askYesNoWithDefault(
        '\nAttach Seedance multimodal context media? [y/N]: ',
        false
      );
      if (addContext) {
        await promptReferenceList(options, 'images', 'Image references');
        await promptReferenceList(options, 'videos', 'Video references');
        await promptReferenceList(options, 'audios', 'Audio references');
        if (options.audios.length > 0 && options.images.length === 0 && options.videos.length === 0) {
          console.log('  -> Audio context requires image or video context; using the bundled image sample.');
          addMediaValues(options, 'images', [DEFAULT_IMAGE]);
        }
      }
    }
    return;
  }

  if (options.mode === 'i2v') {
    if (options.images.length === 0) {
      const image = await askQuestion(
        `Primary image [${displayLocalPath(DEFAULT_IMAGE)}]: `
      );
      addMediaValues(options, 'images', [image || DEFAULT_IMAGE]);
    }

    if (!options.endImage) {
      const useEndImage = await askYesNoWithDefault(
        'Add an end image for keyframe interpolation? [y/N]: ',
        false
      );
      if (useEndImage) {
        const endImage = await askQuestion(
          `End image [${displayLocalPath(DEFAULT_END_IMAGE)}]: `
        );
        options.endImage = endImage || DEFAULT_END_IMAGE;
        options.firstFrameStrength = await askNumberWithDefault(
          'First frame strength 0-1 [1]: ',
          1,
          { min: 0, max: 1 }
        );
        options.lastFrameStrength = await askNumberWithDefault(
          'Last frame strength 0-1 [1]: ',
          1,
          { min: 0, max: 1 }
        );
      }
    }

    const addContext = await askYesNoWithDefault(
      'Add extra Seedance context references? [y/N]: ',
      false
    );
    if (addContext) {
      await promptReferenceList(options, 'images', 'Additional image references');
      await promptReferenceList(options, 'videos', 'Video context references');
      await promptReferenceList(options, 'audios', 'Audio context references');
    }
    return;
  }

  if (options.mode === 'ia2v') {
    if (options.images.length === 0) {
      const image = await askQuestion(
        `Driving image [${displayLocalPath(DEFAULT_IMAGE)}]: `
      );
      addMediaValues(options, 'images', [image || DEFAULT_IMAGE]);
    }
    if (options.audios.length === 0) {
      const audio = await askQuestion(
        `Reference audio [${displayLocalPath(DEFAULT_AUDIO)}]: `
      );
      addMediaValues(options, 'audios', [audio || DEFAULT_AUDIO]);
    }
    options.audioStart = await askNumberWithDefault('Audio start offset in seconds [0]: ', 0, {
      min: 0
    });

    const addContext = await askYesNoWithDefault(
      'Add extra image/video/audio context references? [y/N]: ',
      false
    );
    if (addContext) {
      await promptReferenceList(options, 'images', 'Additional image references');
      await promptReferenceList(options, 'videos', 'Video context references');
      await promptReferenceList(options, 'audios', 'Additional audio references');
    }
    return;
  }

  if (options.mode === 'v2v') {
    if (options.videos.length === 0) {
      const video = await askQuestion(
        `Source video [${displayLocalPath(DEFAULT_VIDEO)}]: `
      );
      addMediaValues(options, 'videos', [video || DEFAULT_VIDEO]);
    }
    options.controlMode ||= 'seedance-v2v';
    options.videoStart = await askNumberWithDefault('Video start offset in seconds [0]: ', 0, {
      min: 0
    });

    const addContext = await askYesNoWithDefault(
      'Add image/audio/video context references for style, identity, edit rhythm, or sound? [y/N]: ',
      false
    );
    if (addContext) {
      await promptReferenceList(options, 'images', 'Image context references');
      await promptReferenceList(options, 'videos', 'Additional video context references');
      await promptReferenceList(options, 'audios', 'Audio context references');
    }
  }
}

async function promptEndpoint(options) {
  if (options.target) return;

  if (options.mode !== 't2v' || hasMediaInputs(options)) {
    options.target = 'workflow';
    console.log('\nUsing hosted creative workflow execution for media-bearing Seedance requests.');
    return;
  }

  const selection = await chooseFromList(
    'Choose the API path:',
    [
      {
        label: 'Hosted creative workflow',
        value: 'workflow',
        description: 'Durable /v1/creative-agent/workflows hosted_tool_sequence request.'
      },
      {
        label: 'Chat tool execution',
        value: 'chat',
        description: 'OpenAI-style /v1/chat/completions call that invokes the Sogni video tool.'
      }
    ],
    0
  );
  options.target = selection.value;
}

async function promptCreativeBrief(options) {
  if (options.prompt) return;
  console.log();
  options.prompt = await askMultilinePrompt(
    'Creative brief:',
    DEFAULT_PROMPT,
    { consecutiveEmptyLinesToEnd: 2 }
  );
}

async function promptOutputOptions(options) {
  const presets = dimensionPresets(options);
  if (!options.width || !options.height) {
    const selected = await chooseFromList('Choose output format:', presets, 0);
    if (selected.custom) {
      const defaults = defaultDimensions(options);
      options.width = await askNumberWithDefault(`Width [${defaults.width}]: `, defaults.width, {
        min: 1,
        integer: true
      });
      options.height = await askNumberWithDefault(
        `Height [${defaults.height}]: `,
        defaults.height,
        { min: 1, integer: true }
      );
    } else {
      options.width = selected.width;
      options.height = selected.height;
    }
  }

  options.duration = await askNumberWithDefault(
    `Duration in seconds, 4-15 [${options.duration}]: `,
    options.duration,
    { min: 4, max: 15 }
  );
  options.number = await askNumberWithDefault(
    `Number of variations, 1-16 [${options.number}]: `,
    options.number,
    { min: 1, max: 16, integer: true }
  );

  if (options.generateAudio === undefined) {
    options.generateAudio = await askYesNoWithDefault(
      'Request native audio output when supported? [Y/n]: ',
      true
    );
  }
  options.seed = await askOptionalSeed(options.seed);
  options.expandPrompt = await askYesNoWithDefault(
    'Expand the prompt with the Seedance LLM prompt shaper before dispatch? [Y/n]: ',
    options.expandPrompt !== false
  );
  options.estimate = await askYesNoWithDefault(
    `Fetch cost estimate before submission? [${options.estimate !== false ? 'Y/n' : 'y/N'}]: `,
    options.estimate !== false
  );
  const tokenDefault = options.tokenType === 'sogni' ? 'sogni' : 'spark';
  const tokenType = await askQuestion(`Payment token type [${tokenDefault}]: `);
  if (tokenType.trim()) {
    options.tokenType = tokenType.trim().toLowerCase();
  }
}

async function promptInteractiveOptions(options) {
  printInteractiveIntro();
  await promptMode(options);
  await promptTier(options);
  await promptModeMedia(options);
  await promptEndpoint(options);
  await promptCreativeBrief(options);
  await promptOutputOptions(options);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: '',
    mode: undefined,
    fast: false,
    model: undefined,
    llmModel: DEFAULT_LLM_MODEL,
    endpoint: process.env.SOGNI_REST_ENDPOINT || DEFAULT_REST_ENDPOINT,
    duration: 4,
    fps: SEEDANCE_FPS,
    width: undefined,
    height: undefined,
    number: 1,
    seed: undefined,
    negativePrompt: undefined,
    image: undefined,
    images: [],
    endImage: undefined,
    audio: undefined,
    audios: [],
    audioStart: undefined,
    audioIdentity: undefined,
    audioIdentityStrength: undefined,
    video: undefined,
    videos: [],
    videoStart: undefined,
    controlMode: undefined,
    firstFrameStrength: undefined,
    lastFrameStrength: undefined,
    generateAudio: undefined,
    expandPrompt: true,
    target: undefined,
    execute: true,
    tokenType: loadTokenTypePreference() || process.env.SOGNI_TOKEN_TYPE || 'spark',
    estimate: true,
    interactive: args.length === 0 && process.stdin.isTTY,
    inspectWorkflow: false,
    json: false
  };

  const positional = [];
  let modeWasProvided = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--interactive') {
      options.interactive = true;
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--mode' && args[i + 1]) {
      options.mode = args[++i].toLowerCase();
      modeWasProvided = true;
    } else if (arg === '--fast') {
      options.fast = true;
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--llm-model' && args[i + 1]) {
      options.llmModel = args[++i];
    } else if (arg === '--endpoint' && args[i + 1]) {
      options.endpoint = args[++i].replace(/\/+$/, '');
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseFloat(args[++i]);
    } else if (arg === '--fps' && args[i + 1]) {
      options.fps = parseFloat(args[++i]);
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if ((arg === '--number' || arg === '--variations' || arg === '--batch') && args[i + 1]) {
      options.number = parseInt(args[++i], 10);
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if ((arg === '--negative-prompt' || arg === '--negative') && args[i + 1]) {
      options.negativePrompt = args[++i];
    } else if (
      (arg === '--image' ||
        arg === '--context' ||
        arg === '--context-image' ||
        arg === '--reference-image') &&
      args[i + 1]
    ) {
      const value = args[++i];
      options.image ||= value;
      options.images.push(value);
    } else if (arg === '--end-image' && args[i + 1]) {
      options.endImage = args[++i];
    } else if ((arg === '--audio' || arg === '--reference-audio') && args[i + 1]) {
      const value = args[++i];
      options.audio ||= value;
      options.audios.push(value);
    } else if (arg === '--audio-start' && args[i + 1]) {
      options.audioStart = parseFloat(args[++i]);
    } else if ((arg === '--audio-identity' || arg === '--voice') && args[i + 1]) {
      options.audioIdentity = args[++i];
    } else if (arg === '--audio-identity-strength' && args[i + 1]) {
      options.audioIdentityStrength = parseFloat(args[++i]);
    } else if ((arg === '--video' || arg === '--reference-video') && args[i + 1]) {
      const value = args[++i];
      options.video ||= value;
      options.videos.push(value);
    } else if (arg === '--video-start' && args[i + 1]) {
      options.videoStart = parseFloat(args[++i]);
    } else if (arg === '--control-mode' && args[i + 1]) {
      options.controlMode = args[++i];
    } else if (arg === '--first-frame-strength' && args[i + 1]) {
      options.firstFrameStrength = parseFloat(args[++i]);
    } else if (arg === '--last-frame-strength' && args[i + 1]) {
      options.lastFrameStrength = parseFloat(args[++i]);
    } else if (arg === '--no-audio') {
      options.generateAudio = false;
    } else if (arg === '--generate-audio' || arg === '--with-audio') {
      options.generateAudio = true;
    } else if (arg === '--expand-prompt') {
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        options.expandPrompt = parseBooleanOption(args[++i], '--expand-prompt');
      } else {
        options.expandPrompt = true;
      }
    } else if (arg === '--no-expand-prompt') {
      options.expandPrompt = false;
    } else if (arg === '--target' && args[i + 1]) {
      options.target = args[++i].toLowerCase();
    } else if (arg === '--chat') {
      options.target = 'chat';
    } else if (arg === '--workflow') {
      options.target = 'workflow';
    } else if (arg === '--no-execute' || arg === '--dry-run') {
      options.execute = false;
    } else if (arg === '--token-type' && args[i + 1]) {
      options.tokenType = args[++i];
    } else if (arg === '--no-estimate') {
      options.estimate = false;
    } else if (arg === '--inspect-workflow') {
      options.inspectWorkflow = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  options.prompt = positional.join(' ').trim();
  if (!modeWasProvided && options.model) {
    options.mode = inferModeFromModelSelector(options.model) || options.mode;
  }
  if (!modeWasProvided && !options.mode) {
    options.mode = inferModeFromMedia(options) || (options.interactive ? undefined : 't2v');
  }
  if (!options.interactive) {
    options.mode ||= 't2v';
    options.target =
      options.target || (options.mode === 't2v' && !hasMediaInputs(options) ? 'chat' : 'workflow');
  }
  return options;
}

function showHelp() {
  console.log(`
Partner Seedance Video Example

Usage:
  node workflow_partner_seedance_video.mjs                    # Guided interactive mode
  node workflow_partner_seedance_video.mjs "prompt" [options]

Modes:
  t2v   Text-to-video through chat/completions or hosted workflow
  i2v   Image-to-video through hosted workflow; inferred from --image/--context
  ia2v  Image+audio-to-video through hosted workflow
  v2v   Video-to-video through hosted workflow; inferred from --video

Seedance models:
  seedance-2-0_t2v        seedance-2-0-fast_t2v
  seedance-2-0_i2v        seedance-2-0-fast_i2v
  seedance-2-0_ia2v
  seedance-2-0_v2v

Options:
  --interactive           Run the guided Seedance workflow setup
  --no-interactive        Skip prompts and use command-line/default values
  --chat                 Use /v1/chat/completions (t2v only)
  --workflow             Use /v1/creative-agent/workflows hosted_tool_sequence
  --fast                 Use Seedance 2.0 Fast for t2v/i2v (720p cap)
  --model <selector>     Override model selector or model id
  --duration <seconds>   4-15 seconds for Seedance (default: 4)
  --fps <n>              Seedance endpoint FPS; must be 24 (default: 24)
  --width <px>           Output width (default: 1280 for fast, 1920 otherwise)
  --height <px>          Output height (default: 720 for fast, 1088 otherwise)
  --image <path|https>   Reference image for i2v, ia2v, or v2v context; repeatable
  --context <path|https> Alias for --image; repeatable
  --end-image <path|https> Optional final frame image for i2v interpolation
  --audio <path|https>   Reference audio for ia2v or Seedance audio context; repeatable
  --audio-start <sec>    Start offset into --audio for ia2v
  --audio-identity <path|https> Voice identity audio for t2v/i2v/v2v endpoint schema
  --audio-identity-strength <n> Voice identity strength, 0-10
  --video <path|https>   Source video for v2v or Seedance video context; repeatable
  --video-start <sec>    Start offset into --video for v2v
  --control-mode <mode>  V2V control mode; Seedance uses seedance-v2v
  --first-frame-strength <n> First-frame strength for i2v with --end-image, 0-1
  --last-frame-strength <n> Last-frame strength for i2v with --end-image, 0-1
  --negative-prompt <text> Accepted for CLI parity; ignored because Seedance does not support it
  --expand-prompt        Ask Sogni API to run Seedance LLM prompt expansion before dispatch (default)
  --no-expand-prompt     Send the compact prompt directly without Seedance LLM prompt expansion
  --no-audio             Request silent Seedance output by setting generate_audio=false
  --generate-audio       Explicitly request generate_audio=true
  --number <n>           Number of variations (default: 1)
  --batch <n>            Alias for --number
  --seed <n>             Seed
  --no-execute           Print or request a dry-run response without executing Sogni tools
  --dry-run              Alias for --no-execute
  --no-estimate          Skip the video cost-estimate request
  --inspect-workflow     Fetch the creative workflow record returned by chat/completions
  --llm-model <id>       Chat model (default: ${DEFAULT_LLM_MODEL})
  --endpoint <url>       REST endpoint (default: SOGNI_REST_ENDPOINT or ${DEFAULT_REST_ENDPOINT})
  --token-type <type>    spark, sogni, or auto
  --json                 Print raw response

Execution requires SOGNI_API_KEY in examples/.env or the environment. Local media inputs are uploaded with the existing Sogni media upload endpoints before workflow execution. Workflow dry-runs also upload local media so the printed request contains real HTTPS media URLs. Seedance accepts at most 9 image assets, 3 video assets, 3 audio assets, and 12 assets total. In prompts, use @Image1/@Video1/@Audio1 role tags counted independently by modality in attachment order, and use positive preservation language. Exact readable text/logos, lip-sync, voice cloning, and real-human-reference behavior need review.
`);
}

function validateOptions(options) {
  if (!['t2v', 'i2v', 'ia2v', 'v2v'].includes(options.mode)) {
    throw new Error('--mode must be one of: t2v, i2v, ia2v, v2v');
  }
  if (!['chat', 'workflow'].includes(options.target)) {
    throw new Error('--target must be chat or workflow');
  }
  if (options.target === 'chat' && options.mode !== 't2v') {
    throw new Error('Media-bearing Seedance modes use --workflow, not /v1/chat/completions.');
  }
  if (options.target === 'chat' && options.audioIdentity) {
    throw new Error('T2V with --audio-identity is media-bearing and must use --workflow.');
  }
  if (options.duration < 4 || options.duration > 15) {
    throw new Error('Seedance duration must be between 4 and 15 seconds.');
  }
  if (options.fps !== SEEDANCE_FPS) {
    throw new Error('Seedance endpoint generation is fixed at 24fps; use --fps 24 or omit --fps.');
  }
  if (!Number.isInteger(options.number) || options.number < 1 || options.number > 16) {
    throw new Error('--number/--batch must be an integer from 1 to 16.');
  }
  if (options.width !== undefined && (!Number.isInteger(options.width) || options.width <= 0)) {
    throw new Error('--width must be a positive integer.');
  }
  if (options.height !== undefined && (!Number.isInteger(options.height) || options.height <= 0)) {
    throw new Error('--height must be a positive integer.');
  }
  validateRangeOption(options.firstFrameStrength, '--first-frame-strength', 0, 1);
  validateRangeOption(options.lastFrameStrength, '--last-frame-strength', 0, 1);
  validateRangeOption(options.audioIdentityStrength, '--audio-identity-strength', 0, 10);
  validateNonNegativeOption(options.audioStart, '--audio-start');
  validateNonNegativeOption(options.videoStart, '--video-start');
  validateMediaOptions(options);
  selectedModelConfig(options);
}

function validateRangeOption(value, label, min, max) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number from ${min} to ${max}.`);
  }
}

function validateNonNegativeOption(value, label) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number.`);
  }
}

function validateMediaOptions(options) {
  if (options.controlMode !== undefined && options.controlMode !== 'seedance-v2v') {
    throw new Error('This Seedance partner example only supports --control-mode seedance-v2v.');
  }

  const imageAssetCount = options.images.length + (options.endImage ? 1 : 0);
  const videoAssetCount = options.videos.length;
  const audioAssetCount = options.audios.length + (options.audioIdentity ? 1 : 0);
  const totalAssetCount = imageAssetCount + videoAssetCount + audioAssetCount;
  if (imageAssetCount > 9) {
    throw new Error('Seedance supports at most 9 image assets.');
  }
  if (videoAssetCount > 3) {
    throw new Error('Seedance supports at most 3 video assets.');
  }
  if (audioAssetCount > 3) {
    throw new Error('Seedance supports at most 3 audio assets.');
  }
  if (totalAssetCount > 12) {
    throw new Error('Seedance supports at most 12 total asset files.');
  }
  if (audioAssetCount > 0 && imageAssetCount === 0 && videoAssetCount === 0) {
    throw new Error('Seedance audio references require at least one image or video reference.');
  }

  if (options.mode === 't2v') {
    if (options.target === 'chat' && totalAssetCount > 0) {
      throw new Error(
        'T2V with media references must use --workflow; /v1/chat/completions is pure text-to-video in this example.'
      );
    }
    return;
  }

  if (options.mode === 'i2v') {
    return;
  }

  if (options.mode === 'ia2v') {
    if (options.endImage || options.audioIdentity) {
      throw new Error('ia2v accepts --image/--context, --audio, and optional Seedance context videos only.');
    }
    return;
  }

  if (options.mode === 'v2v' && options.endImage) {
    throw new Error(
      'v2v accepts --video plus optional --image/--context and --audio context. Use i2v for --end-image.'
    );
  }
}

function inferModeFromMedia(options) {
  if (options.video) return 'v2v';
  if (options.audio) return 'ia2v';
  if (options.image || options.endImage) return 'i2v';
  return null;
}

function inferModeFromModelSelector(modelSelector) {
  const selector = String(modelSelector || '').toLowerCase();
  for (const [mode, models] of Object.entries(SEEDANCE_MODELS)) {
    if (Object.values(models).some((model) => model.id === selector)) {
      return mode;
    }
  }
  return selector.match(/_(t2v|i2v|ia2v|v2v)$/)?.[1];
}

function resolveModelConfig(mode, modelSelector) {
  const models = SEEDANCE_MODELS[mode] || {};
  const selector = String(modelSelector || '').toLowerCase();
  return models[selector] || Object.values(models).find((model) => model.id === selector);
}

function selectedModelConfig(options) {
  const selector = options.model || (options.fast ? 'seedance2-fast' : 'seedance2');
  const modelConfig = resolveModelConfig(options.mode, selector);
  if (!modelConfig) {
    const supported = Object.values(SEEDANCE_MODELS[options.mode] || {})
      .flatMap((model) => [model.id])
      .join(', ');
    throw new Error(
      `Unsupported Seedance model selector for ${options.mode}: ${selector}. Supported model ids: ${supported}`
    );
  }
  return modelConfig;
}

function selectedModelId(options) {
  return selectedModelConfig(options).id;
}

function defaultDimensions(options) {
  const fast = selectedModelId(options).includes('fast');
  return {
    width: options.width || (fast ? 1280 : 1920),
    height: options.height || (fast ? 720 : 1088)
  };
}

function toolNameForMode(mode) {
  if (mode === 'ia2v') return 'sogni_sound_to_video';
  if (mode === 'v2v') return 'sogni_video_to_video';
  return 'sogni_generate_video';
}

function estimateModelIdForMode(mode, modelSelector) {
  const modelConfig = resolveModelConfig(mode, modelSelector);
  if (modelConfig?.id) return modelConfig.id;

  throw new Error(`Cannot estimate unknown Seedance model selector: ${modelSelector}`);
}

function seedanceFrameCount(duration, fps) {
  return Math.round(duration * fps);
}

async function getVideoJobEstimate(
  tokenType,
  modelId,
  width,
  height,
  frames,
  fps,
  steps,
  videoCount = 1
) {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const url = `${baseUrl}/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}/${videoCount}`;
  console.log(`🔗 Video cost estimate URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

function formatDecimal(value, digits = 4) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : String(value ?? 'n/a');
}

function printEstimateSummary(estimate) {
  const project = estimate?.quote?.project || {};
  const request = estimate?.request || {};

  console.log('Cost estimate:');
  console.log(`Model:     ${request.model || '(unknown)'}`);
  console.log(`Frames:    ${request.frames || '(unknown)'} @ ${request.fps || 24}fps`);
  console.log(`Spark:     ${formatDecimal(project.costInSpark, 4)}`);
  console.log(`SOGNI:     ${formatDecimal(project.costInSogni, 4)}`);
  console.log(`USD:       $${formatDecimal(project.costInUSD, 6)}`);
  console.log();
}

function contentTypeForPath(filePath, expectedKind) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXTENSION.get(extension);
  if (!contentType) {
    throw new Error(`Unsupported ${expectedKind} file type: ${extension || '(none)'}`);
  }
  if (!contentType.startsWith(`${expectedKind}/`)) {
    throw new Error(`${filePath} is ${contentType}, not ${expectedKind}.`);
  }
  return contentType;
}

function resolveLocalPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return payload;
}

async function uploadLocalMedia(credentials, options, filePath, kind, assetType) {
  const resolved = resolveLocalPath(filePath);
  const contentType = contentTypeForPath(resolved, kind);
  const bytes = await fs.readFile(resolved);
  const jobId = `seedance-example-${crypto.randomUUID()}`;
  const imageId = kind === 'image' ? crypto.randomUUID() : undefined;
  const endpointPath = kind === 'image' ? '/v1/image' : '/v1/media';
  const params = new URLSearchParams({
    jobId,
    type: assetType,
    contentType
  });
  if (imageId) params.set('imageId', imageId);

  const headers = { 'api-key': credentials.apiKey };
  const uploadPayload = await requestJson(
    `${options.endpoint}${endpointPath}/uploadUrl?${params.toString()}`,
    { headers }
  );
  const uploadUrl = uploadPayload?.data?.uploadUrl;
  if (!uploadUrl) {
    throw new Error(`Upload URL response did not include data.uploadUrl for ${filePath}`);
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: bytes
  });
  if (!uploadResponse.ok) {
    throw new Error(
      `Failed to upload ${filePath}: ${uploadResponse.status} ${uploadResponse.statusText}`
    );
  }

  const downloadPayload = await requestJson(
    `${options.endpoint}${endpointPath}/downloadUrl?${params.toString()}`,
    { headers }
  );
  const downloadUrl = downloadPayload?.data?.downloadUrl;
  if (!downloadUrl) {
    throw new Error(`Download URL response did not include data.downloadUrl for ${filePath}`);
  }
  return downloadUrl;
}

async function mediaInputUrl(credentials, options, value, kind, assetType, fallbackPath) {
  const input = value || fallbackPath;
  if (!input) return undefined;
  if (/^data:/i.test(input)) {
    throw new Error(
      'Base64 data URIs are not used by this example. Pass a local file path or HTTPS URL.'
    );
  }
  if (/^https:\/\//i.test(input)) {
    return input;
  }
  if (/^http:\/\//i.test(input)) {
    throw new Error(`${kind} media URLs must use HTTPS.`);
  }
  if (!credentials.apiKey) {
    throw new Error(
      `Uploading local ${kind} media requires SOGNI_API_KEY. Set SOGNI_API_KEY or pass an HTTPS URL.`
    );
  }
  return uploadLocalMedia(credentials, options, input, kind, assetType);
}

async function mediaInputUrls(credentials, options, values, kind, assetType, fallbackPath) {
  const inputs = values.length ? values : fallbackPath ? [fallbackPath] : [];
  const urls = await Promise.all(
    inputs.map((value) => mediaInputUrl(credentials, options, value, kind, assetType))
  );
  return urls.filter(Boolean);
}

function needsLocalUpload(value, fallbackPath) {
  const input = value || fallbackPath;
  return Boolean(input && !/^https:\/\//i.test(input));
}

function valuesNeedLocalUpload(values) {
  return values.some((value) => needsLocalUpload(value));
}

function needsLocalMediaUpload(options) {
  if (options.audioIdentity && needsLocalUpload(options.audioIdentity)) return true;
  if (valuesNeedLocalUpload(options.images)) return true;
  if (valuesNeedLocalUpload(options.audios)) return true;
  if (valuesNeedLocalUpload(options.videos)) return true;

  if (options.mode === 'i2v') {
    return (
      (options.images.length === 0 && needsLocalUpload(undefined, options.endImage ? undefined : DEFAULT_IMAGE)) ||
      needsLocalUpload(options.endImage)
    );
  }

  if (options.mode === 'ia2v') {
    return (
      (options.images.length === 0 && needsLocalUpload(undefined, DEFAULT_IMAGE)) ||
      (options.audios.length === 0 && needsLocalUpload(undefined, DEFAULT_AUDIO))
    );
  }

  if (options.mode === 'v2v') {
    return options.videos.length === 0 && needsLocalUpload(undefined, DEFAULT_VIDEO);
  }

  return false;
}

async function buildToolArguments(credentials, options) {
  const { width, height } = defaultDimensions(options);
  const toolName = toolNameForMode(options.mode);
  const imageUrls = await mediaInputUrls(
    credentials,
    options,
    options.images,
    'image',
    'referenceImage',
    options.mode === 'i2v' && !options.endImage
      ? DEFAULT_IMAGE
      : options.mode === 'ia2v'
        ? DEFAULT_IMAGE
        : undefined
  );
  const audioUrls = await mediaInputUrls(
    credentials,
    options,
    options.audios,
    'audio',
    'referenceAudio',
    options.mode === 'ia2v' ? DEFAULT_AUDIO : undefined
  );
  const videoUrls = await mediaInputUrls(
    credentials,
    options,
    options.videos,
    'video',
    'referenceVideo',
    options.mode === 'v2v' ? DEFAULT_VIDEO : undefined
  );
  const args = {
    prompt: options.prompt || DEFAULT_PROMPT,
    expand_prompt: options.expandPrompt !== false,
    model: selectedModelId(options),
    duration: options.duration,
    width,
    height,
    number_of_variations: options.number
  };
  if (Number.isInteger(options.seed)) {
    args.seed = options.seed;
  }
  if (options.generateAudio !== undefined) {
    args.generate_audio = options.generateAudio;
  }

  if (options.mode === 't2v' || options.mode === 'i2v') {
    args.fps = options.fps;
  }

  if (options.mode === 't2v') {
    if (imageUrls.length) {
      args.reference_image_urls = imageUrls;
    }
    if (videoUrls.length) {
      args.reference_video_urls = videoUrls;
    }
    if (audioUrls.length) {
      args.reference_audio_urls = audioUrls;
    }
    if (options.audioIdentity) {
      args.reference_audio_identity_url = await mediaInputUrl(
        credentials,
        options,
        options.audioIdentity,
        'audio',
        'referenceAudioIdentity'
      );
    }
    if (options.audioIdentityStrength !== undefined) {
      args.audio_identity_strength = options.audioIdentityStrength;
    }
  } else if (options.mode === 'i2v') {
    args.reference_image_url = imageUrls[0];
    if (imageUrls.length > 1) {
      args.reference_image_urls = imageUrls.slice(1);
    }
    if (options.endImage) {
      args.reference_image_end_url = await mediaInputUrl(
        credentials,
        options,
        options.endImage,
        'image',
        'referenceImageEnd'
      );
      args.first_frame_strength = options.firstFrameStrength ?? 1;
      args.last_frame_strength = options.lastFrameStrength ?? 1;
    }
    if (options.audioIdentity) {
      args.reference_audio_identity_url = await mediaInputUrl(
        credentials,
        options,
        options.audioIdentity,
        'audio',
        'referenceAudioIdentity'
      );
    }
    if (options.audioIdentityStrength !== undefined) {
      args.audio_identity_strength = options.audioIdentityStrength;
    }
    if (videoUrls.length) {
      args.reference_video_urls = videoUrls;
    }
    if (audioUrls.length) {
      args.reference_audio_urls = audioUrls;
    }
  } else if (options.mode === 'ia2v') {
    args.reference_image_url = imageUrls[0];
    if (imageUrls.length > 1) {
      args.reference_image_urls = imageUrls.slice(1);
    }
    args.reference_audio_url = audioUrls[0];
    if (audioUrls.length > 1) {
      args.reference_audio_urls = audioUrls.slice(1);
    }
    if (videoUrls.length) {
      args.reference_video_urls = videoUrls;
    }
    if (options.audioStart !== undefined) {
      args.audio_start = options.audioStart;
    }
  } else if (options.mode === 'v2v') {
    args.reference_video_url = videoUrls[0];
    if (videoUrls.length > 1) {
      args.reference_video_urls = videoUrls.slice(1);
    }
    args.control_mode = options.controlMode || 'seedance-v2v';
    if (imageUrls.length) {
      args.reference_image_url = imageUrls[0];
    }
    if (imageUrls.length > 1) {
      args.reference_image_urls = imageUrls.slice(1);
    }
    if (audioUrls.length) {
      args.reference_audio_urls = audioUrls;
    }
    if (options.audioIdentity) {
      args.reference_audio_identity_url = await mediaInputUrl(
        credentials,
        options,
        options.audioIdentity,
        'audio',
        'referenceAudioIdentity'
      );
    }
    if (options.audioIdentityStrength !== undefined) {
      args.audio_identity_strength = options.audioIdentityStrength;
    }
    if (options.videoStart !== undefined) {
      args.video_start = options.videoStart;
    }
  }

  assertKnownToolArguments(toolName, args);
  return args;
}

function assertKnownToolArguments(toolName, args) {
  const known = TOOL_ARGUMENT_KEYS[toolName];
  if (!known) return;
  const unknown = Object.keys(args).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new Error(`${toolName} does not accept argument(s): ${unknown.join(', ')}`);
  }
}

function buildChatInstruction(options, toolName, toolArguments) {
  const promptExpansionInstruction = toolArguments.expand_prompt
    ? 'Set expand_prompt=true so sogni-api runs the shared @sogni/creative-agent Seedance prompt shaper before dispatch.'
    : 'Set expand_prompt=false so sogni-api sends the compact prompt directly without Seedance prompt expansion.';
  return [
    `Create exactly one Seedance 2.0 ${options.mode.toUpperCase()} job by calling ${toolName}.`,
    'Use the provided tool arguments exactly. Do not ask follow-up questions.',
    'Keep the prompt value as the compact creative brief.',
    promptExpansionInstruction,
    'For media references, use Seedance role tags such as @Image1, @Video1, and @Audio1 in attachment order. Do not construct BytePlus JSON.',
    'Tool arguments:',
    JSON.stringify(toolArguments, null, 2)
  ].join('\n');
}

function chatToolDefinition(toolName) {
  const commonVideoProperties = {
    prompt: {
      type: 'string',
      description: 'Compact creative brief to generate or transform into video.'
    },
    expand_prompt: {
      type: 'boolean',
      description:
        'Seedance only. Whether Sogni API should expand this compact prompt with the shared Seedance LLM prompt shaper before dispatch. Defaults to true.'
    },
    model: {
      type: 'string',
      description: 'Seedance model id or selector.'
    },
    duration: {
      type: 'number',
      description: 'Output video duration in seconds. Seedance supports 4-15 seconds.'
    },
    width: {
      type: 'integer',
      description: 'Output video width in pixels.'
    },
    height: {
      type: 'integer',
      description: 'Output video height in pixels.'
    },
    number_of_variations: {
      type: 'integer',
      description: 'Number of video variations to generate.'
    },
    seed: {
      type: 'integer',
      description: 'Optional deterministic seed.'
    },
    generate_audio: {
      type: 'boolean',
      description:
        'Whether external API video models such as Seedance should generate native audio. Set false for silent output.'
    }
  };

  if (toolName === 'sogni_generate_video') {
    return {
      type: 'function',
      function: {
        name: toolName,
        description: 'Generate a video with Sogni hosted video models, including Seedance.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt'],
          properties: {
            ...commonVideoProperties,
            fps: {
              type: 'number',
              description: 'Output FPS. Seedance is fixed at 24fps.'
            }
          }
        }
      }
    };
  }

  return {
    type: 'function',
    function: {
      name: toolName,
      description: `Execute ${toolName} with the exact JSON arguments provided by the user.`,
      parameters: {
        type: 'object',
        additionalProperties: true,
        required: ['prompt'],
        properties: commonVideoProperties
      }
    }
  };
}

async function postChatCompletion(credentials, options, toolName, toolArguments) {
  return requestJson(`${options.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': credentials.apiKey
    },
    body: JSON.stringify({
      model: options.llmModel,
      messages: [
        {
          role: 'system',
          content:
            'You are a precise Sogni media production router. When a Sogni tool is requested, call the requested tool with the exact JSON arguments provided by the user.'
        },
        {
          role: 'user',
          content: buildChatInstruction(options, toolName, toolArguments)
        }
      ],
      temperature: 0.1,
      max_tokens: 1600,
      chat_template_kwargs: { enable_thinking: false },
      token_type: options.tokenType,
      sogni_tools: true,
      sogni_tool_execution: options.execute,
      tools: [chatToolDefinition(toolName)],
      tool_choice: {
        type: 'function',
        function: { name: toolName }
      }
    })
  });
}

function workflowRequest(options, toolName, toolArguments) {
  return {
    kind: 'hosted_tool_sequence',
    token_type: options.tokenType,
    input: {
      title: `Seedance ${options.mode.toUpperCase()} example`,
      steps: [
        {
          id: `seedance_${options.mode}`,
          toolName,
          arguments: toolArguments
        }
      ]
    }
  };
}

async function postWorkflow(credentials, options, requestBody) {
  return requestJson(`${options.endpoint}/v1/creative-agent/workflows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': credentials.apiKey
    },
    body: JSON.stringify(requestBody)
  });
}

function extractData(payload) {
  return payload?.data || payload;
}

function extractMessage(payload) {
  return extractData(payload)?.choices?.[0]?.message || {};
}

function extractMediaUrls(content) {
  if (typeof content !== 'string') return [];
  const matches = [...content.matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map((match) => match[1]);
  return [...new Set(matches)];
}

function workflowArtifacts(workflow) {
  return Array.isArray(workflow?.artifacts) ? workflow.artifacts : [];
}

function summarizeChatExecution(payload) {
  const data = extractData(payload);
  const message = extractMessage(payload);
  const content = message.content || '';
  const workflows = data?.creative_workflows || data?.creativeWorkflows || [];
  const mediaUrls = extractMediaUrls(content);

  return {
    content,
    mediaUrls,
    workflows,
    toolCalls: message.tool_calls || []
  };
}

function assertChatExecutedResponse(payload) {
  const { content, mediaUrls, workflows } = summarizeChatExecution(payload);
  const failedWorkflow = workflows.find((workflow) => workflow.status === 'failed');
  if (failedWorkflow) {
    const id = failedWorkflow.workflowId || failedWorkflow.id || 'unknown';
    throw new Error(`Endpoint tool execution failed in workflow ${id}.`);
  }
  if (mediaUrls.length > 0 || workflows.length > 0) return;

  const failurePattern =
    /\b(error|failed|failure|unable|cannot fulfill|encountered an issue|requires?|not accepted|only accepts|please provide)\b/i;
  const firstLine = content.split('\n').find((line) => line.trim()) || content;
  if (failurePattern.test(content)) {
    throw new Error(`Endpoint tool execution failed: ${firstLine.trim()}`);
  }
  throw new Error(
    `Endpoint tool execution did not return generated media or a workflow reference: ${firstLine.trim()}`
  );
}

function assertWorkflowExecutedResponse(payload) {
  const workflow = extractData(payload)?.workflow;
  if (!workflow) {
    throw new Error('Workflow response did not include data.workflow');
  }
  if (workflow.status === 'failed') {
    const message =
      workflow.error?.message || workflow.events?.at?.(-1)?.message || 'workflow failed';
    throw new Error(`Workflow execution failed: ${message}`);
  }
  if (workflow.status === 'completed' && workflowArtifacts(workflow).length === 0) {
    throw new Error('Workflow completed without generated artifacts.');
  }
}

async function fetchWorkflow(credentials, endpoint, workflowRef) {
  const url = workflowRef?.url
    ? workflowRef.url.startsWith('http')
      ? workflowRef.url
      : `${endpoint}${workflowRef.url}`
    : null;
  if (!url) return null;

  const response = await fetch(url, {
    headers: { 'api-key': credentials.apiKey }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function printChatSummary(payload, toolArguments) {
  const { content, mediaUrls, workflows, toolCalls } = summarizeChatExecution(payload);

  console.log('Seedance chat endpoint request submitted.');
  console.log(`Model:     ${toolArguments.model}`);
  console.log(`Duration:  ${toolArguments.duration}s`);
  console.log(`Size:      ${toolArguments.width}x${toolArguments.height}`);
  if (toolArguments.generate_audio !== undefined) {
    console.log(`Audio:     ${toolArguments.generate_audio ? 'enabled' : 'disabled'}`);
  }

  if (toolCalls.length > 0) {
    console.log('\nTool calls:');
    for (const call of toolCalls) {
      console.log(`  - ${call.function?.name || call.name || call.id || 'tool_call'}`);
    }
  }

  if (mediaUrls.length > 0) {
    console.log('\nGenerated media:');
    for (const url of mediaUrls) {
      console.log(`  - ${url}`);
    }
  }

  if (workflows.length > 0) {
    console.log('\nCreative workflows:');
    for (const workflow of workflows) {
      console.log(`  - ${workflow.workflowId || workflow.id}: ${workflow.status || 'submitted'}`);
      if (workflow.url) console.log(`    ${workflow.url}`);
    }
  }

  if (content && mediaUrls.length === 0) {
    console.log('\nResponse:');
    console.log(content);
  }
}

function printWorkflowSummary(payload, toolArguments) {
  const workflow = extractData(payload)?.workflow;
  console.log('Seedance hosted workflow submitted.');
  console.log(`Workflow:  ${workflow?.workflowId || '(unknown)'}`);
  console.log(`Status:    ${workflow?.status || '(unknown)'}`);
  console.log(`Model:     ${toolArguments.model}`);
  console.log(`Duration:  ${toolArguments.duration}s`);
  console.log(`Size:      ${toolArguments.width}x${toolArguments.height}`);
  if (toolArguments.generate_audio !== undefined) {
    console.log(`Audio:     ${toolArguments.generate_audio ? 'enabled' : 'disabled'}`);
  }

  const artifacts = workflowArtifacts(workflow);
  if (artifacts.length > 0) {
    console.log('\nArtifacts:');
    for (const artifact of artifacts) {
      const label = artifact.kind || artifact.type || artifact.mediaType || 'artifact';
      console.log(`  - ${label}: ${artifact.url || artifact.id || JSON.stringify(artifact)}`);
    }
  }

  const lastEvent = Array.isArray(workflow?.events) ? workflow.events.at(-1) : null;
  if (lastEvent?.message) {
    console.log(`\nLast event: ${lastEvent.message}`);
  }
}

function summarizeList(values) {
  return values.length ? values.map((value) => displayLocalPath(value)).join(', ') : undefined;
}

function printRunConfiguration(options, toolName, toolArguments) {
  displayConfig('Seedance Generation Configuration', {
    Mode: options.mode.toUpperCase(),
    Tier: selectedTierLabel(options),
    Endpoint: options.target === 'workflow' ? 'creative-agent workflow' : 'chat tool execution',
    Tool: toolName,
    Model: toolArguments.model,
    Prompt: toolArguments.prompt,
    Resolution: `${toolArguments.width}x${toolArguments.height}`,
    Duration: `${toolArguments.duration}s`,
    FPS: options.fps,
    Variations: toolArguments.number_of_variations,
    Audio:
      toolArguments.generate_audio === undefined
        ? 'server default'
        : toolArguments.generate_audio
          ? 'requested'
          : 'disabled',
    'Prompt Expansion': toolArguments.expand_prompt ? 'enabled' : 'disabled',
    Images: summarizeList(options.images),
    'End Image': options.endImage ? displayLocalPath(options.endImage) : undefined,
    Videos: summarizeList(options.videos),
    Audios: summarizeList(options.audios),
    Seed: Number.isInteger(toolArguments.seed) ? toolArguments.seed : 'random',
    Token: options.tokenType
  });
}

async function main() {
  const options = parseArgs();

  if (options.interactive) {
    await promptInteractiveOptions(options);
  }

  if (!options.mode) {
    options.mode = inferModeFromMedia(options) || 't2v';
  }
  options.target =
    options.target || (options.mode === 't2v' && !hasMediaInputs(options) ? 'chat' : 'workflow');
  validateOptions(options);

  if (!options.prompt && process.stdin.isTTY && !options.interactive) {
    const answer = await askQuestion(`Prompt [${DEFAULT_PROMPT}]: `);
    options.prompt = answer || DEFAULT_PROMPT;
  }
  if (!options.prompt) {
    options.prompt = DEFAULT_PROMPT;
  }

  const shouldLoadCredentials =
    options.execute || options.target !== 'workflow' || needsLocalMediaUpload(options);
  const credentials = shouldLoadCredentials
    ? await loadCredentials()
    : { apiKey: process.env.SOGNI_API_KEY || '' };
  if ((options.target !== 'workflow' || options.execute) && !credentials.apiKey) {
    throw new Error('Partner Seedance video examples require SOGNI_API_KEY API-key auth.');
  }

  const toolName = toolNameForMode(options.mode);
  const toolArguments = await buildToolArguments(credentials, options);
  if (!options.json) {
    printRunConfiguration(options, toolName, toolArguments);
  }
  if (options.estimate) {
    const estimateModelId = estimateModelIdForMode(options.mode, toolArguments.model);
    const estimateFps = options.fps;
    const estimateFrames = seedanceFrameCount(toolArguments.duration, estimateFps);
    const estimate = await getVideoJobEstimate(
      options.tokenType === 'sogni' ? 'sogni' : 'spark',
      estimateModelId,
      toolArguments.width,
      toolArguments.height,
      estimateFrames,
      estimateFps,
      0,
      toolArguments.number_of_variations || 1
    );
    if (!options.json) {
      printEstimateSummary(estimate);
    }
  }

  if (options.interactive && options.execute) {
    const proceed = await askYesNoWithDefault('Proceed with Seedance generation? [Y/n]: ', true);
    if (!proceed) {
      console.log('Generation cancelled.');
      return;
    }
  }

  if (options.target === 'workflow') {
    const requestBody = workflowRequest(options, toolName, toolArguments);
    if (!options.execute) {
      console.log(JSON.stringify(requestBody, null, 2));
      return;
    }
    const payload = await postWorkflow(credentials, options, requestBody);
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      printWorkflowSummary(payload, toolArguments);
    }
    assertWorkflowExecutedResponse(payload);
    return;
  }

  const payload = await postChatCompletion(credentials, options, toolName, toolArguments);
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printChatSummary(payload, toolArguments);
  }
  if (options.execute) {
    assertChatExecutedResponse(payload);
  }

  if (options.inspectWorkflow) {
    const workflow = (extractData(payload)?.creative_workflows || [])[0];
    const workflowRecord = await fetchWorkflow(credentials, options.endpoint, workflow);
    if (workflowRecord) {
      console.log('\nWorkflow record:');
      console.log(JSON.stringify(workflowRecord, null, 2));
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
