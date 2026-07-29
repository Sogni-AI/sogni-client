#!/usr/bin/env node

/**
 * Direct Hosted Creative Tool Execution
 *
 * Calls POST /v1/creative-agent/tools/execute through the SDK wrapper
 * `sogni.chat.hosted.executeTool()`. Use this when your app already knows
 * which synchronous composition/planning tool to run and has exact JSON
 * arguments, so there is no need to spend an extra LLM round asking the model
 * to select the tool.
 *
 * Supported direct tools:
 *   enhance_prompt, compose_script, compose_lyrics, compose_instrumental,
 *   compose_workflow, compose_workflow_template
 *
 * Examples:
 *   node workflow_direct_creative_tool.mjs "A cinematic portrait of a glass robot"
 *   node workflow_direct_creative_tool.mjs --tool compose_script "Make this a 5s LTX video prompt"
 *   node workflow_direct_creative_tool.mjs --tool compose_workflow "Plan a 3-shot neon bakery teaser"
 *   node workflow_direct_creative_tool.mjs --tool compose_lyrics "A synth-pop song about rain"
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import { askQuestion } from './workflow-helpers.mjs';

const DIRECT_TOOLS = new Set([
  'enhance_prompt',
  'compose_script',
  'compose_lyrics',
  'compose_instrumental',
  'compose_workflow',
  'compose_workflow_template'
]);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: '',
    tool: 'enhance_prompt',
    tokenType: loadTokenTypePreference() || process.env.SOGNI_TOKEN_TYPE || 'spark',
    destinationTool: 'generate_image',
    destinationModel: '',
    name: 'Generated Workflow Template',
    json: false
  };

  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (arg === '--tool' && args[i + 1]) {
      options.tool = args[++i];
    } else if (arg === '--token-type' && args[i + 1]) {
      options.tokenType = args[++i];
    } else if (arg === '--destination-tool' && args[i + 1]) {
      options.destinationTool = args[++i];
    } else if (arg === '--destination-model' && args[i + 1]) {
      options.destinationModel = args[++i];
    } else if (arg === '--name' && args[i + 1]) {
      options.name = args[++i];
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
Direct Hosted Creative Tool Execution

Usage:
  node workflow_direct_creative_tool.mjs "prompt or brief" [options]

Options:
  --tool <name>               ${Array.from(DIRECT_TOOLS).join(', ')}
  --token-type <type>         spark, sogni, or auto (default: SOGNI_TOKEN_TYPE or spark)
  --destination-tool <tool>   Hint for enhance_prompt (default: generate_image)
  --destination-model <id>    Optional destination model hint for enhance_prompt/compose_script
  --name <name>               Template name for compose_workflow_template
  --json                      Print the raw response

Requires SOGNI_API_KEY in examples/.env or the environment.
`);
}

function directToolArguments(options) {
  switch (options.tool) {
    case 'enhance_prompt':
      return {
        prompt: options.prompt,
        destination_tool: options.destinationTool,
        ...(options.destinationModel ? { destination_model: options.destinationModel } : {})
      };
    case 'compose_script':
      return {
        brief: options.prompt,
        script_type:
          options.destinationTool === 'generate_video' ? 'video_prompt' : 'creative_brief',
        ...(options.destinationModel ? { destination_model: options.destinationModel } : {})
      };
    case 'compose_lyrics':
      return { prompt: options.prompt, language: 'unknown' };
    case 'compose_instrumental':
      return { prompt: options.prompt };
    case 'compose_workflow':
      return { brief: options.prompt };
    case 'compose_workflow_template':
      return { brief: options.prompt, name: options.name };
    default:
      throw new Error(`Unsupported direct tool: ${options.tool}`);
  }
}

function bestMessage(payload) {
  const data = payload?.data || {};
  const result = data.result || {};
  return (
    data.message ||
    result.message ||
    result.prompt ||
    result.script ||
    result.lyrics ||
    result.structure
  );
}

async function main() {
  const options = parseArgs();
  if (!DIRECT_TOOLS.has(options.tool)) {
    throw new Error(
      `Unsupported --tool "${options.tool}". Run with --help for the direct-tool list.`
    );
  }

  const credentials = await loadCredentials();
  if (!credentials.apiKey) {
    throw new Error('Direct hosted tool execution requires SOGNI_API_KEY API-key auth.');
  }

  if (!options.prompt) {
    options.prompt = await askQuestion('Prompt or brief: ');
  }
  if (!options.prompt) {
    throw new Error('Prompt or brief is required.');
  }

  const sogni = await SogniClient.createInstance({
    appId: `direct-creative-tool-${Date.now()}`,
    apiKey: credentials.apiKey,
    network: 'fast'
  });

  const response = await sogni.chat.hosted.executeTool({
    tool: options.tool,
    arguments: directToolArguments(options),
    tokenType: options.tokenType,
    appSource: 'sogni-client-example'
  });

  if (options.json) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  const message = bestMessage(response);
  if (message) {
    console.log(message);
  } else {
    console.log(JSON.stringify(response.data.result, null, 2));
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
