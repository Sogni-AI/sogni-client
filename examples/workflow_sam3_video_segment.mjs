#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { SogniClient, SAM3_VIDEO_SEGMENT_MODEL_ID } from '../dist-esm/index.js';
import { exampleAppId } from './app-id.mjs';
import { loadCredentials } from './credentials.mjs';

const [source, text, frame = '0', output = 'selection-mask.mp4'] = process.argv.slice(2);
if (!source || !text || !Number.isSafeInteger(Number(frame)) || Number(frame) < 0) {
  console.error('Usage: node examples/workflow_sam3_video_segment.mjs source.mp4 "unicorn horn" [frame-index] [mask.mp4]');
  process.exit(1);
}
const credentials = await loadCredentials();
const client = await SogniClient.createInstance({ appId: exampleAppId('sam3-video-segment'), appSource: 'sogni-sdk-examples', network: 'fast', logLevel: 'error',
  ...(credentials.apiKey ? { apiKey: credentials.apiKey, authType: 'apiKey' } : {}) });
try {
  if (!credentials.apiKey) await client.account.login(credentials.username, credentials.password);
  // One paid request. The server probes the original upload before charging.
  const project = await client.projects.create({ type: 'video', modelId: SAM3_VIDEO_SEGMENT_MODEL_ID, positivePrompt: '', numberOfMedia: 1,
    referenceVideo: await readFile(source), sam3VideoPrompt: { text, frameIndex: Number(frame) }, tokenType: 'spark', disableNSFWFilter: true });
  const [url] = await project.waitForCompletion();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mask download failed (${response.status})`);
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  console.log(`Saved frame-aligned mask: ${output}`);
} finally {
  client.disconnect();
}
