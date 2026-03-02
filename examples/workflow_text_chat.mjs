#!/usr/bin/env node
/**
 * Text Chat Completion Workflow (Non-Streaming)
 *
 * This script sends a chat completion request to a Sogni LLM worker
 * and receives the full response at once (non-streaming).
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - LLM workers must be online on the Sogni network
 *
 * Usage:
 *   node workflow_text_chat.mjs                                    # Interactive
 *   node workflow_text_chat.mjs "What is the meaning of life?"     # With prompt
 *   node workflow_text_chat.mjs "Explain quantum computing" --model qwen3.5-35b-a3b-gguf-q4km
 *   node workflow_text_chat.mjs "Write a haiku" --max-tokens 100 --temperature 0.9
 *
 * Options:
 *   --model         LLM model ID (default: qwen3.5-35b-a3b-gguf-q4km)
 *   --max-tokens    Maximum tokens to generate (default: 4096)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt (default: "You are a helpful assistant.")
 *   --freq-penalty  Frequency penalty -2 to 2 (default: 0)
 *   --pres-penalty  Presence penalty -2 to 2 (default: 0)
 *   --think         Enable model thinking/reasoning (shows <think> blocks)
 *   --no-think      Disable model thinking (default)
 *   --help          Show this help message
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';

const DEFAULT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
const DEFAULT_SYSTEM = 'You are a helpful assistant.';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    system: DEFAULT_SYSTEM,
    frequencyPenalty: 0,
    presencePenalty: 0,
    think: false,
    thinkExplicit: false,
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
    } else if (arg === '--freq-penalty' && args[i + 1]) {
      options.frequencyPenalty = parseFloat(args[++i]);
    } else if (arg === '--pres-penalty' && args[i + 1]) {
      options.presencePenalty = parseFloat(args[++i]);
    } else if (arg === '--think') {
      options.think = true;
      options.thinkExplicit = true;
    } else if (arg === '--no-think') {
      options.think = false;
      options.thinkExplicit = true;
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
    } else if (!arg.startsWith('--')) {
      // Treat extra positional args as part of the prompt
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
Text Chat Completion (Non-Streaming)

Usage:
  node workflow_text_chat.mjs                                    # Interactive
  node workflow_text_chat.mjs "What is the meaning of life?"     # With prompt
  node workflow_text_chat.mjs "Explain X" --model <model-id>     # Specific model

Options:
  --model         LLM model ID (default: ${DEFAULT_MODEL})
  --max-tokens    Maximum tokens to generate (default: 4096)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt (default: "${DEFAULT_SYSTEM}")
  --freq-penalty  Frequency penalty -2 to 2 (default: 0)
  --pres-penalty  Presence penalty -2 to 2 (default: 0)
  --think         Enable model thinking/reasoning (shows <think> blocks)
  --no-think      Disable model thinking (default)
  --help          Show this help message
`);
}

async function askQuestion(question) {
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('  Sogni Chat Completion (Non-Streaming)');
  console.log('='.repeat(60));
  console.log();

  // Load credentials
  const credentials = await loadCredentials();

  // Prompt for message if not given
  if (!options.prompt) {
    options.prompt = await askQuestion('You: ');
    if (!options.prompt) {
      console.error('No prompt provided.');
      process.exit(1);
    }

    // Ask about thinking mode if not specified via CLI
    if (!options.thinkExplicit) {
      console.log();
      console.log('Thinking mode lets the model reason step-by-step before answering.');
      console.log('Best for: complex reasoning, math, logic puzzles, code debugging, analysis.');
      const thinkAnswer = await askQuestion('Enable thinking mode? (y/N): ');
      options.think = thinkAnswer.toLowerCase() === 'y' || thinkAnswer.toLowerCase() === 'yes';
    }
  }

  // Connect to Sogni
  console.log('Connecting to Sogni...');
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const sogni = await SogniClient.createInstance({
    appId: `sogni-chat-${Date.now()}`,
    network: 'fast',
    ...(credentials.apiKey && { apiKey: credentials.apiKey }),
    ...(testnet && { testnet }),
    ...(socketEndpoint && { socketEndpoint }),
    ...(restEndpoint && { restEndpoint }),
  });

  // Guard against stale SDK builds in local development.
  if (!sogni.chat || typeof sogni.chat.completions?.create !== 'function') {
    console.error('This example requires the Chat API, but the loaded SDK build does not expose `sogni.chat`.');
    console.error('If you are running from a local checkout, rebuild the SDK from repository root:');
    console.error('  npm run build');
    console.error('Then run this example again from the examples directory.');
    process.exit(1);
  }

  if (!credentials.apiKey) {
    await sogni.account.login(credentials.username, credentials.password);
    console.log(`Logged in as: ${credentials.username}`);
  } else {
    console.log('Authenticated with API key');
  }
  console.log();

  // Wait for LLM models to be received from the network
  let availableModels = {};
  try {
    availableModels = await sogni.chat.waitForModels();
    console.log('Available LLM models:');
    const modelIds = Object.keys(availableModels);
    for (let i = 0; i < modelIds.length; i++) {
      const id = modelIds[i];
      const workers = availableModels[id].workers;
      console.log(`  [${i + 1}] ${id} (${workers} worker${workers !== 1 ? 's' : ''})`);
    }
    console.log();

    // Validate that the selected model is available
    if (!modelIds.includes(options.model)) {
      console.log(`Note: Selected model "${options.model}" is not currently available. Request will be queued.`);
    }
  } catch {
    console.log('Warning: No LLM models currently available on the network');
    console.log();
  }

  // Load token type preference
  const tokenType = loadTokenTypePreference() || 'sogni';

  // Build messages
  const messages = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  const userContent = options.think ? options.prompt : `${options.prompt} /no_think`;
  messages.push({ role: 'user', content: userContent });

  // Display request info
  const tokenLabel = tokenType === 'spark' ? 'SPARK' : 'SOGNI';
  console.log(`Model:       ${options.model}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`Thinking:    ${options.think ? 'enabled' : 'disabled'}`);
  console.log(`Payment:     ${tokenLabel}`);
  console.log(`Prompt:      ${options.prompt.length > 80 ? options.prompt.slice(0, 80) + '...' : options.prompt}`);
  console.log();

  // Estimate cost and check balance before submitting
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
    console.log();

    if (available < estimate.costInToken) {
      console.error(`Insufficient balance. You need at least ${estimate.costInToken.toFixed(6)} ${tokenLabel} but have ${available.toFixed(4)} ${tokenLabel}.`);
      console.error(`Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai`);
      process.exit(1);
    }
  } catch (err) {
    // Estimation endpoint may not be available; proceed anyway and let the server decide
    console.log('(Could not estimate cost, proceeding with request)');
    console.log();
  }

  // Listen for job state events (worker assignment)
  if (typeof sogni.chat.on === 'function') {
    sogni.chat.on('jobState', (event) => {
      if (event.type === 'pending') {
        console.log(`Status:       pending authorization`);
      } else if (event.type === 'queued') {
        console.log(`Status:       queued`);
      } else if (event.type === 'assigned' && event.workerName) {
        console.log(`Worker:       ${event.workerName} (assigned)`);
      } else if (event.type === 'initiatingModel' && event.workerName) {
        console.log(`Worker:       ${event.workerName} (initiating)`);
      } else if (event.type === 'jobStarted' && event.workerName) {
        console.log(`Worker:       ${event.workerName} (started)`);
      }
    });
  }

  console.log('Waiting for response...');
  console.log();

  try {
    const startTime = Date.now();

    const result = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      frequency_penalty: options.frequencyPenalty,
      presence_penalty: options.presencePenalty,
      stream: false,
      tokenType,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Display response
    console.log('-'.repeat(60));
    console.log('Assistant:');
    console.log();
    console.log(result.content);
    console.log();
    console.log('-'.repeat(60));
    if (result.workerName) {
      console.log(`Worker:       ${result.workerName}`);
    }
    console.log(`Time:         ${elapsed}s (server: ${result.timeTaken.toFixed(2)}s)`);
    console.log(`Finish:       ${result.finishReason}`);
    if (result.usage) {
      console.log(`Tokens:       ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`);
    }
    console.log();
  } catch (err) {
    if (err.message.includes('insufficient_balance')) {
      const balance = sogni.account.currentAccount.balance;
      const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
      console.error(`Insufficient balance. You have ${available.toFixed(4)} ${tokenLabel}.`);
      console.error(`Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai`);
    } else {
      console.error('Chat completion failed:', err.message);
    }
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
