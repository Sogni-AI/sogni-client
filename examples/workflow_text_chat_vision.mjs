#!/usr/bin/env node
/**
 * Vision Chat Workflow — Multimodal Image Understanding
 *
 * Interactive multi-turn conversation with vision capabilities powered by
 * Qwen3.6 VLM (Vision-Language Model) on the Sogni Supernet.
 *
 * Supports: scene description, OCR/text extraction, object detection,
 * document/chart analysis, visual reasoning, and multi-image comparison.
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - A VLM worker must be online on the Sogni network
 *
 * Usage:
 *   node workflow_text_chat_vision.mjs
 *   node workflow_text_chat_vision.mjs --image photo.jpg
 *
 * Options:
 *   --image         Pre-load an image file at startup
 *   --max-tokens    Maximum tokens per response (default: from model, or 8192)
 *   --temperature   Sampling temperature 0-2 (default: from model, or 0.7)
 *   --top-p         Top-p sampling 0-1 (default: from model, or 0.9)
 *   --top-k         Top-k sampling (default: from model, if available)
 *   --system        Custom system prompt
 *   --help          Show this help message
 *
 * Commands (during conversation):
 *   /image <path>     Load a local image (JPEG, PNG, WebP, GIF; max 20MB)
 *   /describe         Rich detailed description of current image
 *   /ocr              Extract all visible text with layout preservation
 *   /objects          Detect objects with location, size, and spatial relationships
 *   /analyze          Deep structured analysis (subject, composition, lighting, etc.)
 *   /compare <path>   Load second image and compare both in detail
 *   /clear-image      Remove image from context (text-only mode)
 *   /clear            Clear conversation history
 *   /history          Show current message history
 *   /system <msg>     Change the system prompt
 *   /stats            Show session statistics
 *   exit / quit       End the conversation
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const VLM_MODEL = 'qwen3.6-35b-a3b-gguf-iq4xs';
const DEFAULT_SYSTEM =
  'You are a visual analysis assistant with expert-level image understanding. ' +
  'When given an image, analyze it thoroughly and provide specific, detailed observations. ' +
  'Be precise about colors, positions, text, objects, and spatial relationships. ' +
  'If no image is provided, respond helpfully to text queries.';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// ─── Vision command prompts ────────────────────────────────────────────────

const VISION_PROMPTS = {
  describe:
    'Provide a rich, detailed description of this image. Include the main subject, background, ' +
    'colors, lighting, mood, notable details, and any text visible. Describe spatial relationships ' +
    'between elements and the overall composition.',

  ocr:
    'Extract ALL text visible in this image. Preserve the original layout and formatting as closely ' +
    'as possible. For each text region, note its approximate location (top, center, bottom, etc.). ' +
    'If text appears in multiple languages, identify each language. Include any partially visible or ' +
    'stylized text.',

  objects:
    'List all objects you can identify in this image. For each object, describe: ' +
    '(1) what it is, (2) its approximate location in the image (top-left, center, bottom-right, etc.), ' +
    '(3) its relative size (small, medium, large), (4) key visual attributes (color, shape, condition), ' +
    'and (5) spatial relationships with other objects (next to, above, behind, etc.).',

  analyze:
    'Provide a deep structured analysis of this image covering:\n' +
    '• SUBJECT: Main subject(s) and focal point\n' +
    '• COMPOSITION: Layout, framing, rule of thirds, leading lines, symmetry\n' +
    '• LIGHTING: Direction, quality (hard/soft), color temperature, shadows\n' +
    '• COLOR: Dominant palette, contrast, saturation, color harmony\n' +
    '• TECHNICAL: Apparent camera angle, depth of field, focus, resolution quality\n' +
    '• MOOD: Emotional tone, atmosphere, feeling conveyed\n' +
    '• STYLE: Photographic/artistic style, genre, influences\n' +
    '• CONTEXT: Setting, time period clues, cultural elements, story implied',

  compare:
    'Compare these two images in detail. For each of the following aspects, describe the similarities ' +
    'and differences between Image 1 and Image 2:\n' +
    '• Subject matter and content\n' +
    '• Color palette and lighting\n' +
    '• Composition and framing\n' +
    '• Mood and atmosphere\n' +
    '• Quality and technical aspects\n' +
    '• Any other notable similarities or differences',
};

// ─── Argument parsing ──────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    image: null,
    maxTokens: null,
    temperature: null,
    topP: null,
    topK: null,
    system: DEFAULT_SYSTEM,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--image' && args[i + 1]) {
      options.image = args[++i];
    } else if (arg === '--max-tokens' && args[i + 1]) {
      options.maxTokens = parseInt(args[++i], 10);
    } else if (arg === '--temperature' && args[i + 1]) {
      options.temperature = parseFloat(args[++i]);
    } else if (arg === '--top-p' && args[i + 1]) {
      options.topP = parseFloat(args[++i]);
    } else if (arg === '--top-k' && args[i + 1]) {
      options.topK = parseInt(args[++i], 10);
    } else if (arg === '--system' && args[i + 1]) {
      options.system = args[++i];
    } else {
      console.error(`Unknown option: ${arg}`);
      showHelp();
      process.exit(1);
    }
  }

  return options;
}

function showHelp() {
  console.log(`
Vision Chat — Multimodal Image Understanding

Usage:
  node workflow_text_chat_vision.mjs
  node workflow_text_chat_vision.mjs --image photo.jpg

Options:
  --image         Pre-load an image file at startup
  --max-tokens    Maximum tokens per response (default: from model, or 8192)
  --temperature   Sampling temperature 0-2 (default: from model, or 0.7)
  --top-p         Top-p sampling 0-1 (default: from model, or 0.9)
  --top-k         Top-k sampling (default: from model, if available)
  --system        Custom system prompt
  --help          Show this help message

In-conversation commands:
  /image <path>     Load a local image (JPEG, PNG, WebP, GIF; max 20MB)
  /describe         Rich detailed description of current image
  /ocr              Extract all visible text
  /objects          Detect and locate objects
  /analyze          Deep structured analysis
  /compare <path>   Compare current image with another
  /clear-image      Remove image from context
  /clear            Clear conversation history
  /history          Show message history
  /system <msg>     Change system prompt
  /stats            Show session statistics
  exit / quit       End conversation
`);
}

// ─── Image loading ─────────────────────────────────────────────────────────

function loadImage(filePath) {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (stat.size > MAX_IMAGE_SIZE) {
    throw new Error(
      `File too large: ${(stat.size / 1024 / 1024).toFixed(1)}MB (max ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`
    );
  }

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext];
  if (!mime) {
    throw new Error(`Unsupported image format: ${ext} (supported: ${Object.keys(MIME_TYPES).join(', ')})`);
  }

  const buffer = fs.readFileSync(resolved);
  const base64 = buffer.toString('base64');
  const dataUri = `data:${mime};base64,${base64}`;

  return {
    dataUri,
    fileName: path.basename(resolved),
    fileSize: stat.size,
    format: ext.replace('.', '').toUpperCase(),
  };
}

// ─── Message building ──────────────────────────────────────────────────────

function buildUserMessage(text, imageUri, compareUri) {
  if (!imageUri) {
    return { role: 'user', content: text };
  }

  const content = [];

  content.push({ type: 'image_url', image_url: { url: imageUri } });

  if (compareUri) {
    content.push({ type: 'image_url', image_url: { url: compareUri } });
  }

  content.push({ type: 'text', text });

  return { role: 'user', content };
}

// ─── Thinking filter (reused from multi-turn example) ──────────────────────

function createThinkingFilter(showThinking) {
  let insideThink = false;
  let buffer = '';
  let visibleOutput = '';

  return {
    write(text) {
      if (showThinking) {
        process.stdout.write(text);
        visibleOutput += text;
        return;
      }

      buffer += text;

      while (buffer.length > 0) {
        if (insideThink) {
          const endIdx = buffer.indexOf('</think>');
          if (endIdx === -1) {
            buffer = '';
            break;
          }
          buffer = buffer.slice(endIdx + 8);
          insideThink = false;
        } else {
          const startIdx = buffer.indexOf('<think>');
          if (startIdx === -1) {
            const safeLen = Math.max(0, buffer.length - 6);
            if (safeLen > 0) {
              process.stdout.write(buffer.slice(0, safeLen));
              visibleOutput += buffer.slice(0, safeLen);
              buffer = buffer.slice(safeLen);
            }
            break;
          }
          if (startIdx > 0) {
            process.stdout.write(buffer.slice(0, startIdx));
            visibleOutput += buffer.slice(0, startIdx);
          }
          buffer = buffer.slice(startIdx + 7);
          insideThink = true;
        }
      }
    },

    flush() {
      if (!showThinking && buffer.length > 0) {
        process.stdout.write(buffer);
        visibleOutput += buffer;
        buffer = '';
      }
    },

    getVisibleOutput() {
      return visibleOutput;
    },
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('  Sogni Vision Chat');
  console.log('='.repeat(60));
  showHelp();

  // Load credentials
  const credentials = await loadCredentials();

  // Connect to Sogni
  console.log('Connecting to Sogni...');
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const sogni = await SogniClient.createInstance({
    appId: `sogni-vision-${Date.now()}`,
    network: 'fast',
    ...(credentials.apiKey && { apiKey: credentials.apiKey }),
    ...(testnet && { testnet }),
    ...(socketEndpoint && { socketEndpoint }),
    ...(restEndpoint && { restEndpoint }),
  });

  if (!credentials.apiKey) {
    await sogni.account.login(credentials.username, credentials.password);
    console.log(`Logged in as: ${credentials.username}`);
  } else {
    console.log('Authenticated with API key');
  }

  // Wait for VLM model to be available
  let availableModels = {};
  try {
    availableModels = await sogni.chat.waitForModels();
    if (availableModels[VLM_MODEL]) {
      const workers = availableModels[VLM_MODEL].workers;
      console.log(`VLM model online: ${VLM_MODEL} (${workers} worker${workers !== 1 ? 's' : ''})`);
    } else {
      console.log(`Warning: Vision model ${VLM_MODEL} is not currently available on the network.`);
      console.log('Available models:', Object.keys(availableModels).join(', '));
      console.log('The request will be queued until a VLM worker comes online.');
    }
  } catch {
    console.log('Warning: Could not retrieve available models from the network.');
    console.log('The request will be queued until a VLM worker comes online.');
  }

  // Resolve max tokens: CLI override > model-reported default > fallback
  const modelInfo = availableModels[VLM_MODEL];
  options.maxTokens = options.maxTokens || modelInfo?.maxOutputTokens?.default || 8192;

  // Resolve sampling parameters: CLI override > server defaults > hardcoded fallback
  const samplingDefaults = modelInfo?.defaultsNonThinking;
  options.temperature = options.temperature ?? samplingDefaults?.temperature ?? 0.7;
  options.topP = options.topP ?? samplingDefaults?.top_p ?? 0.9;
  options.topK = options.topK ?? samplingDefaults?.top_k;

  // Load token type preference
  const tokenType = loadTokenTypePreference() || 'sogni';
  const tokenLabel = tokenType === 'spark' ? 'SPARK' : 'SOGNI';

  // State
  let systemPrompt = options.system;
  let currentImage = null; // { dataUri, fileName, fileSize, format }
  const history = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalRequests = 0;
  let totalTime = 0;
  let totalTTFT = 0;
  let ttftCount = 0;

  // Pre-load image if specified via CLI
  if (options.image) {
    try {
      currentImage = loadImage(options.image);
      console.log();
      console.log(`Image loaded: ${currentImage.fileName} (${currentImage.format}, ${(currentImage.fileSize / 1024).toFixed(0)}KB)`);
    } catch (err) {
      console.error(`Failed to load image: ${err.message}`);
    }
  }

  console.log();
  console.log(`Model:       ${VLM_MODEL}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`Payment:     ${tokenLabel}`);
  console.log(`Image:       ${currentImage ? `${currentImage.fileName} (${currentImage.format})` : '(none)'}`);
  console.log(`System:      ${systemPrompt.slice(0, 80)}${systemPrompt.length > 80 ? '...' : ''}`);
  console.log();
  console.log('Type your message and press Enter. Type "exit" to quit.');
  console.log('Commands: /image <path>, /describe, /ocr, /objects, /analyze, /compare <path>');
  console.log('          /clear-image, /clear, /history, /system <msg>, /stats');
  console.log('-'.repeat(60));
  console.log();

  // Listen for job state events
  sogni.chat.on('jobState', (event) => {
    if (event.type === 'pending') {
      process.stdout.write(`  [Pending authorization]\n`);
    } else if (event.type === 'assigned' && event.workerName) {
      process.stdout.write(`  [Worker: ${event.workerName} (assigned)]\n`);
    } else if (event.type === 'initiatingModel' && event.workerName) {
      process.stdout.write(`\n  [Worker: ${event.workerName} (initiating)]\n`);
    } else if (event.type === 'jobStarted' && event.workerName) {
      process.stdout.write(`  [Worker: ${event.workerName} (started)]\n`);
    }
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    const imageTag = currentImage ? ` [${currentImage.fileName}]` : '';
    return new Promise((resolve) => {
      rl.question(`You${imageTag}: `, (answer) => {
        resolve(answer);
      });
    });
  };

  // Handle Ctrl+C gracefully
  rl.on('close', () => {
    console.log('\n\nGoodbye!');
    printStats();
    process.exit(0);
  });

  function printStats() {
    if (totalRequests === 0) return;
    console.log();
    console.log('-'.repeat(40));
    console.log('Session Statistics:');
    console.log(`  Turns:            ${totalRequests}`);
    console.log(
      `  Total Tokens:     ${totalPromptTokens + totalCompletionTokens} (${totalPromptTokens} prompt + ${totalCompletionTokens} completion)`
    );
    console.log(`  Total Time:       ${totalTime.toFixed(2)}s`);
    if (totalCompletionTokens > 0 && totalTime > 0) {
      console.log(`  Avg Speed:        ${(totalCompletionTokens / totalTime).toFixed(1)} tokens/sec`);
    }
    if (ttftCount > 0) {
      console.log(`  Avg TTFT:         ${(totalTTFT / ttftCount).toFixed(2)}s`);
    }
    console.log(`  History Length:   ${history.length} messages`);
    console.log(`  Image:            ${currentImage ? currentImage.fileName : '(none)'}`);
    console.log('-'.repeat(40));
  }

  // Main conversation loop
  while (true) {
    let userInput = await prompt();
    const trimmed = userInput.trim();

    if (!trimmed) continue;
    userInput = trimmed;

    // Handle exit
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log('\nGoodbye!');
      printStats();
      process.exit(0);
    }

    // Handle slash commands
    let compareUri = null;
    if (trimmed.startsWith('/')) {
      const [cmd, ...rest] = trimmed.split(' ');
      switch (cmd.toLowerCase()) {
        case '/image': {
          const imgPath = rest.join(' ');
          if (!imgPath) {
            console.log('  Usage: /image <path-to-image>\n');
            continue;
          }
          try {
            currentImage = loadImage(imgPath);
            console.log(
              `  Image loaded: ${currentImage.fileName} (${currentImage.format}, ${(currentImage.fileSize / 1024).toFixed(0)}KB)\n`
            );
          } catch (err) {
            console.error(`  Error: ${err.message}\n`);
          }
          continue;
        }

        case '/describe':
          if (!currentImage) {
            console.log('  No image loaded. Use /image <path> to load one.\n');
            continue;
          }
          userInput = VISION_PROMPTS.describe;
          break;

        case '/ocr':
          if (!currentImage) {
            console.log('  No image loaded. Use /image <path> to load one.\n');
            continue;
          }
          userInput = VISION_PROMPTS.ocr;
          break;

        case '/objects':
          if (!currentImage) {
            console.log('  No image loaded. Use /image <path> to load one.\n');
            continue;
          }
          userInput = VISION_PROMPTS.objects;
          break;

        case '/analyze':
          if (!currentImage) {
            console.log('  No image loaded. Use /image <path> to load one.\n');
            continue;
          }
          userInput = VISION_PROMPTS.analyze;
          break;

        case '/compare': {
          if (!currentImage) {
            console.log('  No image loaded. Use /image <path> to load the first image.\n');
            continue;
          }
          const comparePath = rest.join(' ');
          if (!comparePath) {
            console.log('  Usage: /compare <path-to-second-image>\n');
            continue;
          }
          try {
            const compareImage = loadImage(comparePath);
            compareUri = compareImage.dataUri;
            console.log(
              `  Comparing with: ${compareImage.fileName} (${compareImage.format}, ${(compareImage.fileSize / 1024).toFixed(0)}KB)`
            );
            userInput = VISION_PROMPTS.compare;
          } catch (err) {
            console.error(`  Error: ${err.message}\n`);
            continue;
          }
          break;
        }

        case '/clear-image':
          currentImage = null;
          console.log('  (Image removed from context)\n');
          continue;

        case '/clear':
          history.length = 0;
          console.log('  (Conversation history cleared)\n');
          continue;

        case '/history':
          console.log();
          console.log('  System:', systemPrompt.slice(0, 100) + (systemPrompt.length > 100 ? '...' : ''));
          if (history.length === 0) {
            console.log('  (No conversation history yet)');
          } else {
            for (const msg of history) {
              const hasImage = Array.isArray(msg.content);
              const text = hasImage
                ? msg.content.find((p) => p.type === 'text')?.text || ''
                : msg.content || '';
              const preview = text.length > 100 ? text.slice(0, 100) + '...' : text;
              const tag = hasImage ? ' [+image]' : '';
              console.log(`  ${msg.role === 'user' ? 'User' : 'Assistant'}${tag}: ${preview}`);
            }
          }
          console.log();
          continue;

        case '/system':
          if (rest.length > 0) {
            systemPrompt = rest.join(' ');
            console.log(`  (System prompt updated: "${systemPrompt.slice(0, 60)}${systemPrompt.length > 60 ? '...' : ''}")\n`);
          } else {
            console.log(`  Current system prompt: "${systemPrompt}"\n`);
          }
          continue;

        case '/stats':
          printStats();
          console.log();
          continue;

        default:
          console.log(`  Unknown command: ${cmd}\n`);
          continue;
      }
    }

    // Build user message (multimodal if image is loaded)
    const imageUri = currentImage ? currentImage.dataUri : null;
    const userMessage = buildUserMessage(userInput, imageUri, compareUri);

    // Add to history
    history.push(userMessage);

    // Build full messages array
    const messages = [{ role: 'system', content: systemPrompt }, ...history];

    // Estimate cost and check balance
    const hasImage = imageUri || compareUri;
    try {
      const estimate = await sogni.chat.estimateCost({
        model: VLM_MODEL,
        messages,
        max_tokens: options.maxTokens,
        tokenType,
      });
      await sogni.account.refreshBalance();
      const balance = sogni.account.currentAccount.balance;
      const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);

      console.log(`  Est. Cost: ${estimate.costInToken.toFixed(6)} ${tokenLabel} (~$${estimate.costInUSD.toFixed(6)})`);
      console.log(`  Balance:   ${available.toFixed(4)} ${tokenLabel}`);
      if (hasImage) {
        console.log(`  (Note: Cost estimate may be less accurate for vision requests)`);
      }

      if (available < estimate.costInToken) {
        console.error(
          `\n  Insufficient balance. You need at least ${estimate.costInToken.toFixed(6)} ${tokenLabel} but have ${available.toFixed(4)} ${tokenLabel}.`
        );
        console.error(
          `  Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai\n`
        );
        history.pop();
        continue;
      }
    } catch {
      // Estimation endpoint may not be available; proceed anyway
    }

    try {
      const startTime = Date.now();
      let firstTokenTime = null;

      process.stdout.write('\nAssistant: ');

      const stream = await sogni.chat.completions.create({
        model: VLM_MODEL,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        ...(options.topK != null && { top_k: options.topK }),
        stream: true,
        tokenType,
        think: false,
        taskProfile: 'reasoning',
      });

      let rawContent = '';
      const filter = createThinkingFilter(false);

      for await (const chunk of stream) {
        if (chunk.content) {
          if (!firstTokenTime) firstTokenTime = Date.now();
          filter.write(chunk.content);
          rawContent += chunk.content;
        }
      }
      filter.flush();

      // If the model wrapped everything in <think> tags, the filter produced
      // no visible output. Fall back to stripping the tags and showing content.
      let visibleContent = filter.getVisibleOutput();
      if (!visibleContent.trim() && rawContent.trim()) {
        const stripped = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (stripped) {
          process.stdout.write(stripped);
          visibleContent = stripped;
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const result = stream.finalResult;

      // Store cleaned content in history (strip think tags to save context tokens)
      const cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      history.push({ role: 'assistant', content: cleanContent || visibleContent });

      // Update stats
      totalRequests++;
      totalTime += result?.timeTaken || elapsed;
      if (firstTokenTime) {
        totalTTFT += (firstTokenTime - startTime) / 1000;
        ttftCount++;
      }
      if (result?.usage) {
        totalPromptTokens += result.usage.prompt_tokens;
        totalCompletionTokens += result.usage.completion_tokens;
      }

      // Print detailed stats
      const ttft = firstTokenTime ? ((firstTokenTime - startTime) / 1000).toFixed(2) : 'n/a';
      console.log();
      console.log(`  [TTFT: ${ttft}s | Time: ${elapsed.toFixed(2)}s${result ? ` (server: ${result.timeTaken.toFixed(2)}s)` : ''} | Finish: ${result?.finishReason || 'unknown'}]`);
      if (result?.usage) {
        const tps = result.usage.completion_tokens / (result.timeTaken || elapsed);
        console.log(
          `  [Tokens: ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total | ${tps.toFixed(1)} tok/s]`
        );
      }

      // Detect invalid / truncated responses and suggest /clear
      const finishReason = result?.finishReason;
      if (finishReason === 'length') {
        console.log(`  Warning: Response was truncated (hit max_tokens limit).`);
        console.log(`  Tip: Use /clear to free up context tokens, or increase --max-tokens.`);
      } else if (!visibleContent.trim() && !cleanContent.trim()) {
        console.log(`  Warning: Response was empty — the model may have exhausted output tokens on internal reasoning.`);
        console.log(`  Tip: Use /clear to reset conversation history and free up available max tokens.`);
      }
      console.log();
    } catch (err) {
      if (err.message.includes('insufficient_balance')) {
        const balance = sogni.account.currentAccount.balance;
        const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
        console.error(`\n  Insufficient balance. You have ${available.toFixed(4)} ${tokenLabel}.`);
        console.error(
          `  Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai\n`
        );
      } else {
        console.error(`\n  Error: ${err.message}\n`);
      }
      // Remove the failed user message from history
      history.pop();
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
