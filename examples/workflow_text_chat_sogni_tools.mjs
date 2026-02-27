#!/usr/bin/env node
/**
 * Text Chat with Sogni Platform Tools
 *
 * Interactive chat that uses the LLM to generate images, videos, and music
 * through natural language. The SDK provides built-in Sogni tool definitions
 * that the LLM can call, and the script executes them via the Sogni ProjectsApi.
 *
 * When you say "generate an image of a sunset", the LLM will:
 *   1. Call the sogni_generate_image tool with a detailed prompt
 *   2. The script executes the tool via sogni.projects.create()
 *   3. The result URL is sent back to the LLM
 *   4. The LLM provides a natural language response with the result
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file
 * - LLM workers AND image/video/music workers must be online
 *
 * Usage:
 *   node workflow_text_chat_sogni_tools.mjs
 *   node workflow_text_chat_sogni_tools.mjs "Create an image of a cyberpunk city"
 *   node workflow_text_chat_sogni_tools.mjs "Generate a peaceful piano music track"
 *   node workflow_text_chat_sogni_tools.mjs --think "Make me a video of ocean waves"
 *
 * Options:
 *   --model         LLM model ID (default: qwen3-30b-a3b-gptq-int4)
 *   --max-tokens    Maximum tokens to generate (default: 4096)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt override
 *   --think         Enable model thinking/reasoning (shows <think> blocks)
 *   --no-think      Disable model thinking (default)
 *   --tool-choice   Tool choice strategy: auto (default). Note: "required" is broken
 *                   with Qwen3 + Hermes parser due to vLLM guided decoding conflict.
 *   --help          Show this help message
 */

import {
  SogniClient,
  buildSogniTools,
  isSogniToolCall,
  parseToolCallArguments,
} from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import * as fs from 'node:fs';
import * as readline from 'node:readline';

