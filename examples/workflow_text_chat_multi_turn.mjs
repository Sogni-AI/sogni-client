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
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - LLM workers must be online on the Sogni network
 *
 * Usage:
 *   node workflow_text_chat_multi_turn.mjs
 *   node workflow_text_chat_multi_turn.mjs --model qwen3-30b-a3b-gptq-int4
 *   node workflow_text_chat_multi_turn.mjs --system "You are a pirate. Respond in pirate speak."
 *   node workflow_text_chat_multi_turn.mjs --max-tokens 4096 --temperature 0.9
 *
 * Options:
 *   --model         LLM model ID (default: qwen3-30b-a3b-gptq-int4)
 *   --max-tokens    Maximum tokens per response (default: 4096)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt (default: "You are a helpful assistant.")
 *   --think         Enable model thinking/reasoning (shows <think> blocks)
 *   --no-think      Disable model thinking (default)
 *   --help          Show this help message
 *
 * Commands (during conversation):
 *   /clear          Clear conversation history (keep system prompt)
 *   /history        Show current message history
 *   /system <msg>   Change the system prompt
 *   /think          Toggle thinking mode on/off
 *   /stats          Show session statistics
 *   exit / quit     End the conversation
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import * as readline from 'node:readline';

const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
const DEFAULT_SYSTEM = 'You are a helpful assistant.';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    model: DEFAULT_MODEL,
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    system: DEFAULT_SYSTEM,
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
    } else if (arg === '--think') {
      options.think = true;
      options.thinkExplicit = true;
    } else if (arg === '--no-think') {
      options.think = false;
      options.thinkExplicit = true;
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
  --max-tokens    Maximum tokens per response (default: 4096)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt (default: "${DEFAULT_SYSTEM}")
  --think         Enable model thinking/reasoning (shows <think> blocks)
  --no-think      Disable model thinking (default)
  --help          Show this help message

In-conversation commands:
  /clear          Clear conversation history
  /history        Show message history
  /system <msg>   Change system prompt
  /think          Toggle thinking mode on/off
  /stats          Show session statistics
  exit / quit     End conversation
`);
}

async function askQuestion(question) {
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
  console.log('  Sogni Multi-Turn Chat');
  console.log('='.repeat(60));
  console.log();

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
    appId: `sogni-chat-multi-${Date.now()}`,
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

  // Wait for LLM models to be received from the network
  try {
    const availableModels = await sogni.chat.waitForModels();
    console.log();
    console.log('Available LLM models:');
    const modelIds = Object.keys(availableModels);
    for (let i = 0; i < modelIds.length; i++) {
      const id = modelIds[i];
      const workers = availableModels[id].workers;
      console.log(`  [${i + 1}] ${id} (${workers} worker${workers !== 1 ? 's' : ''})`);
    }
    console.log();

    // If user didn't specify --model and there are multiple models, let them choose
    if (options.model === DEFAULT_MODEL && modelIds.length > 1) {
      const choice = await askQuestion(`Select model [1-${modelIds.length}] (default: 1): `);
      const idx = parseInt(choice, 10);
      if (idx >= 1 && idx <= modelIds.length) {
        options.model = modelIds[idx - 1];
      } else if (!choice) {
        options.model = modelIds[0];
      }
    } else if (options.model === DEFAULT_MODEL && modelIds.length === 1) {
      options.model = modelIds[0];
    }
  } catch {
    console.log('Warning: No LLM models currently available on the network');
    console.log();
  }

  // Load token type preference
  const tokenType = loadTokenTypePreference() || 'sogni';
  const tokenLabel = tokenType === 'spark' ? 'SPARK' : 'SOGNI';

  // Ask about thinking mode if not specified via CLI
  let think = options.think;
  if (!options.thinkExplicit) {
    console.log();
    console.log('Thinking mode lets the model reason step-by-step before answering.');
    console.log('Best for: complex reasoning, math, logic puzzles, code debugging, analysis.');
    const thinkAnswer = await askQuestion('Enable thinking mode? (y/N): ');
    think = thinkAnswer.toLowerCase() === 'y' || thinkAnswer.toLowerCase() === 'yes';
  }

  console.log();
  console.log(`Model:       ${options.model}`);
  console.log(`Max Tokens:  ${options.maxTokens}`);
  console.log(`Temperature: ${options.temperature}`);
  console.log(`Thinking:    ${think ? 'enabled' : 'disabled'}`);
  console.log(`Payment:     ${tokenLabel}`);
  console.log(`System:      ${options.system}`);
  console.log();
  console.log('Type your message and press Enter. Type "exit" to quit.');
  console.log('Commands: /clear, /history, /system <msg>, /think, /stats');
  console.log('-'.repeat(60));
  console.log();

  // Listen for job state events (worker assignment)
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

        case '/think':
          think = !think;
          console.log(`  (Thinking mode ${think ? 'enabled' : 'disabled'})\n`);
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

    // Build full messages array, applying thinking mode to the latest user message
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
    ];
    if (!think) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        messages[messages.length - 1] = { ...lastMsg, content: `${lastMsg.content} /no_think` };
      }
    }

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

      if (available < estimate.costInToken) {
        console.error(`\n  Insufficient balance. You need at least ${estimate.costInToken.toFixed(6)} ${tokenLabel} but have ${available.toFixed(4)} ${tokenLabel}.`);
        console.error(`  Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai\n`);
        history.pop();
        continue;
      }
    } catch {
      // Estimation endpoint may not be available; proceed anyway
    }

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
        tokenType,
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
      if (err.message.includes('insufficient_balance')) {
        const balance = sogni.account.currentAccount.balance;
        const available = parseFloat(tokenType === 'spark' ? balance.spark.net : balance.sogni.net);
        console.error(`\n  Insufficient balance. You have ${available.toFixed(4)} ${tokenLabel}.`);
        console.error(`  Tip: Reduce --max-tokens to lower the estimated cost, or add funds at https://app.sogni.ai\n`);
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
