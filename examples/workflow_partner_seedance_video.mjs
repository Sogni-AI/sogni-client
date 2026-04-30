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
 *   node workflow_partner_seedance_video.mjs "slow cinematic reveal" --mode i2v
 *   node workflow_partner_seedance_video.mjs "slow cinematic reveal" --mode i2v --fast
 *   node workflow_partner_seedance_video.mjs "the portrait sings with stage lighting" --mode ia2v
 *   node workflow_partner_seedance_video.mjs "turn the clip into a polished perfume commercial" --mode v2v
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import { askQuestion, calculateVideoFrames } from './workflow-helpers.mjs';

const DEFAULT_LLM_MODEL = 'qwen3.6-35b-a3b-gguf-iq4xs';
const DEFAULT_REST_ENDPOINT = 'https://api.sogni.ai';
const DEFAULT_PROMPT =
  'A fuzzy pink sloth with a little unicorn horn growing out of his forehead, the Slothicorn mascot, bursts onto a spectacular neon launch stage, taps a glowing button, and unleashes streams of cinematic light around a crisp sign that reads "SEEDANCE 2.0 on SOGNI". He smiles to camera and says clearly, "Seedance 2.0 is live on Sogni. Let your imagination move." Energetic teaser trailer pacing, playful interaction, premium lighting, huge reveal moment, polished platform launch commercial.';

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

const EXAMPLES_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE = path.join(EXAMPLES_DIR, 'test-assets', 'placeholder.jpg');
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

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: '',
    mode: 't2v',
    fast: false,
    model: undefined,
    llmModel: DEFAULT_LLM_MODEL,
    endpoint: process.env.SOGNI_REST_ENDPOINT || DEFAULT_REST_ENDPOINT,
    duration: 4,
    width: undefined,
    height: undefined,
    number: 1,
    seed: undefined,
    image: undefined,
    endImage: undefined,
    audio: undefined,
    video: undefined,
    generateAudio: undefined,
    target: undefined,
    execute: true,
    tokenType: loadTokenTypePreference() || process.env.SOGNI_TOKEN_TYPE || 'spark',
    inspectWorkflow: false,
    json: false
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--mode' && args[i + 1]) {
      options.mode = args[++i].toLowerCase();
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
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if ((arg === '--number' || arg === '--variations') && args[i + 1]) {
      options.number = parseInt(args[++i], 10);
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg === '--image' && args[i + 1]) {
      options.image = args[++i];
    } else if (arg === '--end-image' && args[i + 1]) {
      options.endImage = args[++i];
    } else if (arg === '--audio' && args[i + 1]) {
      options.audio = args[++i];
    } else if (arg === '--video' && args[i + 1]) {
      options.video = args[++i];
    } else if (arg === '--no-audio') {
      options.generateAudio = false;
    } else if (arg === '--target' && args[i + 1]) {
      options.target = args[++i].toLowerCase();
    } else if (arg === '--chat') {
      options.target = 'chat';
    } else if (arg === '--workflow') {
      options.target = 'workflow';
    } else if (arg === '--no-execute') {
      options.execute = false;
    } else if (arg === '--token-type' && args[i + 1]) {
      options.tokenType = args[++i];
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
  options.target = options.target || (options.mode === 't2v' ? 'chat' : 'workflow');
  validateOptions(options);
  return options;
}

