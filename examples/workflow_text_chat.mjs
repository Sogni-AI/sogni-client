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
 *   node workflow_text_chat.mjs "Explain quantum computing" --model Qwen/Qwen3-30B-A3B-GPTQ-Int4
 *   node workflow_text_chat.mjs "Write a haiku" --max-tokens 100 --temperature 0.9
 *
 * Options:
 *   --model         LLM model ID (default: Qwen/Qwen3-30B-A3B-GPTQ-Int4)
 *   --max-tokens    Maximum tokens to generate (default: 1024)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt (default: "You are a helpful assistant.")
 *   --freq-penalty  Frequency penalty -2 to 2 (default: 0)
 *   --pres-penalty  Presence penalty -2 to 2 (default: 0)
 *   --help          Show this help message
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials } from './credentials.mjs';

const DEFAULT_MODEL = 'Qwen/Qwen3-30B-A3B-GPTQ-Int4';
const DEFAULT_SYSTEM = 'You are a helpful assistant.';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    model: DEFAULT_MODEL,
    maxTokens: 1024,
    temperature: 0.7,
    topP: 0.9,
    system: DEFAULT_SYSTEM,
    frequencyPenalty: 0,
    presencePenalty: 0,
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
  --max-tokens    Maximum tokens to generate (default: 1024)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt (default: "${DEFAULT_SYSTEM}")
  --freq-penalty  Frequency penalty -2 to 2 (default: 0)
  --pres-penalty  Presence penalty -2 to 2 (default: 0)
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

  if (!credentials.apiKey) {
    await sogni.account.login(credentials.username, credentials.password);
    console.log(`Logged in as: ${credentials.username}`);
  } else {
    console.log('Authenticated with API key');
  }
  console.log();

  // Build messages
  const messages = [];
  if (options.system) {
    messages.push({ role: 'system', content: options.system });
  }
  messages.push({ role: 'user', content: options.prompt });

  // Display request info
  console.log(`Model:       ${options.model}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`Prompt:      ${options.prompt.length > 80 ? options.prompt.slice(0, 80) + '...' : options.prompt}`);
  console.log();
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
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    // Display response
    console.log('-'.repeat(60));
    console.log('Assistant:');
    console.log();
    console.log(result.content);
    console.log();
    console.log('-'.repeat(60));
    console.log(`Time:         ${elapsed}s (server: ${result.timeTaken.toFixed(2)}s)`);
    console.log(`Finish:       ${result.finishReason}`);
    if (result.usage) {
      console.log(`Tokens:       ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`);
    }
    console.log();
  } catch (err) {
    console.error('Chat completion failed:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
