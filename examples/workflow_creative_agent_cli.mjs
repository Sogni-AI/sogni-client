#!/usr/bin/env node
/**
 * Interactive Sogni Creative Agent CLI
 *
 * Customer-facing prototype for using Sogni's hosted LLM and hosted creative
 * agent tools from a local terminal. It combines:
 *   - multi-turn chat history
 *   - local Markdown context files for customer style/training notes
 *   - server-side Sogni creative tool execution via /v1/chat/completions
 *   - slash commands for context, billing, tools, and transcript control
 *
 * Usage:
 *   node workflow_creative_agent_cli.mjs
 *   node workflow_creative_agent_cli.mjs "Create an image of an apple using Chroma Flash model"
 *   node workflow_creative_agent_cli.mjs --context ./artist-style.md --subscription
 *
 * Requires SOGNI_API_KEY in examples/.env or the environment.
 */

import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const EXAMPLES_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(EXAMPLES_DIR, 'output', 'creative-agent-cli');

const DEFAULT_MODEL = 'qwen3.6-35b-a3b-gguf-iq4xs';
const DEFAULT_REST_ENDPOINT = 'https://api.sogni.ai';
const DEFAULT_TOOLS_MODE = 'creative-agent';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.4;
const DEFAULT_MAX_CONTEXT_CHARS = 120000;
const DEFAULT_MAX_FILE_CHARS = 32000;
const DEFAULT_MAX_HISTORY_MESSAGES = 30;

const DEFAULT_CONTEXT_SOURCES = [
  'AGENTS.md',
  'CLAUDE.md',
  'SOGNI.md',
  'STYLE.md',
  'ARTIST.md',
  'BRAND.md',
  'sogni.md',
  '.sogni/*.md',
  '.sogni/**/*.md'
];

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'dist-esm',
  'build',
  'coverage',
  '.next',
  '.turbo',
  'output'
]);

const BASE_SYSTEM_PROMPT = [
  'You are Sogni Creative Agent running inside a local CLI.',
  'You help the customer produce concrete visual, video, music, and workflow outputs using Sogni creative tools.',
  'Use the Sogni creative tools when the user asks to create, generate, edit, animate, compose, plan, or transform media.',
  'Use the local Markdown context as persistent customer training: style preferences, shorthand, recurring subjects, brand rules, art direction, and production constraints.',
  'Honor the customer context unless the current turn explicitly overrides it.',
  'Do not claim you can inspect arbitrary local files. You only know the Markdown context files and conversation text provided in this request.',
  'When a tool generates or submits media, summarize the result and the next useful creative action. Keep terminal responses concise.'
].join('\n');