function showHelp() {
  console.log(`
Partner Seedance Video Example

Usage:
  node workflow_partner_seedance_video.mjs "prompt" [options]

Modes:
  t2v   Text-to-video through chat/completions or hosted workflow
  i2v   Image-to-video through hosted workflow
  ia2v  Image+audio-to-video through hosted workflow
  v2v   Video-to-video through hosted workflow

Options:
  --chat                 Use /v1/chat/completions (t2v only)
  --workflow             Use /v1/creative-agent/workflows hosted_tool_sequence
  --fast                 Use Seedance 2.0 Fast for t2v/i2v (720p cap)
  --model <selector>     Override model selector or model id
  --duration <seconds>   4-15 seconds for Seedance (default: 4)
  --width <px>           Output width (default: 1280 for fast, 1920 otherwise)
  --height <px>          Output height (default: 720 for fast, 1088 otherwise)
  --image <path|https>   Reference image for i2v or ia2v
  --end-image <path|https> Optional final frame image for i2v interpolation
  --audio <path|https>   Reference audio for ia2v
  --video <path|https>   Source video for v2v
  --no-audio             Request silent Seedance output by setting generate_audio=false
  --number <n>           Number of variations (default: 1)
  --seed <n>             Seed
  --no-execute           Print the request that would be sent, without submitting the workflow
  --inspect-workflow     Fetch the creative workflow record returned by chat/completions
  --llm-model <id>       Chat model (default: ${DEFAULT_LLM_MODEL})
  --endpoint <url>       REST endpoint (default: SOGNI_REST_ENDPOINT or ${DEFAULT_REST_ENDPOINT})
  --token-type <type>    spark, sogni, or auto
  --json                 Print raw response

Execution requires SOGNI_API_KEY in examples/.env or the environment. Local media inputs are uploaded with the existing Sogni media upload endpoints before workflow execution. Workflow dry-runs also upload local media so the printed request contains real HTTPS media URLs.
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
  if (options.duration < 4 || options.duration > 15) {
    throw new Error('Seedance duration must be between 4 and 15 seconds.');
  }
  if (options.fast && (options.mode === 'ia2v' || options.mode === 'v2v')) {
    throw new Error('--fast is only available for Seedance t2v and i2v.');
  }
}

function defaultModel(options) {
  if (options.model) return options.model;
  if (options.mode === 'v2v') return 'seedance2';
  if (options.mode === 'ia2v') return 'seedance2';
  return options.fast ? 'seedance2-fast' : 'seedance2';
}

function defaultDimensions(options) {
  const fast = defaultModel(options).includes('fast');
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
  const modelConfig =
    SEEDANCE_MODELS[mode]?.[modelSelector] ||
    Object.values(SEEDANCE_MODELS[mode] || {}).find((model) => model.id === modelSelector);
  if (modelConfig?.id) return modelConfig.id;

  throw new Error(`Cannot estimate unknown Seedance model selector: ${modelSelector}`);
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
  const job = estimate?.quote?.job || {};
  const request = estimate?.request || {};

  console.log('Cost estimate:');
  console.log(`Model:     ${request.model || '(unknown)'}`);
  console.log(`Frames:    ${request.frames || '(unknown)'} @ ${request.fps || 24}fps`);
  console.log(`Spark:     ${formatDecimal(project.costInSpark, 4)}`);
  console.log(`SOGNI:     ${formatDecimal(project.costInSogni, 4)}`);
  console.log(`USD:       $${formatDecimal(project.costInUSD, 6)}`);
  if (job.vendorCostUSD !== undefined) {
    console.log(`Vendor:    $${formatDecimal(job.vendorCostUSD, 6)}`);
  }
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

async function buildToolArguments(credentials, options) {
  const { width, height } = defaultDimensions(options);
  const args = {
    prompt: options.prompt || DEFAULT_PROMPT,
    model: defaultModel(options),
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

  if (options.mode === 'i2v') {
    args.reference_image_url = await mediaInputUrl(
      credentials,
      options,
      options.image,
      'image',
      'referenceImage',
      DEFAULT_IMAGE
    );
    if (options.endImage) {
      args.reference_image_end_url = await mediaInputUrl(
        credentials,
        options,
        options.endImage,
        'image',
        'referenceImageEnd'
      );
      args.first_frame_strength = 1;
      args.last_frame_strength = 1;
    }
  } else if (options.mode === 'ia2v') {
    args.reference_image_url = await mediaInputUrl(
      credentials,
      options,
      options.image,
      'image',
      'referenceImage',
      DEFAULT_IMAGE
    );
    args.reference_audio_url = await mediaInputUrl(
      credentials,
      options,
      options.audio,
      'audio',
      'referenceAudio',
      DEFAULT_AUDIO
    );
  } else if (options.mode === 'v2v') {
    args.reference_video_url = await mediaInputUrl(
      credentials,
      options,
      options.video,
      'video',
      'referenceVideo',
      DEFAULT_VIDEO
    );
    args.control_mode = 'seedance-v2v';
  }

  return args;
}

function buildChatInstruction(options, toolName, toolArguments) {
  return [
    `Create exactly one Seedance 2.0 text-to-video job by calling ${toolName}.`,
    'Use the provided tool arguments exactly. Do not ask follow-up questions.',
    'Keep the prompt value as the compact creative brief; sogni-api will expand it with the Seedance prompt shaper before dispatch.',
    'Tool arguments:',
    JSON.stringify(toolArguments, null, 2)
  ].join('\n');
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

async function main() {
  const options = parseArgs();
  if (!options.prompt && process.stdin.isTTY) {
    const answer = await askQuestion(`Prompt [${DEFAULT_PROMPT}]: `);
    options.prompt = answer || DEFAULT_PROMPT;
  }
  if (!options.prompt) {
    options.prompt = DEFAULT_PROMPT;
  }

  const credentials =
    options.target === 'workflow' && !options.execute
      ? { apiKey: process.env.SOGNI_API_KEY || '' }
      : await loadCredentials();
  if ((options.target !== 'workflow' || options.execute) && !credentials.apiKey) {
    throw new Error('Partner Seedance video examples require SOGNI_API_KEY API-key auth.');
  }

  const toolName = toolNameForMode(options.mode);
  const toolArguments = await buildToolArguments(credentials, options);
  const estimateModelId = estimateModelIdForMode(options.mode, toolArguments.model);
  const estimateFps = 24;
  const estimateFrames = calculateVideoFrames(
    estimateModelId,
    toolArguments.duration,
    estimateFps
  );
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
