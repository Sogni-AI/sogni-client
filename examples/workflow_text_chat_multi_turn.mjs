#!/usr/bin/env node
/**
 * Multi-Turn Chat Conversation Workflow
 *
 * This script demonstrates a multi-turn conversation with an LLM worker,
 * maintaining message history across turns. Each response is streamed
 * token-by-token for real-time output.
 *
 * Type your messages at the "You:" prompt. The assistant will respond
 * with streaming output. Type "exit", "quit", or Ctrl+C to end.
 *
 * Prerequisites:
 * - Set SOGNI_USERNAME and SOGNI_PASSWORD in .env file (or will prompt)
 * - LLM workers must be online on the Sogni network
 *
 * Usage:
 *   node workflow_text_chat_multi_turn.mjs
 *   node workflow_text_chat_multi_turn.mjs --model Qwen/Qwen3-30B-A3B-GPTQ-Int4
 *   node workflow_text_chat_multi_turn.mjs --system "You are a pirate. Respond in pirate speak."
 *   node workflow_text_chat_multi_turn.mjs --max-tokens 4096 --temperature 0.9
 *
 * Options:
 *   --model         LLM model ID (default: Qwen/Qwen3-30B-A3B-GPTQ-Int4)
 *   --max-tokens    Maximum tokens per response (default: 2048)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt (default: "You are a helpful assistant.")
 *   --help          Show this help message
 *
 * Commands (during conversation):
 *   /clear          Clear conversation history (keep system prompt)
 *   /history        Show current message history
 *   /system <msg>   Change the system prompt
 *   /stats          Show session statistics
 *   exit / quit     End the conversation
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials } from './credentials.mjs';
import * as readline from 'node:readline';

const DEFAULT_MODEL = 'Qwen/Qwen3-30B-A3B-GPTQ-Int4';
const DEFAULT_SYSTEM = 'You are a helpful assistant.';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    model: DEFAULT_MODEL,
    maxTokens: 2048,
    temperature: 0.7,
    topP: 0.9,
    system: DEFAULT_SYSTEM,
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
Multi-Turn Chat Conversation

Usage:
  node workflow_text_chat_multi_turn.mjs
  node workflow_text_chat_multi_turn.mjs --model <model-id>
  node workflow_text_chat_multi_turn.mjs --system "You are a pirate."

Options:
  --model         LLM model ID (default: ${DEFAULT_MODEL})
  --max-tokens    Maximum tokens per response (default: 2048)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt (default: "${DEFAULT_SYSTEM}")
  --help          Show this help message

In-conversation commands:
  /clear          Clear conversation history
  /history        Show message history
  /system <msg>   Change system prompt
  /stats          Show session statistics
  exit / quit     End conversation
`);
}

async function main() {
  const options = parseArgs();

  console.log('='.repeat(60));
  console.log('  Sogni Multi-Turn Chat');
  console.log('='.repeat(60));
  console.log();

  // Load credentials
  const { username, password } = await loadCredentials();

  // Connect to Sogni
  console.log('Connecting to Sogni...');
  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  const sogni = await SogniClient.createInstance({
    appId: `sogni-chat-multi-${Date.now()}`,
    network: 'fast',
    ...(testnet && { testnet }),
    ...(socketEndpoint && { socketEndpoint }),
    ...(restEndpoint && { restEndpoint }),
  });

  await sogni.account.login(username, password);
  console.log(`Logged in as: ${username}`);
  console.log();
  console.log(`Model:       ${options.model}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`System:      ${options.system}`);
  console.log();
  console.log('Type your message and press Enter. Type "exit" to quit.');
  console.log('Commands: /clear, /history, /system <msg>, /stats');
  console.log('-'.repeat(60));
  console.log();

  // Conversation state
  let systemPrompt = options.system;
  const history = []; // { role, content } pairs (excluding system prompt)
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalRequests = 0;
  let totalTime = 0;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    return new Promise((resolve) => {
      rl.question('You: ', (answer) => {
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
    console.log(`  Total Tokens:     ${totalPromptTokens + totalCompletionTokens} (${totalPromptTokens} prompt + ${totalCompletionTokens} completion)`);
    console.log(`  Total Time:       ${totalTime.toFixed(2)}s`);
    if (totalCompletionTokens > 0 && totalTime > 0) {
      console.log(`  Avg Speed:        ${(totalCompletionTokens / totalTime).toFixed(1)} tokens/sec`);
    }
    console.log(`  History Length:   ${history.length} messages`);
    console.log('-'.repeat(40));
  }

  // Main conversation loop
  while (true) {
    const userInput = await prompt();
    const trimmed = userInput.trim();

    if (!trimmed) continue;

    // Handle exit
    if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
      console.log('\nGoodbye!');
      printStats();
      process.exit(0);
    }

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const [cmd, ...rest] = trimmed.split(' ');
      switch (cmd.toLowerCase()) {
        case '/clear':
          history.length = 0;
          console.log('  (Conversation history cleared)\n');
          continue;

        case '/history':
          console.log();
          console.log('  System:', systemPrompt);
          if (history.length === 0) {
            console.log('  (No conversation history yet)');
          } else {
            for (const msg of history) {
              const preview = msg.content.length > 100 ? msg.content.slice(0, 100) + '...' : msg.content;
              console.log(`  ${msg.role === 'user' ? 'User' : 'Assistant'}: ${preview}`);
            }
          }
          console.log();
          continue;

        case '/system':
          if (rest.length > 0) {
            systemPrompt = rest.join(' ');
            console.log(`  (System prompt updated: "${systemPrompt}")\n`);
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

    // Add user message to history
    history.push({ role: 'user', content: trimmed });

    // Build full messages array
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];

    try {
      const startTime = Date.now();

      process.stdout.write('\nAssistant: ');

      const stream = await sogni.chat.completions.create({
        model: options.model,
        messages,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        top_p: options.topP,
        stream: true,
      });

      let responseContent = '';

      for await (const chunk of stream) {
        if (chunk.content) {
          process.stdout.write(chunk.content);
          responseContent += chunk.content;
        }
      }

      const elapsed = (Date.now() - startTime) / 1000;
      const result = stream.finalResult;

      // Add assistant response to history
      history.push({ role: 'assistant', content: responseContent });

      // Update stats
      totalRequests++;
      totalTime += result?.timeTaken || elapsed;
      if (result?.usage) {
        totalPromptTokens += result.usage.prompt_tokens;
        totalCompletionTokens += result.usage.completion_tokens;
      }

      // Print brief stats
      console.log();
      if (result?.usage) {
        const tps = result.usage.completion_tokens / (result.timeTaken || elapsed);
        console.log(`  [${result.usage.completion_tokens} tokens, ${(result.timeTaken || elapsed).toFixed(1)}s, ${tps.toFixed(0)} tok/s]`);
      }
      console.log();
    } catch (err) {
      console.error(`\n  Error: ${err.message}\n`);
      // Remove the failed user message from history
      history.pop();
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