function parseArgs() {
  const args = process.argv.slice(2);
  const positional = [];
  const options = {
    prompt: '',
    model: DEFAULT_MODEL,
    toolsMode: DEFAULT_TOOLS_MODE,
    executeTools: true,
    tokenType: loadTokenTypePreference() || process.env.SOGNI_TOKEN_TYPE || 'spark',
    billingMode: process.env.SOGNI_BILLING_MODE || 'auto',
    maxTokens: DEFAULT_MAX_TOKENS,
    temperature: DEFAULT_TEMPERATURE,
    topP: null,
    think: false,
    contextSources: [],
    autoContext: true,
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
    maxFileChars: DEFAULT_MAX_FILE_CHARS,
    maxHistoryMessages: DEFAULT_MAX_HISTORY_MESSAGES,
    workspace: process.cwd(),
    sessionInstruction: '',
    json: false,
    appSource: 'sogni-creative-agent-cli-example'
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--tools' && args[i + 1]) {
      options.toolsMode = normalizeToolsMode(args[++i]);
    } else if (arg === '--no-execute') {
      options.executeTools = false;
    } else if (arg === '--execute') {
      options.executeTools = true;
    } else if (arg === '--token-type' && args[i + 1]) {
      options.tokenType = normalizeTokenType(args[++i]);
    } else if (arg === '--billing-mode' && args[i + 1]) {
      options.billingMode = normalizeBillingMode(args[++i]);
    } else if (arg === '--subscription') {
      options.billingMode = 'subscription';
    } else if (arg === '--tokens') {
      options.billingMode = 'tokens';
    } else if (arg === '--max-tokens' && args[i + 1]) {
      options.maxTokens = positiveInt(args[++i], DEFAULT_MAX_TOKENS);
    } else if (arg === '--temperature' && args[i + 1]) {
      options.temperature = Number(args[++i]);
    } else if (arg === '--top-p' && args[i + 1]) {
      options.topP = Number(args[++i]);
    } else if (arg === '--think') {
      options.think = true;
    } else if (arg === '--no-think') {
      options.think = false;
    } else if ((arg === '--context' || arg === '-c') && args[i + 1]) {
      options.contextSources.push(args[++i]);
    } else if (arg === '--no-auto-context') {
      options.autoContext = false;
    } else if (arg === '--max-context-chars' && args[i + 1]) {
      options.maxContextChars = positiveInt(args[++i], DEFAULT_MAX_CONTEXT_CHARS);
    } else if (arg === '--max-file-chars' && args[i + 1]) {
      options.maxFileChars = positiveInt(args[++i], DEFAULT_MAX_FILE_CHARS);
    } else if (arg === '--max-history' && args[i + 1]) {
      options.maxHistoryMessages = positiveInt(args[++i], DEFAULT_MAX_HISTORY_MESSAGES);
    } else if (arg === '--workspace' && args[i + 1]) {
      options.workspace = path.resolve(expandHome(args[++i]));
    } else if (arg === '--system' && args[i + 1]) {
      options.sessionInstruction = args[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }

  options.prompt = positional.join(' ').trim();
  options.workspace = path.resolve(expandHome(options.workspace));
  options.billingMode = normalizeBillingMode(options.billingMode);
  options.tokenType = normalizeTokenType(options.tokenType);
  return options;
}

function showHelp() {
  console.log(`
Sogni Creative Agent CLI

Usage:
  node workflow_creative_agent_cli.mjs [prompt] [options]
  node workflow_creative_agent_cli.mjs
  node workflow_creative_agent_cli.mjs "Create an image of an apple using Chroma Flash model"
  node workflow_creative_agent_cli.mjs --context ./artist-style.md --subscription

Options:
  --model <id>              LLM model ID (default: ${DEFAULT_MODEL})
  --tools <mode>            creative-agent, creative-tools, true, false, or none
                            (default: ${DEFAULT_TOOLS_MODE})
  --no-execute              Let the LLM call tools but do not execute them server-side
  --token-type <type>       spark or sogni (default: SOGNI_TOKEN_TYPE or spark)
  --billing-mode <mode>     auto, subscription, or tokens (default: auto)
  --subscription            Shortcut for --billing-mode subscription
  --max-tokens <n>          Maximum assistant output tokens (default: ${DEFAULT_MAX_TOKENS})
  --temperature <n>         Sampling temperature (default: ${DEFAULT_TEMPERATURE})
  --top-p <n>               Optional top-p sampling
  --think / --no-think      Toggle model thinking mode (default: off)
  --context, -c <path>      Add a Markdown file, directory, or glob to persistent context
  --no-auto-context         Do not auto-load AGENTS.md, STYLE.md, .sogni/*.md, etc.
  --max-context-chars <n>   Total Markdown context budget (default: ${DEFAULT_MAX_CONTEXT_CHARS})
  --max-file-chars <n>      Per-file context budget (default: ${DEFAULT_MAX_FILE_CHARS})
  --max-history <n>         Non-system history messages to keep (default: ${DEFAULT_MAX_HISTORY_MESSAGES})
  --workspace <path>        Base directory for relative context paths (default: cwd)
  --system <text>           Extra session instruction appended to the system prompt
  --json                    Print raw hosted responses for each turn
  --help                    Show this help

Interactive commands:
  /help                     Show commands
  /context                  Show loaded Markdown context
  /reload                   Reload context files from disk
  /add <path>               Add a Markdown file, directory, or glob to context
  /system [text|clear]      Show, set, or clear the extra session instruction
  /tools [mode]             Show or set tool mode
  /execute [on|off]         Show or toggle server-side tool execution
  /billing [mode]           Show or set billing mode
  /token [spark|sogni]      Show or set token type
  /model [id]               Show or set LLM model
  /subscription             Fetch subscription status
  /history                  Show compact chat history
  /clear                    Clear chat history
  /last [--json]            Show the last hosted response summary or raw JSON
  /save [path]              Save transcript as Markdown
  /config                   Show runtime config
  /exit                     Quit

Requires SOGNI_API_KEY in examples/.env or the environment.
`);
}

function positiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeToolsMode(value) {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'creative-agent') return 'creative-agent';
  if (normalized === 'creative-tools' || normalized === 'rich' || normalized === 'hosted') {
    return 'creative-tools';
  }
  if (normalized === 'true' || normalized === 'on' || normalized === 'yes') return true;
  if (
    normalized === 'false' ||
    normalized === 'none' ||
    normalized === 'off' ||
    normalized === 'no'
  ) {
    return false;
  }
  return value;
}