const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
const OUTPUT_DIR = './output';

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    system: null,
    think: false,
    thinkExplicit: false,
    // IMPORTANT: Always use "auto" with Qwen3 + Hermes parser. "required" triggers
    // vLLM guided decoding which applies a JSON array grammar that conflicts with
    // Qwen3's <tool_call> XML format, causing the model to output plain text instead
    // of structured tool calls. See vLLM issues #22132 and #27766.
    toolChoice: 'auto',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--max-tokens' && args[i + 1]) {
      options.maxTokens = parseInt(args[++i], 10);
    } else if (arg === '--temperature' && args[i + 1]) {
      options.temperature = parseFloat(args[++i]);
    } else if (arg === '--top-p' && args[i + 1]) {
      options.topP = parseFloat(args[++i]);
    } else if (arg === '--system' && args[i + 1]) {
      options.system = args[++i];
    } else if (arg === '--think') {
      options.think = true;
      options.thinkExplicit = true;
    } else if (arg === '--no-think') {
      options.think = false;
      options.thinkExplicit = true;
    } else if (arg === '--tool-choice' && args[i + 1]) {
      options.toolChoice = args[++i];
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
    } else if (!arg.startsWith('--')) {
      options.prompt = options.prompt ? `${options.prompt} ${arg}` : arg;
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
Text Chat with Sogni Platform Tools (Image, Video, Music Generation)

Usage:
  node workflow_text_chat_sogni_tools.mjs                                        # Interactive REPL
  node workflow_text_chat_sogni_tools.mjs "Create an image of a cyberpunk city"  # Single prompt
  node workflow_text_chat_sogni_tools.mjs "Generate a piano music track"         # Music
  node workflow_text_chat_sogni_tools.mjs "Make me a video of ocean waves"       # Video

Tools:
  sogni_generate_image   Generate images via the Sogni Supernet
  sogni_generate_video   Generate short videos via the Sogni Supernet
  sogni_generate_music   Generate music tracks via the Sogni Supernet

Options:
  --model         LLM model ID (default: ${DEFAULT_MODEL})
  --max-tokens    Maximum tokens to generate (default: 4096)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt override
  --think         Enable model thinking/reasoning (shows <think> blocks)
  --no-think      Disable model thinking (default)
  --tool-choice   Tool choice strategy (default: auto). Note: "required" is broken
                  with Qwen3 + Hermes parser due to vLLM guided decoding conflict.
  --help          Show this help message
`);
}

// ============================================================
// System Prompt Builder
// ============================================================

function buildSystemPrompt(customPrompt, mediaModels, thinkEnabled) {
  if (customPrompt) {
    return thinkEnabled ? customPrompt : `${customPrompt} /no_think`;
  }

  let modelList = '';
  if (mediaModels && mediaModels.length > 0) {
    const imageModels = mediaModels.filter(m => m.media === 'image');
    const videoModels = mediaModels.filter(m => m.media === 'video');
    const audioModels = mediaModels.filter(m => m.media === 'audio');

    const sections = [];
    if (imageModels.length) {
      sections.push(`  Image: ${imageModels.map(m => m.id).join(', ')}`);
    }
    if (videoModels.length) {
      sections.push(`  Video: ${videoModels.map(m => m.id).join(', ')}`);
    }
    if (audioModels.length) {
      sections.push(`  Music: ${audioModels.map(m => m.id).join(', ')}`);
    }
    if (sections.length) {
      modelList = `\n\nCurrently available models on the network:\n${sections.join('\n')}`;
    }
  }

  const prompt = `You are a creative AI assistant powered by the Sogni Supernet.
You have tools to generate images, videos, and music.

RULES:
1. When the user asks to create ANY media (image, video, music), you MUST call the appropriate tool.
2. You CANNOT create media yourself. You MUST use sogni_generate_image, sogni_generate_video, or sogni_generate_music.
3. Do NOT invent or hallucinate URLs. Only share URLs returned by the tools.
4. Expand short user requests into rich, detailed prompts for the best results.
5. After the tool returns, describe what was created and share the URL.
6. For normal conversation (questions, explanations, etc.), respond naturally without tools.${modelList}`;

  return thinkEnabled ? prompt : `${prompt} /no_think`;
}

// ============================================================
// Sogni Tool Execution
// ============================================================

async function executeSogniTool(sogni, toolCall, tokenType, mediaModels) {
  const args = parseToolCallArguments(toolCall);
  const name = toolCall.function.name;

  console.log(`\n  Tool: ${name}`);
  console.log(`  Args: ${JSON.stringify(args, null, 2)}`);

  switch (name) {
    case 'sogni_generate_image': {
      const requestedModel = args.model;
      let modelId = requestedModel || 'flux1-schnell-fp8';

      // Validate model is available
      if (mediaModels && mediaModels.length > 0) {
        const imageModels = mediaModels.filter(m => m.media === 'image');
        const match = imageModels.find(m => m.id === modelId);
        if (!match && imageModels.length > 0) {
          // Fall back to first available image model
          modelId = imageModels[0].id;
          console.log(`  Model ${requestedModel} not available, using: ${modelId}`);
        }
      }

      const width = Math.min(args.width || 1024, 2048);
      const height = Math.min(args.height || 1024, 2048);

      console.log(`  Model: ${modelId} | ${width}x${height}`);

      const project = await sogni.projects.create({
        type: 'image',
        modelId,
        positivePrompt: args.prompt,
        negativePrompt: args.negative_prompt || '',
        numberOfMedia: 1,
        steps: args.steps || 4,
        seed: args.seed || -1,
        width,
        height,
        tokenType,
      });

      const images = await project.waitForCompletion();
      const image = images[0];

      if (!image || image.triggeredNSFWFilter) {
        return JSON.stringify({ error: 'Image generation failed or was filtered' });
      }

      const resultUrl = await image.getResultUrl();

      // Save locally
      if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const filename = `${OUTPUT_DIR}/sogni_image_${Date.now()}.jpg`;
      try {
        const response = await fetch(resultUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filename, buffer);
        console.log(`  Saved: ${filename}`);
      } catch (e) {
        console.log(`  (Could not save locally: ${e.message})`);
      }

      return JSON.stringify({
        status: 'success',
        image_url: resultUrl,
        local_path: filename,
        model: modelId,
        prompt: args.prompt,
        width,
        height,
      });
    }

    case 'sogni_generate_video': {
      let modelId = args.model;

      // Find a video model
      if (mediaModels && mediaModels.length > 0) {
        const videoModels = mediaModels.filter(m => m.media === 'video');

        if (modelId) {
          const match = videoModels.find(m => m.id === modelId);
          if (!match && videoModels.length > 0) {
            // Prefer a t2v model
            const t2v = videoModels.find(m => m.id.includes('t2v'));
            modelId = t2v ? t2v.id : videoModels[0].id;
            console.log(`  Model ${args.model} not available, using: ${modelId}`);
          }
        } else if (videoModels.length > 0) {
          const t2v = videoModels.find(m => m.id.includes('t2v'));
          modelId = t2v ? t2v.id : videoModels[0].id;
        }
      }

      if (!modelId) {
        return JSON.stringify({ error: 'No video generation model available on the network' });
      }

      const duration = Math.max(1, Math.min(args.duration || 5, 10));
      const fps = args.fps || 16;
      const width = args.width || 848;
      const height = args.height || 480;

      console.log(`  Model: ${modelId} | ${width}x${height} | ${duration}s @ ${fps}fps`);

      const project = await sogni.projects.create({
        type: 'video',
        network: 'fast',
        modelId,
        positivePrompt: args.prompt,
        negativePrompt: args.negative_prompt || '',
        numberOfMedia: 1,
        seed: args.seed || -1,
        width,
        height,
        duration,
        fps,
        tokenType,
      });

      const results = await project.waitForCompletion();
      const video = results[0];
      if (!video) return JSON.stringify({ error: 'Video generation failed' });
      const resultUrl = await video.getResultUrl();

      // Save locally
      if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const filename = `${OUTPUT_DIR}/sogni_video_${Date.now()}.mp4`;
      try {
        const response = await fetch(resultUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filename, buffer);
        console.log(`  Saved: ${filename}`);
      } catch (e) {
        console.log(`  (Could not save locally: ${e.message})`);
      }

      return JSON.stringify({
        status: 'success',
        video_url: resultUrl,
        local_path: filename,
        model: modelId,
        prompt: args.prompt,
        duration,
        fps,
        width,
        height,
      });
    }

    case 'sogni_generate_music': {
      let modelId = args.model;

      // Find an audio model
      if (mediaModels && mediaModels.length > 0) {
        const audioModels = mediaModels.filter(m => m.media === 'audio');

        if (modelId) {
          const match = audioModels.find(m => m.id === modelId);
          if (!match && audioModels.length > 0) {
            modelId = audioModels[0].id;
            console.log(`  Model ${args.model} not available, using: ${modelId}`);
          }
        } else if (audioModels.length > 0) {
          modelId = audioModels[0].id;
        }
      }

      if (!modelId) {
        modelId = 'ace_step_1.5_turbo';
      }

      const duration = Math.max(10, Math.min(args.duration || 30, 600));
      const outputFormat = args.output_format || 'mp3';

      console.log(`  Model: ${modelId} | ${duration}s | ${outputFormat}`);

      const createParams = {
        type: 'audio',
        modelId,
        positivePrompt: args.prompt,
        numberOfMedia: 1,
        duration,
        seed: args.seed || -1,
        outputFormat,
        tokenType,
      };

      // Add optional music params
      if (args.bpm) createParams.bpm = args.bpm;
      if (args.keyscale) createParams.keyscale = args.keyscale;
      if (args.timesignature) createParams.timesignature = args.timesignature;

      const project = await sogni.projects.create(createParams);

      const results = await project.waitForCompletion();
      const audio = results[0];
      if (!audio) return JSON.stringify({ error: 'Music generation failed' });
      const resultUrl = await audio.getResultUrl();

      // Save locally
      const ext = outputFormat === 'flac' ? 'flac' : outputFormat === 'wav' ? 'wav' : 'mp3';
      if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const filename = `${OUTPUT_DIR}/sogni_music_${Date.now()}.${ext}`;
      try {
        const response = await fetch(resultUrl);
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(filename, buffer);
        console.log(`  Saved: ${filename}`);
      } catch (e) {
        console.log(`  (Could not save locally: ${e.message})`);
      }

      return JSON.stringify({
        status: 'success',
        audio_url: resultUrl,
        local_path: filename,
        model: modelId,
        prompt: args.prompt,
        duration,
        format: outputFormat,
      });
    }

    default:
      return JSON.stringify({ error: `Unknown Sogni tool: ${name}` });
  }
}

// ============================================================
// Single Turn: send messages → stream → handle tool calls
// ============================================================

async function runTurn(sogni, messages, tools, options, tokenType, mediaModels) {
  const MAX_ROUNDS = 5;
  const startTime = Date.now();
  let lastResult = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const toolChoice = options.toolChoice;

    if (round === 0) {
      console.log(`\ntool_choice: ${toolChoice}`);
    }

    console.log(`${round > 0 ? '\n' : ''}[Round ${round + 1}] Sending to LLM...`);

    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      tools,
      tool_choice: toolChoice,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      stream: true,
      tokenType,
    });

    // Stream the response
    let content = '';
    process.stdout.write('\nAssistant: ');
    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        content += chunk.content;
      }
    }
    console.log();

    const result = stream.finalResult;
    lastResult = result;
    if (!result) break;

    // If model called tools, execute them and loop back
    if (result.finishReason === 'tool_calls' && result.tool_calls && result.tool_calls.length > 0) {
      console.log(`\n  Model requested ${result.tool_calls.length} tool call(s):`);

      // Add assistant message with tool_calls
      messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.tool_calls,
      });

      // Execute each tool
      for (const toolCall of result.tool_calls) {
        let toolResult;
        try {
          if (isSogniToolCall(toolCall)) {
            console.log(`\n  Executing Sogni platform tool: ${toolCall.function.name}...`);
            toolResult = await executeSogniTool(sogni, toolCall, tokenType, mediaModels);
          } else {
            toolResult = JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` });
          }
        } catch (e) {
          console.error(`  Tool execution failed: ${e.message}`);
          toolResult = JSON.stringify({ error: `Tool execution failed: ${e.message}` });
        }

        console.log(`  Result: ${toolResult.slice(0, 150)}${toolResult.length > 150 ? '...' : ''}`);

        messages.push({
          role: 'tool',
          content: toolResult,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
        });
      }

      // Continue loop to get LLM's response to tool results
      continue;
    }

    // Model responded with text — add to messages and break
    messages.push({
      role: 'assistant',
      content: result.content || '',
    });
    break;
  }

  // Print stats for this turn
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log();
  console.log('-'.repeat(60));
  if (lastResult?.workerName) {
    console.log(`Worker:      ${lastResult.workerName}`);
  }
  console.log(`Time:        ${elapsed}s${lastResult ? ` (server: ${lastResult.timeTaken.toFixed(2)}s)` : ''}`);
  console.log(`Finish:      ${lastResult?.finishReason || 'unknown'}`);
  if (lastResult?.usage) {
    const tps = lastResult.usage.completion_tokens / lastResult.timeTaken;
    console.log(
      `Tokens:      ${lastResult.usage.prompt_tokens} prompt + ${lastResult.usage.completion_tokens} completion = ${lastResult.usage.total_tokens} total`,
    );
    console.log(`Speed:       ${tps.toFixed(1)} tokens/sec`);
  }

  return lastResult;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('  Sogni Chat — Platform Tools Demo');
  console.log('  (Image, Video, and Music Generation via Chat)');
  console.log('='.repeat(60));
  console.log();

  // Load credentials
  const credentials = await loadCredentials();

  // Connect
  console.log('Connecting to Sogni...');
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const sogni = await SogniClient.createInstance({
    appId: `sogni-platform-tools-${Date.now()}`,
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

  const tokenType = loadTokenTypePreference() || 'sogni';
  const tokenLabel = tokenType === 'spark' ? 'SPARK' : 'SOGNI';

  // Wait for LLM models
  try {
    const models = await sogni.chat.waitForModels();
    console.log('Available LLM models:');
    for (const [id, info] of Object.entries(models)) {
      console.log(`  ${id} (${info.workers} worker${info.workers !== 1 ? 's' : ''})`);
    }
  } catch {
    console.log('Warning: No LLM models currently available');
  }

  // Wait for media models + build dynamic tools
  let mediaModels = [];
  let tools;
  try {
    mediaModels = await sogni.projects.waitForModels(15000);
    tools = buildSogniTools(mediaModels);
    console.log('Available media models:');
    const byType = {};
    for (const m of mediaModels) {
      if (!byType[m.media]) byType[m.media] = [];
      byType[m.media].push(m.id);
    }
    for (const [type, ids] of Object.entries(byType)) {
      console.log(`  ${type}: ${ids.join(', ')}`);
    }
  } catch {
    console.log('Warning: No media models currently available (using default tool definitions)');
    tools = buildSogniTools();
  }
  console.log();

  // Build system prompt
  const systemPrompt = buildSystemPrompt(options.system, mediaModels, options.think);

  // Listen for job state events
  sogni.chat.on('jobState', (event) => {
    if (event.type === 'pending') {
      console.log(`Status:      pending authorization`);
    } else if (event.type === 'queued') {
      console.log(`Status:      queued`);
    } else if (event.type === 'assigned' && event.workerName) {
      console.log(`Worker:      ${event.workerName} (assigned)`);
    } else if (event.type === 'initiatingModel' && event.workerName) {
      console.log(`Worker:      ${event.workerName} (initiating)`);
    } else if (event.type === 'jobStarted' && event.workerName) {
      console.log(`Worker:      ${event.workerName} (started)`);
    }
  });

  // Conversation state — persists across REPL turns
  const messages = [{ role: 'system', content: systemPrompt }];

  // Display config
  console.log(`Model:       ${options.model}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`Thinking:    ${options.think ? 'enabled' : 'disabled'}`);
  console.log(`Payment:     ${tokenLabel}`);
  console.log(`Tools:       ${tools.map(t => t.function.name).join(', ')}`);
  console.log();

  // Helper: run a single user prompt through the chat
  async function processUserInput(userInput) {
    messages.push({ role: 'user', content: userInput });

    console.log(`\nUser: ${userInput}`);

    // Estimate cost
    try {
      const estimate = await sogni.chat.estimateCost({
        model: options.model,
        messages,
        max_tokens: options.maxTokens,
        tokenType,
      });
      await sogni.account.refreshBalance();
      const balance = sogni.account.currentAccount.balance;
      const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
      console.log(`Est. Cost:   ${estimate.costInToken.toFixed(6)} ${tokenLabel} (~$${estimate.costInUSD.toFixed(6)})`);
      console.log(`Balance:     ${available.toFixed(4)} ${tokenLabel}`);

      if (available < estimate.costInToken) {
        console.error(
          `\nInsufficient balance. Need ${estimate.costInToken.toFixed(6)} ${tokenLabel}, have ${available.toFixed(4)}.`,
        );
        console.error('Tip: Reduce --max-tokens or add funds at https://app.sogni.ai');
        return;
      }
    } catch {
      console.log('(Could not estimate cost, proceeding)');
    }

    try {
      await runTurn(sogni, messages, tools, options, tokenType, mediaModels);
    } catch (err) {
      if (err.message.includes('insufficient_balance')) {
        const balance = sogni.account.currentAccount.balance;
        const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
        console.error(`\nInsufficient balance. You have ${available.toFixed(4)} ${tokenLabel}.`);
        console.error('Tip: Reduce --max-tokens or add funds at https://app.sogni.ai');
      } else {
        console.error(`\nChat error: ${err.message}`);
      }
    }
  }

  // If prompt was given as CLI arg, run it first
  if (options.prompt) {
    await processUserInput(options.prompt);
  }

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Graceful shutdown
  const cleanup = () => {
    console.log('\nGoodbye!');
    rl.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);

  const promptForInput = () => {
    rl.question('\nYou: ', (answer) => {
      const input = answer.trim();

      if (!input) {
        promptForInput();
        return;
      }

      if (input === 'exit' || input === 'quit') {
        cleanup();
        return;
      }

      processUserInput(input).then(() => {
        promptForInput();
      });
    });
  };

  // If we already ran a CLI prompt, or no prompt was given, enter REPL
  if (options.prompt) {
    console.log('\n(Enter next message, or type "exit" to quit)');
  } else {
    console.log('Enter a message to start. Type "exit" to quit.');
    console.log('Examples:');
    console.log('  "Create a beautiful image of a sunset over mountains"');
    console.log('  "Generate a 5-second video of ocean waves"');
    console.log('  "Compose a jazzy piano track, 30 seconds"');
    console.log();
  }

  promptForInput();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
