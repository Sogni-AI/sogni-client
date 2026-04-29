#!/usr/bin/env node

/**
 * Durable Creative-Agent Workflow Example
 *
 * Starts, inspects, streams, and cancels async /v1/creative-agent/workflows
 * image-to-video workflows through the Sogni SDK.
 *
 * Examples:
 *   node workflow_creative_agent_workflows.mjs "A chrome monorail gliding over neon gardens" --watch
 *   node workflow_creative_agent_workflows.mjs "A cinematic robot portrait" --video-model seedance2 --duration 5 --watch
 *   node workflow_creative_agent_workflows.mjs "A kinetic product teaser" --video-model seedance2-fast --duration 5 --watch
 *   node workflow_creative_agent_workflows.mjs --list
 *   node workflow_creative_agent_workflows.mjs --get workflow_123
 *   node workflow_creative_agent_workflows.mjs --stream workflow_123
 *   node workflow_creative_agent_workflows.mjs --cancel workflow_123
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import { askQuestion } from './workflow-helpers.mjs';

const DEFAULT_IMAGE_MODEL = 'flux2';
const DEFAULT_VIDEO_MODEL = 'ltx23';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: '',
    videoPrompt: undefined,
    negativePrompt: undefined,
    width: undefined,
    height: undefined,
    duration: 5,
    imageModel: DEFAULT_IMAGE_MODEL,
    videoModel: DEFAULT_VIDEO_MODEL,
    numberOfMedia: 1,
    seed: undefined,
    tokenType: loadTokenTypePreference() || 'spark',
    list: false,
    get: undefined,
    events: undefined,
    stream: undefined,
    cancel: undefined,
    watch: false
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--get' && args[i + 1]) {
      options.get = args[++i];
    } else if (arg === '--events' && args[i + 1]) {
      options.events = args[++i];
    } else if (arg === '--stream' && args[i + 1]) {
      options.stream = args[++i];
    } else if (arg === '--cancel' && args[i + 1]) {
      options.cancel = args[++i];
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--video-prompt' && args[i + 1]) {
      options.videoPrompt = args[++i];
    } else if (arg === '--negative-prompt' && args[i + 1]) {
      options.negativePrompt = args[++i];
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseInt(args[++i], 10);
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseInt(args[++i], 10);
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseFloat(args[++i]);
    } else if (arg === '--image-model' && args[i + 1]) {
      options.imageModel = args[++i];
    } else if (arg === '--video-model' && args[i + 1]) {
      options.videoModel = args[++i];
    } else if (arg === '--number' && args[i + 1]) {
      options.numberOfMedia = parseInt(args[++i], 10);
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[++i], 10);
    } else if (arg === '--token-type' && args[i + 1]) {
      options.tokenType = args[++i];
    } else {
      positional.push(arg);
    }
  }

  options.prompt = positional.join(' ').trim();
  return options;
}

function showHelp() {
  console.log(`
Durable Creative-Agent Workflow Example

Usage:
  node workflow_creative_agent_workflows.mjs "prompt" [options]
  node workflow_creative_agent_workflows.mjs --list
  node workflow_creative_agent_workflows.mjs --get <workflowId>
  node workflow_creative_agent_workflows.mjs --events <workflowId>
  node workflow_creative_agent_workflows.mjs --stream <workflowId>
  node workflow_creative_agent_workflows.mjs --cancel <workflowId>

Options:
  --watch                 Stream events after starting a workflow
  --video-prompt <text>   Separate motion/video prompt
  --negative-prompt <txt> Negative prompt
  --duration <seconds>    Video duration (default: 5)
  --width <px>            Output width
  --height <px>           Output height
  --image-model <model>   Creative-agent image model selector (default: ${DEFAULT_IMAGE_MODEL})
  --video-model <model>   Creative-agent video model selector (default: ${DEFAULT_VIDEO_MODEL})
                          Try: ltx23, wan22, seedance2, seedance2-fast
                          seedance2-fast is text/image-to-video only and caps at 720p
  --number <n>            Number of outputs (default: 1)
  --seed <n>              Seed
  --token-type <type>     spark or sogni (default from .env or spark)

Requires SOGNI_API_KEY in examples/.env or the environment.
`);
}

async function createClient(credentials) {
  if (!credentials.apiKey) {
    throw new Error('Durable creative-agent workflows require SOGNI_API_KEY API-key auth.');
  }

  const clientConfig = {
    appId: `sogni-creative-workflows-${Date.now()}`,
    network: 'fast',
    apiKey: credentials.apiKey,
    disableSocket: true
  };
  if (process.env.SOGNI_REST_ENDPOINT) {
    clientConfig.restEndpoint = process.env.SOGNI_REST_ENDPOINT;
  }
  if (process.env.SOGNI_TESTNET === 'true') {
    clientConfig.testnet = true;
  }
  return SogniClient.createInstance(clientConfig);
}

function printWorkflow(workflow) {
  console.log(`Workflow: ${workflow.workflowId}`);
  if (workflow.status) console.log(`Status:   ${workflow.status}`);
  if (workflow.kind) console.log(`Kind:     ${workflow.kind}`);
  if (workflow.title) console.log(`Title:    ${workflow.title}`);

  const artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  if (artifacts.length > 0) {
    console.log('\nArtifacts:');
    for (const artifact of artifacts) {
      const label = artifact.type || artifact.mediaType || artifact.mimeType || 'artifact';
      console.log(`  - ${label}: ${artifact.url || artifact.id || JSON.stringify(artifact)}`);
    }
  }
}

function printEvent(frame) {
  const data = frame.data && typeof frame.data === 'object' ? frame.data : {};
  const status = data.status ? ` ${data.status}` : '';
  const message = data.message || data.type || data.step || '';
  const suffix = message ? ` - ${message}` : '';
  console.log(`[${frame.id || '-'}] ${frame.event}${status}${suffix}`);
}

async function streamWorkflow(sogni, workflowId) {
  console.log(`\nStreaming events for ${workflowId}...\n`);
  for await (const frame of sogni.creativeWorkflows.streamEvents(workflowId)) {
    printEvent(frame);
  }
}

async function main() {
  const options = parseArgs();
  const credentials = await loadCredentials();
  const sogni = await createClient(credentials);

  try {
    if (options.list) {
      const workflows = await sogni.creativeWorkflows.list({ limit: 20 });
      workflows.forEach((workflow) => {
        console.log(`${workflow.workflowId}\t${workflow.status || '-'}\t${workflow.title || ''}`);
      });
      return;
    }

    if (options.get) {
      printWorkflow(await sogni.creativeWorkflows.get(options.get));
      return;
    }

    if (options.events) {
      const events = await sogni.creativeWorkflows.events(options.events);
      console.log(JSON.stringify(events, null, 2));
      return;
    }

    if (options.stream) {
      await streamWorkflow(sogni, options.stream);
      return;
    }

    if (options.cancel) {
      printWorkflow(await sogni.creativeWorkflows.cancel(options.cancel));
      return;
    }

    if (!options.prompt) {
      options.prompt = await askQuestion('Describe the image-to-video workflow: ');
    }
    if (!options.prompt) {
      throw new Error('Prompt is required.');
    }

    console.log('Starting durable image-to-video workflow...\n');
    const workflow = await sogni.creativeWorkflows.startImageToVideo(
      {
        prompt: options.prompt,
        videoPrompt: options.videoPrompt,
        negativePrompt: options.negativePrompt,
        width: options.width,
        height: options.height,
        duration: options.duration,
        imageModel: options.imageModel,
        videoModel: options.videoModel,
        numberOfMedia: options.numberOfMedia,
        seed: options.seed
      },
      { tokenType: options.tokenType }
    );

    printWorkflow(workflow);
    if (options.watch && workflow.workflowId) {
      await streamWorkflow(sogni, workflow.workflowId);
    }
  } finally {
    sogni.dispose();
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
