#!/usr/bin/env node

/**
 * Hosted Creative Tool Calling Example
 *
 * Calls the Sogni OpenAI-compatible /v1/chat/completions endpoint with
 * sogni_tools enabled. This uses API middleware in sogni-api, so it can inject
 * either the creative-tools family or the deeper creative-agent tool family.
 *
 * Examples:
 *   node workflow_creative_agent_tools.mjs "Create a 4-shot product video concept for a red sneaker"
 *   node workflow_creative_agent_tools.mjs "Make a 15s trailer for a new AI art app"
 *   node workflow_creative_agent_tools.mjs "Generate an orbit video prompt for a crystal perfume bottle" --tools creative-tools --no-execute
 *   node workflow_creative_agent_tools.mjs "Make a cinematic video plan for a cyberpunk skyline" --model qwen3.6-35b-a3b-gguf-iq4xs
 */

import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import { askQuestion } from './workflow-helpers.mjs';

const DEFAULT_LLM_MODEL = 'qwen3.6-35b-a3b-gguf-iq4xs';
const DEFAULT_REST_ENDPOINT = 'https://api.sogni.ai';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: '',
    model: DEFAULT_LLM_MODEL,
    tools: 'creative-tools',
    execute: true,
    tokenType: loadTokenTypePreference() || process.env.SOGNI_TOKEN_TYPE || 'spark',
    json: false
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--model' && args[i + 1]) {
      options.model = args[++i];
    } else if (arg === '--tools' && args[i + 1]) {
      options.tools = args[++i];
    } else if (arg === '--no-execute') {
      options.execute = false;
    } else if (arg === '--token-type' && args[i + 1]) {
      options.tokenType = args[++i];
    } else if (arg === '--json') {
      options.json = true;
    } else {
      positional.push(arg);
    }
  }

  options.prompt = positional.join(' ').trim();
  return options;
}

function showHelp() {
  console.log(`
Hosted Creative Tool Calling Example

Usage:
  node workflow_creative_agent_tools.mjs "prompt" [options]

Options:
  --model <id>          LLM model ID (default: ${DEFAULT_LLM_MODEL})
  --tools <mode>        creative-agent, creative-tools, rich, hosted, true, false, or none
                        creative-agent adds workflow/control tools
                        creative-tools/rich/hosted/true injects media/planning tools
  --no-execute          Inject tools but disable server-side Sogni tool execution
  --token-type <type>   spark or sogni (default: SOGNI_TOKEN_TYPE or spark)
  --json                Print the raw response

Requires SOGNI_API_KEY in examples/.env or the environment.
`);
}

function normalizeTools(value) {
  switch (String(value).trim().toLowerCase()) {
    case 'creative-agent':
      return 'creative-agent';
    case 'rich':
      return 'creative-tools';
    case 'creative-tools':
      return 'creative-tools';
    case 'hosted':
    case 'true':
      return true;
    case 'none':
    case 'false':
      return false;
    default:
      return value;
  }
}

function extractChoice(payload) {
  const data = payload?.data || payload;
  const choice = data?.choices?.[0];
  return choice?.message || choice?.delta || {};
}

function extractCreativeWorkflows(payload) {
  const data = payload?.data || payload;
  return data?.creative_workflows || data?.creativeWorkflows || [];
}

async function postChatCompletion(credentials, options) {
  const endpoint = process.env.SOGNI_REST_ENDPOINT || DEFAULT_REST_ENDPOINT;
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': credentials.apiKey
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: 'system',
          content:
            'You are a concise creative production assistant. Use Sogni creative tools when they help produce concrete media.'
        },
        {
          role: 'user',
          content: options.prompt
        }
      ],
      temperature: 0.4,
      max_tokens: 1600,
      token_type: options.tokenType,
      sogni_tools: normalizeTools(options.tools),
      sogni_tool_execution: options.execute
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || response.statusText;
    throw new Error(`${response.status} ${message}`);
  }
  return payload;
}

async function main() {
  const options = parseArgs();
  const credentials = await loadCredentials();
  if (!credentials.apiKey) {
    throw new Error('Creative-agent API tool injection requires SOGNI_API_KEY API-key auth.');
  }

  if (!options.prompt) {
    options.prompt = await askQuestion('What should the hosted Sogni tools make or plan? ');
  }
  if (!options.prompt) {
    throw new Error('Prompt is required.');
  }

  const payload = await postChatCompletion(credentials, options);
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const message = extractChoice(payload);
  if (message.content) {
    console.log(message.content);
  }

  const toolCalls = message.tool_calls || message.toolCalls || [];
  if (toolCalls.length > 0) {
    console.log('\nTool calls:');
    for (const call of toolCalls) {
      console.log(`  - ${call.function?.name || call.name || call.id || 'tool_call'}`);
    }
  }

  const workflows = extractCreativeWorkflows(payload);
  if (workflows.length > 0) {
    console.log('\nCreative workflows:');
    for (const workflow of workflows) {
      console.log(`  - ${workflow.workflowId || workflow.id}: ${workflow.status || 'submitted'}`);
    }
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
