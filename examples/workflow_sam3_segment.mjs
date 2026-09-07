#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

export function parseOptions(args) {
  const options = { points: [], boxes: [], source: '', text: '', output: resolve('output', `sam3-${Date.now()}`), run: false };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help') return { help: true };
    if (flag === '--run') { options.run = true; continue; }
    if (!['--source', '--point', '--exclude', '--box', '--text', '--output'].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--source') options.source = resolve(value);
    if (flag === '--output') options.output = resolve(value);
    if (flag === '--text') options.text = value.trim();
    if (flag === '--box') {
      const parts = value.split(','); const [x0, y0, x1, y1] = parts.map(Number);
      if (parts.length !== 4 || parts.some(part => !part.trim()) || [x0, y0, x1, y1].some(n => !Number.isFinite(n) || n < 0 || n > 1) || x0 >= x1 || y0 >= y1) throw new Error('Boxes must be normalized x0,y0,x1,y1 coordinates with x0 < x1 and y0 < y1');
      options.boxes.push({ x0, y0, x1, y1 });
    }
    if (flag === '--point' || flag === '--exclude') {
      const parts = value.split(','); const [x, y] = parts.map(Number);
      if (parts.length !== 2 || parts.some(part => !part.trim()) || [x, y].some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Points must be normalized x,y coordinates between 0 and 1');
      options.points.push({ x, y, label: flag === '--point' ? 'positive' : 'negative' });
    }
  }
  if (!options.source || (!options.text && !options.boxes.length && !options.points.some(point => point.label === 'positive')) || options.points.length > 32 || options.boxes.length > 16 || options.text.length > 240) {
    throw new Error('Supply --source and a positive point, box or text description (at most 32 points, 16 boxes, 240 text characters)');
  }
  if (options.text && options.points.length) throw new Error('Use text with optional boxes, or points with at most one box; text and points cannot be combined');
  if (options.points.length && options.boxes.length > 1) throw new Error('Point prompts support at most one box');
  return options;
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('SAM 3 object selection: one original-size binary PNG mask.\nModel: sam3_image_segment_bf16\n\nnode workflow_sam3_segment.mjs --source original.png --point 0.5,0.5 [--exclude 0.1,0.1] [--box 0.2,0.2,0.8,0.8] [--output directory] [--run]\n\nWithout --run, prints a live Spark estimate only. --run submits one paid project.\nFor whole-object selection, use --text "red backpack" with an optional --box x0,y0,x1,y1 instead of points. Text and points cannot be combined. Coordinates refer to the original image, from 0 to 1. A point can select only a subpart; inspect the native mask before using it. Credentials auto-load from examples/.env.');
    return;
  }
  if ((await stat(options.source)).size > 24 * 1024 * 1024) throw new Error('Choose an original still under 24 MB');
  const source = await readFile(options.source);
  const { default: sharp } = await import('sharp');
  const metadata = await sharp(source, { limitInputPixels: 4096 * 4096 }).metadata();
  if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1 || !['png', 'jpeg', 'webp'].includes(metadata.format) || (metadata.orientation ?? 1) !== 1) throw new Error('Choose an upright PNG, JPEG or WebP original still');
  if ([metadata.width, metadata.height].some(value => value < 256 || value > 2560)) throw new Error('Choose an original with each edge between 256 and 2560 pixels');
  const { SogniClient } = await import('../dist/index.js');
  const { loadCredentials } = await import('./credentials.mjs');
  const credentials = await loadCredentials();
  const client = await SogniClient.createInstance({ appId: `sam3-example-${randomUUID()}`, appSource: 'sogni-sdk-examples', network: 'fast', logLevel: 'error', ...(credentials.apiKey ? { apiKey: credentials.apiKey, authType: 'apiKey' } : {}) });
  let projectId;
  try {
    if (!credentials.apiKey) await client.account.login(credentials.username, credentials.password);
    const modelId = 'sam3_image_segment_bf16';
    const quote = await client.projects.estimateCost({ model: modelId, network: 'fast', tokenType: 'spark', stepCount: 1, imageCount: 1, previewCount: 0, width: metadata.width, height: metadata.height });
    if (!Number.isFinite(Number(quote.spark)) || Number(quote.spark) <= 0) throw new Error('A reliable estimate is not available');
    console.log(`Estimated cost: ${quote.spark} Spark Points`);
    if (!options.run) return;
    await mkdir(options.output, { recursive: true });
    const prompt = 'Select the indicated object.';
    const sam3Prompt = { ...(options.points.length ? { points: options.points } : {}), ...(options.boxes.length ? { boxes: options.boxes } : {}), ...(options.text ? { text: options.text } : {}), threshold: 0.5, multimask: options.points.length > 0 };
    const startedAt = Date.now();
    await writeFile(resolve(options.output, 'project.json'), JSON.stringify({ status: 'prepared', sourceSha256: hash(source), modelId, sam3Prompt, startedAt }, null, 2), { flag: 'wx', mode: 0o600 });
    const project = await client.projects.create({ type: 'image', modelId, positivePrompt: prompt, startingImage: source, sam3Prompt,
      sizePreset: 'custom', width: metadata.width, height: metadata.height, steps: 1, guidance: 1, numberOfMedia: 1, numberOfPreviews: 0,
      outputFormat: 'png', tokenType: 'spark', billingMode: 'tokens', disableNSFWFilter: false, network: 'fast' });
    projectId = project.id;
    await writeFile(resolve(options.output, 'project.json'), JSON.stringify({ projectId, sourceSha256: hash(source), modelId, sam3Prompt, startedAt }, null, 2));
    let result;
    while (Date.now() - startedAt < 10 * 60_000) {
      try { result = await client.projects.get(projectId); }
      catch (error) { if (error.status && ![404, 429].includes(error.status) && error.status < 500) throw error; }
      if (result?.status === 'completed') break;
      if (['errored', 'cancelled'].includes(result?.status) || ['failed', 'canceled'].includes(project.status)) throw new Error('The project did not complete');
      await sleep(3000);
    }
    if (result?.status !== 'completed') throw new Error('Timed out waiting; inspect the saved project ID before submitting a replacement');
    if (result.completedWorkerJobs.length !== 1) throw new Error('Expected one mask');
    const job = result.completedWorkerJobs[0];
    if (job.triggeredNSFWFilter || job.nsfwDetected || !job.imgID || !job.result?.sha256 || job.result.sourceImageSha256 !== hash(source)) throw new Error('The output is missing a valid source receipt');
    const url = await client.projects.downloadUrl({ jobId: projectId, imageId: job.imgID, type: 'complete' });
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Could not download the mask');
    const mask = Buffer.from(await response.arrayBuffer());
    if (mask.length > 24 * 1024 * 1024 || hash(mask) !== job.result.sha256) throw new Error('The mask does not match its receipt');
    const decoded = await sharp(mask).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== metadata.width || decoded.info.height !== metadata.height) throw new Error('The mask dimensions changed');
    const runs = []; let bit = 0, length = 0;
    for (let i = 0; i < decoded.data.length; i += 4) {
      const value = decoded.data[i];
      if (![0, 255].includes(value) || decoded.data[i + 1] !== value || decoded.data[i + 2] !== value || decoded.data[i + 3] !== 255) throw new Error('Expected an opaque binary mask');
      const next = value === 255 ? 1 : 0;
      if (next !== bit) { runs.push(length); length = 0; bit = next; } length++;
    }
    runs.push(length);
    if (hash(runs.join(',')) !== job.result.maskRleSha256) throw new Error('Mask pixels do not match their receipt');
    const elapsed = (Date.now() - startedAt) / 1000;
    const renderSeconds = job.startTime && job.endTime ? (job.endTime - job.startTime) / 1000 : null;
    const sourceName = `original.${metadata.format}`;
    await writeFile(resolve(options.output, sourceName), source);
    await writeFile(resolve(options.output, 'mask.png'), mask);
    await writeFile(resolve(options.output, 'receipt.json'), JSON.stringify({ modelId, sourceSha256: hash(source), maskSha256: hash(mask), sam3Prompt, steps: 1, seed: job.seedUsed, elapsedSeconds: elapsed, workerElapsedSeconds: renderSeconds, temperature: 'UNKNOWN', peakVram: null, verdict: 'Receipts verified; visual review required' }, null, 2));
    await writeFile(resolve(options.output, 'review.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>SAM 3 selection review</title><style>body{font:18px system-ui;background:#10151b;color:#eef4ee;max-width:1100px;margin:auto;padding:2rem}a{color:#b3ffcb}td,th{padding:.5rem;text-align:left;border-bottom:1px solid #456}img{max-width:100%;height:auto}pre{white-space:pre-wrap}</style><h1>SAM 3 object selection</h1><p><strong>Measured total time: ${elapsed.toFixed(2)} seconds. Worker elapsed time: ${renderSeconds === null ? 'unknown' : renderSeconds.toFixed(2) + ' seconds'}.</strong> Worker elapsed time may include setup; it is not a hot-compute benchmark.</p><table><tr><th>Mode / tier</th><td>Image object selection / SAM 3 BF16</td></tr><tr><th>Model</th><td>${modelId}</td></tr><tr><th>Dimensions</th><td>${metadata.width} × ${metadata.height}</td></tr><tr><th>Steps / seed</th><td>1 / ${escape(job.seedUsed)}</td></tr><tr><th>HOT-COLD-UNKNOWN / peak VRAM</th><td>UNKNOWN / UNKNOWN</td></tr><tr><th>Verdict</th><td>Receipt and binary mask checks passed; visual approval pending</td></tr><tr><th>Exact baseline</th><td>Unmodified supplied original; SHA-256 ${hash(source)}</td></tr></table><h2>Verbatim prompt</h2><pre>${escape(prompt)}\n${escape(JSON.stringify(sam3Prompt, null, 2))}</pre><h2>Original</h2><a href="${sourceName}" target="_blank"><img src="${sourceName}" alt="Unmodified original"></a><h2>Selection</h2><a href="mask.png" target="_blank"><img src="mask.png" alt="Native binary selection mask"></a><p>Open each image at native size to inspect faces, fine texture, edges, lettering, and gradients. White selects the object. This single sample does not establish reliability. Human motion, dialogue, image editing, animation, cold/warm timing and peak VRAM are untested. Mark approval is pending.</p></html>`);
    console.log(pathToFileURL(resolve(options.output, 'review.html')).href);
  } catch (error) {
    if (projectId) console.error(`Existing project: ${projectId}. No replacement was submitted.`);
    throw error;
  } finally { client.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