function normalizeBillingMode(value) {
  const normalized = String(value || 'auto')
    .trim()
    .toLowerCase();
  if (['auto', 'subscription', 'tokens'].includes(normalized)) return normalized;
  throw new Error(`Invalid billing mode "${value}". Use auto, subscription, or tokens.`);
}

function normalizeTokenType(value) {
  const normalized = String(value || 'spark')
    .trim()
    .toLowerCase();
  if (normalized === 'spark' || normalized === 'sogni') return normalized;
  throw new Error(`Invalid token type "${value}". Use spark or sogni.`);
}

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

function toPortablePath(value) {
  return value.replace(/\\/g, '/');
}

function hasGlobMagic(value) {
  return /[*?[\]{}]/.test(value);
}

function escapeRegex(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(pattern) {
  const portable = toPortablePath(pattern);
  let outputRegex = '';
  for (let i = 0; i < portable.length; i += 1) {
    const char = portable[i];
    const next = portable[i + 1];
    if (char === '*' && next === '*') {
      const after = portable[i + 2];
      if (after === '/') {
        outputRegex += '(?:.*/)?';
        i += 2;
      } else {
        outputRegex += '.*';
        i += 1;
      }
    } else if (char === '*') {
      outputRegex += '[^/]*';
    } else if (char === '?') {
      outputRegex += '[^/]';
    } else {
      outputRegex += escapeRegex(char);
    }
  }
  return new RegExp(`^${outputRegex}$`);
}

function globBase(pattern) {
  const portable = toPortablePath(pattern);
  const parts = portable.split('/');
  const baseParts = [];
  for (const part of parts) {
    if (hasGlobMagic(part)) break;
    baseParts.push(part);
  }
  const base = baseParts.join('/');
  return base || (portable.startsWith('/') ? '/' : '.');
}

function isMarkdownFile(filePath) {
  return /\.md$/i.test(filePath);
}

function safeRelative(fromDir, filePath) {
  const relative = path.relative(fromDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return filePath;
  return relative;
}

function walkMarkdownFiles(rootDir, warnings, depth = 0) {
  const files = [];
  if (depth > 20) return files;

  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch (error) {
    warnings.push(`Could not read directory ${rootDir}: ${error.message}`);
    return files;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      files.push(...walkMarkdownFiles(fullPath, warnings, depth + 1));
    } else if (entry.isFile() && isMarkdownFile(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function expandContextSource(source, workspace) {
  const warnings = [];
  const expanded = expandHome(source);
  const absolutePattern = path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(workspace, expanded);

  if (hasGlobMagic(expanded)) {
    const base = globBase(absolutePattern);
    if (!fs.existsSync(base)) {
      return { files: [], warnings: [`Context glob base does not exist: ${base}`] };
    }
    const matcher = globToRegex(absolutePattern);
    const candidates = walkMarkdownFiles(base, warnings);
    return {
      files: candidates.filter((file) => matcher.test(toPortablePath(file))),
      warnings
    };
  }

  if (!fs.existsSync(absolutePattern)) {
    return { files: [], warnings: [`Context source not found: ${absolutePattern}`] };
  }

  const stat = fs.statSync(absolutePattern);
  if (stat.isDirectory()) {
    const files = walkMarkdownFiles(absolutePattern, warnings);
    if (files.length === 0) warnings.push(`No Markdown files found in: ${absolutePattern}`);
    return { files, warnings };
  }

  if (!stat.isFile()) {
    return { files: [], warnings: [`Context source is not a regular file: ${absolutePattern}`] };
  }

  if (!isMarkdownFile(absolutePattern)) {
    return { files: [], warnings: [`Skipping non-Markdown context file: ${absolutePattern}`] };
  }

  return { files: [absolutePattern], warnings };
}

function loadContext(state) {
  const sourceRecords = [
    ...(state.options.autoContext
      ? DEFAULT_CONTEXT_SOURCES.map((source) => ({ source, auto: true }))
      : []),
    ...state.options.contextSources.map((source) => ({ source, auto: false }))
  ];
  const sources = sourceRecords.map((record) => record.source);

  const warnings = [];
  const seen = new Set();
  const files = [];

  for (const { source, auto } of sourceRecords) {
    const expanded = expandContextSource(source, state.options.workspace);
    warnings.push(
      ...expanded.warnings.filter((warning) => !(auto && isMissingContextWarning(warning)))
    );
    for (const file of expanded.files) {
      const realPath = safeRealPath(file);
      if (!seen.has(realPath)) {
        seen.add(realPath);
        files.push(realPath);
      }
    }
  }

  files.sort((a, b) =>
    safeRelative(state.options.workspace, a).localeCompare(safeRelative(state.options.workspace, b))
  );

  const docs = [];
  let totalIncludedChars = 0;
  let budgetExhausted = false;

  for (const file of files) {
    if (budgetExhausted) break;

    let content;
    try {
      content = fs.readFileSync(file, 'utf8').replace(/\u0000/g, '');
    } catch (error) {
      warnings.push(`Could not read ${file}: ${error.message}`);
      continue;
    }

    const originalChars = content.length;
    let truncatedByFile = false;
    if (content.length > state.options.maxFileChars) {
      content = `${content.slice(0, state.options.maxFileChars)}\n\n[Truncated: file exceeded ${state.options.maxFileChars} characters.]`;
      truncatedByFile = true;
    }

    const remaining = state.options.maxContextChars - totalIncludedChars;
    if (remaining <= 0) {
      budgetExhausted = true;
      break;
    }

    let truncatedByTotal = false;
    if (content.length > remaining) {
      content = `${content.slice(0, Math.max(0, remaining))}\n\n[Truncated: total context budget exhausted.]`;
      truncatedByTotal = true;
      budgetExhausted = true;
    }

    totalIncludedChars += content.length;
    docs.push({
      file,
      relativePath: safeRelative(state.options.workspace, file),
      originalChars,
      includedChars: content.length,
      truncatedByFile,
      truncatedByTotal,
      content
    });
  }

  state.context = {
    sources,
    docs,
    warnings,
    totalIncludedChars,
    budgetExhausted,
    loadedAt: new Date()
  };
}

function isMissingContextWarning(warning) {
  return (
    warning.startsWith('Context source not found:') ||
    warning.startsWith('Context glob base does not exist:')
  );
}

function safeRealPath(file) {
  try {
    return fs.realpathSync(file);
  } catch {
    return path.resolve(file);
  }
}

function buildSystemPrompt(state) {
  const blocks = [BASE_SYSTEM_PROMPT];
  if (state.options.sessionInstruction.trim()) {
    blocks.push(`Additional session instruction:\n${state.options.sessionInstruction.trim()}`);
  }
  blocks.push(formatContextForSystem(state));
  return blocks.join('\n\n');
}

function formatContextForSystem(state) {
  const docs = state.context.docs;
  if (docs.length === 0) {
    return 'Local Markdown context: none loaded.';
  }

  const lines = [
    'Local Markdown context:',
    'Treat these files as customer-provided operating context for style, shortcuts, preferences, and constraints.'
  ];

  for (const doc of docs) {
    lines.push('');
    lines.push(`--- ${doc.relativePath} ---`);
    lines.push(doc.content.trim());
  }

  if (state.context.budgetExhausted) {
    lines.push('');
    lines.push(
      '[Some context files were omitted or truncated because the context budget was exhausted.]'
    );
  }

  return lines.join('\n');
}

function printStartup(state) {
  console.log('='.repeat(68));
  console.log('  Sogni Creative Agent CLI');
  console.log('  Hosted Sogni LLM + Creative Agent tools + local Markdown context');
  console.log('='.repeat(68));
  console.log(`Model:       ${state.options.model}`);
  console.log(
    `Tools:       ${formatToolsMode(state.options.toolsMode)} (${state.options.executeTools ? 'executing' : 'not executing'})`
  );
  console.log(`Billing:     ${state.options.billingMode}`);
  console.log(`Token type:  ${state.options.tokenType}`);
  console.log(`Workspace:   ${state.options.workspace}`);
  printContextSummary(state);
  console.log('Type /help for commands, /exit to quit.');
  console.log();
}

function printContextSummary(state) {
  const docs = state.context.docs;
  const chars = state.context.totalIncludedChars;
  console.log(
    `Context:     ${docs.length} Markdown file${docs.length === 1 ? '' : 's'}, ${chars.toLocaleString()} chars`
  );
  if (state.context.budgetExhausted) {
    console.log('             context budget exhausted; use /context for details');
  }
}

function formatToolsMode(value) {
  if (value === true) return 'true';
  if (value === false) return 'none';
  return String(value);
}

async function createHostedClient(options) {
  const credentials = await loadCredentials();
  if (!credentials.apiKey) {
    throw new Error(
      'SOGNI_API_KEY is required for hosted creative-agent CLI access. ' +
        'Add SOGNI_API_KEY=... to examples/.env or your shell environment.'
    );
  }

  const testnet = process.env.SOGNI_TESTNET === 'true';
  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  return {
    apiKey: credentials.apiKey,
    restEndpoint: process.env.SOGNI_REST_ENDPOINT || DEFAULT_REST_ENDPOINT,
    appSource: options.appSource
  };
}

async function runTurn(hostedClient, state, userText) {
  const requestMessages = [
    { role: 'system', content: buildSystemPrompt(state) },
    ...state.messages,
    { role: 'user', content: userText }
  ];

  const startedAt = Date.now();
  console.log();
  console.log(
    `Sending turn to Sogni (${formatToolsMode(state.options.toolsMode)}, billing=${state.options.billingMode})...`
  );

  const response = await postHostedChatCompletion(hostedClient, {
    model: state.options.model,
    messages: requestMessages,
    max_tokens: state.options.maxTokens,
    temperature: state.options.temperature,
    ...(state.options.topP != null && { top_p: state.options.topP }),
    token_type: state.options.tokenType,
    billingMode: state.options.billingMode,
    sogni_tools: state.options.toolsMode,
    sogni_tool_execution: state.options.executeTools,
    task_profile: 'reasoning',
    chat_template_kwargs: { enable_thinking: state.options.think },
    app_source: state.options.appSource
  });

  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  state.lastResponse = response;
  state.turns.push({ userText, response, elapsedSeconds, at: new Date().toISOString() });

  if (state.options.json) {
    console.log(JSON.stringify(response, null, 2));
  } else {
    printHostedResponse(response, elapsedSeconds);
  }

  state.messages.push({ role: 'user', content: userText });
  state.messages.push({ role: 'assistant', content: buildAssistantHistoryContent(response) });
  trimHistory(state);
}

async function postHostedChatCompletion(hostedClient, body) {
  const response = await fetch(`${hostedClient.restEndpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': hostedClient.apiKey
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return payload;
}

function isStrictSubscriptionBillingError(error) {
  const message = error?.message || String(error);
  return /\b402\b/.test(message) && /Unlimited billing is not available/i.test(message);
}

function extractData(response) {
  return response?.data || response || {};
}

function extractMessage(response) {
  const data = extractData(response);
  return data?.choices?.[0]?.message || data?.choices?.[0]?.delta || {};
}

function extractToolResults(response) {
  const data = extractData(response);
  return Array.isArray(data.sogni_tool_results) ? data.sogni_tool_results : [];
}

function extractCreativeWorkflows(response) {
  const data = extractData(response);
  const workflows = data.creative_workflows || data.creativeWorkflows;
  return Array.isArray(workflows) ? workflows : [];
}

function printHostedResponse(response, elapsedSeconds) {
  const data = extractData(response);
  const message = extractMessage(response);
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  const toolResults = extractToolResults(response);
  const workflows = extractCreativeWorkflows(response);

  console.log();
  if (content) {
    console.log('Assistant:');
    console.log(content);
  } else {
    console.log('Assistant:');
    console.log('(No text response returned.)');
  }

  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length > 0) {
    console.log();
    console.log('Tool calls:');
    for (const call of toolCalls) {
      console.log(`  - ${call.function?.name || call.name || call.id || 'tool_call'}`);
    }
  }

  if (toolResults.length > 0) {
    console.log();
    console.log('Sogni tool results:');
    toolResults.forEach((result, index) => {
      console.log(`  - ${summarizeToolResult(result, index)}`);
    });
  }

  if (workflows.length > 0) {
    console.log();
    console.log('Creative workflows:');
    for (const workflow of workflows) {
      const id = workflow.workflowId || workflow.id || 'workflow';
      const status = workflow.status || 'submitted';
      console.log(`  - ${id}: ${status}`);
      if (workflow.url) console.log(`    ${workflow.url}`);
    }
  }

  const usage = data.usage;
  console.log();
  if (usage) {
    const total = usage.total_tokens ?? (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    console.log(
      `Usage: ${usage.prompt_tokens || 0} prompt + ${usage.completion_tokens || 0} completion = ${total} tokens`
    );
  }
  console.log(`Time:  ${elapsedSeconds.toFixed(2)}s`);
}

function summarizeToolResult(result, index) {
  const tool =
    firstString(result, ['tool', 'toolName', 'tool_name', 'name', 'type', 'media_type']) ||
    `tool_${index + 1}`;
  const failed = result?.success === false || result?.ok === false || Boolean(result?.error);
  const status = failed ? 'failed' : 'ok';
  const message = firstString(result, [
    'message',
    'summary',
    'prompt',
    'script',
    'lyrics',
    'structure',
    'url',
    'local_file',
    'workflowId',
    'id'
  ]);
  const urls = collectUrls(result).slice(0, 2);
  const parts = [`${tool}: ${status}`];
  if (message) parts.push(compactOneLine(message, 180));
  if (urls.length > 0) parts.push(urls.map((url) => compactOneLine(url, 120)).join(' '));
  return parts.join(' - ');
}

function firstString(record, keys) {
  if (!record || typeof record !== 'object') return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function compactOneLine(value, maxChars) {
  const compact = String(value).replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

function collectUrls(value, urls = [], seen = new Set(), depth = 0) {
  if (depth > 5 || urls.length >= 10) return urls;
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) && !seen.has(value)) {
      seen.add(value);
      urls.push(value);
    }
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls, seen, depth + 1);
    return urls;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectUrls(item, urls, seen, depth + 1);
  }
  return urls;
}

function buildAssistantHistoryContent(response) {
  const message = extractMessage(response);
  const content = typeof message.content === 'string' ? message.content.trim() : '';
  const toolResults = extractToolResults(response);
  const workflows = extractCreativeWorkflows(response);
  const blocks = [];

  if (content) blocks.push(content);
  if (toolResults.length > 0) {
    blocks.push(
      `Sogni tool results for continuity:\n${truncate(JSON.stringify(toolResults, null, 2), 6000)}`
    );
  }
  if (workflows.length > 0) {
    blocks.push(
      `Creative workflow references:\n${truncate(JSON.stringify(workflows, null, 2), 2000)}`
    );
  }

  return blocks.join('\n\n') || '[Sogni returned no assistant text.]';
}

function truncate(value, maxChars) {
  const text = String(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 40))}\n[Truncated to ${maxChars} characters.]`;
}

function trimHistory(state) {
  const max = state.options.maxHistoryMessages;
  if (state.messages.length > max) {
    state.messages = state.messages.slice(state.messages.length - max);
  }
}

async function runInteractive(hostedClient, state) {
  const isTerminal = Boolean(input.isTTY && output.isTTY);
  const rl = createInterface({ input, output, terminal: isTerminal });

  try {
    if (!isTerminal) {
      for await (const answer of rl) {
        const shouldContinue = await processInteractiveInput(answer, hostedClient, state);
        if (!shouldContinue) break;
      }
      return;
    }

    while (true) {
      const answer = await askInteractiveLine(rl, isTerminal ? 'sogni> ' : '');
      if (answer === null) break;
      const shouldContinue = await processInteractiveInput(answer, hostedClient, state);
      if (!shouldContinue) break;
    }
  } finally {
    rl.close();
  }
}

async function processInteractiveInput(answer, hostedClient, state) {
  const line = String(answer || '').trim();
  if (!line) return true;

  if (line.startsWith('/')) {
    return handleCommand(line, hostedClient, state);
  }

  if (line === 'exit' || line === 'quit') return false;

  try {
    await runTurn(hostedClient, state, line);
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
  return true;
}

async function askInteractiveLine(rl, prompt) {
  try {
    return await rl.question(prompt);
  } catch (error) {
    if (error?.code === 'ERR_USE_AFTER_CLOSE' || error?.name === 'AbortError') {
      return null;
    }
    throw error;
  }
}

async function handleCommand(line, hostedClient, state) {
  const body = line.slice(1).trim();
  const firstSpace = body.search(/\s/);
  const command = (firstSpace === -1 ? body : body.slice(0, firstSpace)).toLowerCase();
  const arg = firstSpace === -1 ? '' : body.slice(firstSpace + 1).trim();

  switch (command) {
    case 'help':
    case '?':
      printInteractiveHelp();
      return true;
    case 'exit':
    case 'quit':
    case 'q':
      return false;
    case 'context':
      printContextDetails(state);
      return true;
    case 'reload':
      loadContext(state);
      printContextDetails(state);
      return true;
    case 'add':
      if (!arg) {
        console.log('Usage: /add <markdown-file|directory|glob>');
        return true;
      }
      state.options.contextSources.push(arg);
      loadContext(state);
      printContextDetails(state);
      return true;
    case 'system':
      handleSystemCommand(state, arg);
      return true;
    case 'tools':
      handleToolsCommand(state, arg);
      return true;
    case 'execute':
      handleExecuteCommand(state, arg);
      return true;
    case 'billing':
      handleBillingCommand(state, arg);
      return true;
    case 'token':
      handleTokenCommand(state, arg);
      return true;
    case 'model':
      handleModelCommand(state, arg);
      return true;
    case 'subscription':
      await printSubscriptionStatus(hostedClient);
      return true;
    case 'history':
      printHistory(state);
      return true;
    case 'clear':
      state.messages = [];
      state.turns = [];
      console.log('History cleared.');
      return true;
    case 'last':
      printLastResponse(state, arg);
      return true;
    case 'save':
      saveTranscript(state, arg);
      return true;
    case 'config':
      printConfig(state);
      return true;
    default:
      console.log(`Unknown command: /${command}. Type /help for commands.`);
      return true;
  }
}

function printInteractiveHelp() {
  console.log(`
Commands:
  /context              Show loaded Markdown files and warnings
  /reload               Reload Markdown context from disk
  /add <path>           Add Markdown file, directory, or glob to persistent context
  /system [text|clear]  Show, set, or clear extra session instruction
  /tools [mode]         Show or set creative-agent, creative-tools, true, or none
  /execute [on|off]     Show or toggle server-side Sogni tool execution
  /billing [mode]       Show or set auto, subscription, or tokens
  /token [spark|sogni]  Show or set token type
  /model [id]           Show or set LLM model
  /subscription         Fetch current subscription status
  /history              Show compact chat history
  /clear                Clear chat history
  /last [--json]        Show last response summary or raw hosted JSON
  /save [path]          Save transcript as Markdown
  /config               Show runtime config
  /exit                 Quit
`);
}

function printContextDetails(state) {
  console.log();
  console.log('Context sources:');
  state.context.sources.forEach((source, index) => {
    console.log(`  ${index + 1}. ${source}`);
  });

  console.log();
  if (state.context.docs.length === 0) {
    console.log('Loaded Markdown files: none');
  } else {
    console.log('Loaded Markdown files:');
    state.context.docs.forEach((doc, index) => {
      const flags = [];
      if (doc.truncatedByFile) flags.push('file truncated');
      if (doc.truncatedByTotal) flags.push('budget truncated');
      const suffix = flags.length > 0 ? ` (${flags.join(', ')})` : '';
      console.log(
        `  ${index + 1}. ${doc.relativePath} - ${doc.includedChars.toLocaleString()} chars${suffix}`
      );
    });
  }

  console.log();
  console.log(
    `Total context chars: ${state.context.totalIncludedChars.toLocaleString()} / ${state.options.maxContextChars.toLocaleString()}`
  );

  const relevantWarnings = state.context.warnings.filter(
    (warning) => !warning.includes('Context source not found:')
  );
  if (relevantWarnings.length > 0) {
    console.log();
    console.log('Warnings:');
    for (const warning of relevantWarnings) console.log(`  - ${warning}`);
  }
  console.log();
}

function handleSystemCommand(state, arg) {
  if (!arg) {
    console.log(state.options.sessionInstruction || '(No extra session instruction set.)');
    return;
  }
  if (arg.toLowerCase() === 'clear') {
    state.options.sessionInstruction = '';
    console.log('Extra session instruction cleared.');
    return;
  }
  state.options.sessionInstruction = arg;
  console.log('Extra session instruction updated.');
}

function handleToolsCommand(state, arg) {
  if (!arg) {
    console.log(`Tools mode: ${formatToolsMode(state.options.toolsMode)}`);
    return;
  }
  state.options.toolsMode = normalizeToolsMode(arg);
  console.log(`Tools mode: ${formatToolsMode(state.options.toolsMode)}`);
}

function handleExecuteCommand(state, arg) {
  if (!arg) {
    console.log(`Tool execution: ${state.options.executeTools ? 'on' : 'off'}`);
    return;
  }
  const normalized = arg.toLowerCase();
  if (['on', 'true', 'yes', '1'].includes(normalized)) state.options.executeTools = true;
  else if (['off', 'false', 'no', '0'].includes(normalized)) state.options.executeTools = false;
  else {
    console.log('Usage: /execute on|off');
    return;
  }
  console.log(`Tool execution: ${state.options.executeTools ? 'on' : 'off'}`);
}

function handleBillingCommand(state, arg) {
  if (!arg) {
    console.log(`Billing mode: ${state.options.billingMode}`);
    return;
  }
  state.options.billingMode = normalizeBillingMode(arg);
  console.log(`Billing mode: ${state.options.billingMode}`);
}

function handleTokenCommand(state, arg) {
  if (!arg) {
    console.log(`Token type: ${state.options.tokenType}`);
    return;
  }
  state.options.tokenType = normalizeTokenType(arg);
  console.log(`Token type: ${state.options.tokenType}`);
}

function handleModelCommand(state, arg) {
  if (!arg) {
    console.log(`Model: ${state.options.model}`);
    return;
  }
  state.options.model = arg;
  console.log(`Model: ${state.options.model}`);
}

async function printSubscriptionStatus(hostedClient) {
  try {
    const response = await fetch(`${hostedClient.restEndpoint}/v1/subscriptions/status`, {
      headers: { 'api-key': hostedClient.apiKey }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.message || payload?.error?.message || response.statusText;
      throw new Error(`${response.status} ${message}`);
    }
    const status = payload?.data?.subscription || payload?.subscription || {};
    console.log();
    console.log('Subscription:');
    console.log(`  Active: ${status.active ? 'yes' : 'no'}`);
    console.log(`  Status: ${status.status || 'unknown'}`);
    if (status.tier) console.log(`  Tier:   ${status.tier}`);
    if (status.currentPeriodEnd) console.log(`  Until:  ${status.currentPeriodEnd}`);
    console.log();
  } catch (error) {
    console.log(`Could not fetch subscription status: ${error.message}`);
  }
}

function printHistory(state) {
  if (state.messages.length === 0) {
    console.log('History is empty.');
    return;
  }
  console.log();
  console.log(`History (${state.messages.length} messages kept):`);
  state.messages.forEach((message, index) => {
    console.log(`  ${index + 1}. ${message.role}: ${compactOneLine(message.content || '', 140)}`);
  });
  console.log();
}

function printLastResponse(state, arg) {
  if (!state.lastResponse) {
    console.log('No hosted response yet.');
    return;
  }
  if (arg === '--json') {
    console.log(JSON.stringify(state.lastResponse, null, 2));
    return;
  }
  printHostedResponse(state.lastResponse, state.turns[state.turns.length - 1]?.elapsedSeconds || 0);
}

function saveTranscript(state, arg) {
  const target = arg
    ? path.resolve(state.options.workspace, expandHome(arg))
    : path.join(OUTPUT_DIR, `creative-agent-session-${timestampForFilename(new Date())}.md`);

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lines = [
    '# Sogni Creative Agent CLI Session',
    '',
    `Saved: ${new Date().toISOString()}`,
    `Model: ${state.options.model}`,
    `Tools: ${formatToolsMode(state.options.toolsMode)}`,
    `Tool execution: ${state.options.executeTools ? 'on' : 'off'}`,
    `Billing mode: ${state.options.billingMode}`,
    '',
    '## Context Files',
    '',
    ...(state.context.docs.length > 0
      ? state.context.docs.map((doc) => `- ${doc.relativePath}`)
      : ['- none']),
    '',
    '## Transcript',
    ''
  ];

  for (const message of state.messages) {
    lines.push(`### ${message.role}`);
    lines.push('');
    lines.push(message.content || '');
    lines.push('');
  }

  fs.writeFileSync(target, `${lines.join('\n').trim()}\n`, 'utf8');
  console.log(`Saved transcript: ${target}`);
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function printConfig(state) {
  console.log();
  console.log('Config:');
  console.log(`  Model:            ${state.options.model}`);
  console.log(`  Tools:            ${formatToolsMode(state.options.toolsMode)}`);
  console.log(`  Tool execution:   ${state.options.executeTools ? 'on' : 'off'}`);
  console.log(`  Billing mode:     ${state.options.billingMode}`);
  console.log(`  Token type:       ${state.options.tokenType}`);
  console.log(`  Max tokens:       ${state.options.maxTokens}`);
  console.log(`  Temperature:      ${state.options.temperature}`);
  console.log(`  Top-p:            ${state.options.topP ?? '(default)'}`);
  console.log(`  Thinking:         ${state.options.think ? 'on' : 'off'}`);
  console.log(`  Workspace:        ${state.options.workspace}`);
  console.log(`  Context files:    ${state.context.docs.length}`);
  console.log(`  History messages: ${state.messages.length}/${state.options.maxHistoryMessages}`);
  console.log();
}

async function main() {
  const options = parseArgs();
  const state = {
    options,
    context: {
      sources: [],
      docs: [],
      warnings: [],
      totalIncludedChars: 0,
      budgetExhausted: false,
      loadedAt: new Date()
    },
    messages: [],
    turns: [],
    lastResponse: null
  };

  loadContext(state);
  printStartup(state);

  console.log('Preparing Sogni hosted creative agent API client...');
  const hostedClient = await createHostedClient(options);
  console.log(`Using hosted endpoint: ${hostedClient.restEndpoint}`);
  console.log();

  if (options.prompt) {
    await runTurn(hostedClient, state, options.prompt);
  } else {
    await runInteractive(hostedClient, state);
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  if (isStrictSubscriptionBillingError(error)) {
    console.error(
      'Subscription billing was rejected for this hosted creative-agent turn. ' +
        'Until the API-side hosted billing propagation fix is deployed, rerun with --billing-mode auto or --tokens; ' +
        'vendor-premium models also require Premium Spark billing.'
    );
  }
  process.exit(1);
});
