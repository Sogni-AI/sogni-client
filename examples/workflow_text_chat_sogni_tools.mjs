#!/usr/bin/env node
/**
 * Text Chat with Sogni Platform Tools
 *
 * Single-turn chat that generates images, videos, and music through natural
 * language. Uses LLM tool calling to detect media generation intent, then
 * routes through specialized composition pipelines (IMAGE_SYSTEM_PROMPT,
 * VIDEO_SYSTEM_PROMPT, AUDIO_SYSTEM_PROMPT) for prompt engineering before
 * generating media via the Sogni Projects API.
 *
 * Architecture: Hybrid Tool Calling + Composition Pipeline
 *   1. LLM receives user message with tool definitions (tool_choice: 'auto')
 *   2. If media requested → LLM emits tool call with raw user intent
 *   3. Script intercepts tool call → routes to compose*() pipeline
 *   4. Composition pipeline enhances prompt via specialized LLM call
 *   5. generateMedia() creates project, tracks progress, downloads result
 *   6. Tool result fed back to LLM for natural language summary
 *   If no tool call → normal conversation response
 *
 * Default Generation Models:
 *   Image: z_image_turbo_bf16
 *   Video: ltx23-22b-fp8_t2v_distilled (LTX-2.3)
 *   Audio: ace_step_1.5_turbo (ACE-Step 1.5)
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file
 * - LLM workers AND image/video/music workers must be online
 *
 * Usage:
 *   node workflow_text_chat_sogni_tools.mjs "Create an image of a cyberpunk city at night"
 *   node workflow_text_chat_sogni_tools.mjs "Compose a jazz song about the rain"
 *   node workflow_text_chat_sogni_tools.mjs "Generate a video of ocean waves at sunset"
 *   node workflow_text_chat_sogni_tools.mjs "What is the meaning of life?"
 *   node workflow_text_chat_sogni_tools.mjs "Tell me about ocean waves"  (conversation, no generation)
 *
 * Options:
 *   --model         LLM model ID (default: qwen3.5-35b-a3b-gguf-q4km)
 *   --max-tokens    Maximum tokens to generate (default: from model, or 8192)
 *   --temperature   Sampling temperature 0-2 (default: from model, or 0.7)
 *   --top-p         Top-p sampling 0-1 (default: from model, or 0.9)
 *   --top-k         Top-k sampling (default: from model, if available)
 *   --system        System prompt override
 *   --quantity, -n  Number of media to generate per request, 1-512 (default: 1)
 *   --duration      Video duration in seconds, 1-20 (default: 10)
 *   --aspect-ratio, --ar  Video aspect ratio: portrait, landscape, square, widescreen (default: portrait)
 *   --no-think      Disable model thinking/reasoning (enabled by default)
 *   --show-thinking  Show <think> blocks in output (hidden by default even when thinking is enabled)
 *   --help          Show this help message
 */

import { SogniClient, isSogniToolCall, parseToolCallArguments } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import { askQuestion, calculateVideoFrames, formatDuration, MODELS } from './workflow-helpers.mjs';
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const DEFAULT_LLM_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
const DEFAULT_IMAGE_MODEL = 'z_image_turbo_bf16';
const DEFAULT_VIDEO_MODEL = 'ltx23-22b-fp8_t2v_distilled';
const DEFAULT_AUDIO_MODEL = 'ace_step_1.5_turbo';
const OUTPUT_DIR = './output';

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    model: DEFAULT_LLM_MODEL,
    maxTokens: null,
    temperature: null,
    topP: null,
    topK: null,
    system: null,
    think: true,
    thinkExplicit: false,
    showThinking: false,
    quantity: 1,
    duration: null,
    aspect_ratio: null,
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
    } else if (arg === '--top-k' && args[i + 1]) {
      options.topK = parseInt(args[++i], 10);
    } else if (arg === '--system' && args[i + 1]) {
      options.system = args[++i];
    } else if (arg === '--no-think') {
      options.think = false;
      options.thinkExplicit = true;
    } else if (arg === '--show-thinking') {
      options.showThinking = true;
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = Math.max(1, Math.min(20, parseFloat(args[++i]) || 10));
    } else if ((arg === '--quantity' || arg === '-n') && args[i + 1]) {
      options.quantity = Math.max(1, Math.min(512, parseInt(args[++i], 10) || 1));
    } else if ((arg === '--aspect-ratio' || arg === '--ar') && args[i + 1]) {
      const ar = args[++i].toLowerCase().replace(/[:\s]/g, '_');
      // Accept common aliases: 16:9, 9:16, 4:3, 3:4, vertical, horizontal, cinematic
      const AR_ALIASES = { 'vertical': 'portrait', '9_16': 'portrait', 'tall': 'portrait',
        'horizontal': 'landscape', '16_9': 'landscape', 'cinematic': 'widescreen', 'wide': 'widescreen',
        '4_3': 'landscape_4_3', '3_4': 'portrait_4_3', '1_1': 'square' };
      options.aspect_ratio = AR_ALIASES[ar] || ar;
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
  node workflow_text_chat_sogni_tools.mjs "Create an image of a cyberpunk city at night"
  node workflow_text_chat_sogni_tools.mjs "Compose a jazz song about the rain"
  node workflow_text_chat_sogni_tools.mjs "Generate a video of ocean waves at sunset"

Options:
  --model         LLM model ID (default: ${DEFAULT_LLM_MODEL})
  --max-tokens    Maximum tokens to generate (default: from model, or 8192)
  --temperature   Sampling temperature 0-2 (default: from model, or 0.7)
  --top-p         Top-p sampling 0-1 (default: from model, or 0.9)
  --top-k         Top-k sampling (default: from model, if available)
  --system        System prompt override
  --quantity, -n  Number of media to generate per request, 1-512 (default: 1)
  --duration      Video duration in seconds, 1-20 (default: 10)
  --aspect-ratio, --ar  Video aspect ratio: portrait, landscape, square, widescreen,
                  portrait_4_3, landscape_4_3, or shortcuts like 16:9, 9:16, 4:3 (default: portrait)
  --no-think      Disable model thinking/reasoning (enabled by default)
  --show-thinking  Show <think> blocks in output (hidden by default)
  --help          Show this help message

Default Generation Models:
  Image: ${DEFAULT_IMAGE_MODEL}
  Video: ${DEFAULT_VIDEO_MODEL} (LTX-2.3)
  Audio: ${DEFAULT_AUDIO_MODEL} (ACE-Step 1.5)
`);
}

// ============================================================
// Hybrid tool definitions (intent detection via LLM tool calling)
// ============================================================

// Simplified tool definitions that tell the LLM to pass raw user intent.
// The composition pipeline (composeVideo, composeImage, composeSong) handles
// all prompt engineering — these tools just capture what the user asked for.
const HYBRID_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'sogni_generate_image',
      description: 'Generate an image. Call this when the user wants to create, draw, or make an image or picture.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "The user's image request in their own words. Pass through what they asked for — do NOT add style, lighting, or composition details." },
          quantity: { type: 'number', description: 'Number of images/variations to generate (1-512). Only set if the user explicitly asks for multiple images or variations.' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sogni_generate_video',
      description: 'Generate a short video. Call this when the user wants to create, make, or generate a video, clip, or animation.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "The user's video request in their own words. Pass through what they asked for — do NOT add camera, lighting, or scene details." },
          duration: { type: 'number', description: 'Video duration in seconds (1-20). Only set if the user specifies a duration.' },
          quantity: { type: 'number', description: 'Number of videos/variations to generate (1-512). Only set if the user explicitly asks for multiple videos or variations.' },
          aspect_ratio: { type: 'string', enum: ['portrait', 'landscape', 'square', 'portrait_4_3', 'landscape_4_3', 'widescreen'], description: "Video aspect ratio. Only set if the user specifies a size, orientation, or aspect ratio (e.g. 'vertical', 'portrait', 'widescreen', '16:9 landscape', 'square'). Map vertical/tall to portrait, horizontal/wide/cinematic to landscape or widescreen." },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sogni_generate_music',
      description: 'Generate a music track or song. Call this when the user wants to create, compose, or make music, a song, a beat, or audio.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: "The user's music request in their own words. Pass through what they asked for — do NOT add instrument, tempo, or production details." },
          duration: { type: 'number', description: 'Song duration in seconds (10-600). Only set if the user specifies a duration.' },
          quantity: { type: 'number', description: 'Number of tracks/variations to generate (1-512). Only set if the user explicitly asks for multiple tracks or variations.' },
        },
        required: ['prompt'],
      },
    },
  },
];

function toolNameToMediaType(name) {
  if (name === 'sogni_generate_image') return 'image';
  if (name === 'sogni_generate_video') return 'video';
  if (name === 'sogni_generate_music') return 'audio';
  return null;
}

// ============================================================
// Strip LLM thinking tags before parsing (display is preserved via streaming)
// ============================================================

function stripThinkingTags(content) {
  // Strip complete <think>...</think> blocks
  content = content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
  // Strip unclosed <think> blocks (model hit token limit mid-thinking)
  content = content.replace(/<think>[\s\S]*$/gi, '');
  return content.trim();
}

/**
 * Create a streaming writer that filters <think>...</think> blocks from display.
 * Returns { write(text), flush() } — call write() for each chunk, flush() when done.
 * The raw text (including thinking) is always accumulated regardless of showThinking.
 */
function createThinkingFilter(showThinking) {
  let insideThink = false;
  let buffer = '';

  return {
    write(text) {
      if (showThinking) {
        process.stdout.write(text);
        return;
      }

      buffer += text;

      while (buffer.length > 0) {
        if (insideThink) {
          const endIdx = buffer.indexOf('</think>');
          if (endIdx === -1) {
            // Still inside thinking, consume entire buffer
            buffer = '';
            break;
          }
          // Skip past closing tag
          buffer = buffer.slice(endIdx + 8);
          insideThink = false;
        } else {
          const startIdx = buffer.indexOf('<think>');
          if (startIdx === -1) {
            // No think tag — check if buffer ends with a partial '<think>' match
            // Keep up to 6 chars (length of '<think' minus 1) as potential partial
            const safeLen = Math.max(0, buffer.length - 6);
            if (safeLen > 0) {
              process.stdout.write(buffer.slice(0, safeLen));
              buffer = buffer.slice(safeLen);
            }
            break;
          }
          // Output everything before the tag
          if (startIdx > 0) {
            process.stdout.write(buffer.slice(0, startIdx));
          }
          buffer = buffer.slice(startIdx + 7);
          insideThink = true;
        }
      }
    },

    flush() {
      if (!showThinking && buffer.length > 0) {
        process.stdout.write(buffer);
        buffer = '';
      }
    },
  };
}

// ============================================================
// Stream an LLM composition call.
//
// Thinking is always disabled for composition calls. The detailed
// system prompts (9-step structure, examples, constraints) already
// serve as the chain-of-thought — adding model thinking on top
// deterministically overruns the token budget with these prompts.
// ============================================================

async function streamComposition(sogni, messages, options, tokenType, tools) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stateHandler = (event) => {
      if (event.type === 'pending') console.log(`  Composing: Status: pending authorization`);
      else if (event.type === 'queued') console.log(`  Composing: Status: queued`);
      else if (event.type === 'assigned' && event.workerName) console.log(`  Composing: Worker: ${event.workerName} (assigned)`);
      else if (event.type === 'jobStarted' && event.workerName) console.log(`  Composing: Worker: ${event.workerName} (started)`);
    };
    sogni.chat.on('jobState', stateHandler);

    try {
      // Composition uses tool calling so that structured output is captured
      // via tool_calls (which are always forwarded) rather than content
      // (which thinking-mode LLM servers route to reasoning_content,
      // making it invisible to the SDK).
      const stream = await sogni.chat.completions.create({
        model: options.model,
        messages,
        max_tokens: options.maxTokens || 8192,
        temperature: 0.7,
        top_p: options.topP,
        stream: true,
        tokenType,
        think: false,
        tools,
        tool_choice: 'required',
      });

      for await (const chunk of stream) {
        // drain the stream (content may be empty for thinking-mode LLMs)
      }

      if (stream.toolCalls.length > 0) {
        return stream.toolCalls[0].function.arguments;
      }

      throw new Error('LLM did not return a tool call');
    } catch (err) {
      lastError = err;
      sogni.chat.off('jobState', stateHandler);
      if (attempt < maxAttempts && err.message && err.message.includes('timed out')) {
        console.log(`  (Attempt ${attempt}/${maxAttempts} timed out, retrying...)`);
        continue;
      }
      throw err;
    } finally {
      sogni.chat.off('jobState', stateHandler);
    }
  }

  throw lastError;
}

// ============================================================
// Duration-aware pacing hints for video prompts
// (Ported from sogni-web AI Screenwriter)
// ============================================================

function computePacingHint(duration) {
  const actionCount = Math.max(1, Math.min(10, Math.round(duration / 4)));

  if (actionCount === 1) {
    return (
      `This clip is ${duration} seconds long. ` +
      `Write EXACTLY 1 action. One single moment. ` +
      `Do not describe anything before or after it. No setup, no resolution. ` +
      `HARD STOP after the 1st action. Do not continue.`
    );
  }

  const ordinals = { 2: '2nd', 3: '3rd' };
  const ordinal = ordinals[actionCount] || `${actionCount}th`;

  return (
    `This clip is ${duration} seconds long. ` +
    `Write EXACTLY ${actionCount} distinct actions — NO MORE THAN ${actionCount}. ` +
    `Each action takes roughly ${Math.round(duration / actionCount)} seconds of screen time. ` +
    `Do not add setup, backstory, or resolution beyond these ${actionCount} actions. ` +
    `HARD STOP after the ${ordinal} action is complete. ` +
    `Do not write a ${ordinals[actionCount + 1] || `${actionCount + 1}th`} action under any circumstances.`
  );
}

// ============================================================
// Open file with system default viewer
// ============================================================

function openFile(filepath) {
  const absPath = resolve(filepath);
  const os = platform();
  let cmd, args;

  if (os === 'darwin') {
    cmd = 'open';
    args = [absPath];
  } else if (os === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '', absPath];
  } else {
    cmd = 'xdg-open';
    args = [absPath];
  }

  execFile(cmd, args, (err) => {
    if (err) console.log(`  (Could not open file: ${err.message})`);
  });
}

// ============================================================
// Media-specific LLM System Prompts
// ============================================================

const AUDIO_SYSTEM_PROMPT = `You are an expert music producer. Craft a song specification using the compose_song tool.

positivePrompt — Write a dense paragraph like a producer's brief covering: genre/subgenre, each instrument with ROLE+TEXTURE+BEHAVIOR, vocal character (gender, quality, delivery, processing), arrangement arc (open→build→peak→conclude), production aesthetic (polished, raw, gritty, airy). Do NOT include BPM or key in this field — use tempo feel words instead ("driving", "languid").

GOOD: "A driving post-punk arrangement with layered electric guitars--one clean arpeggiated, the other distorted chordal--over solid bassline and powerful drums. Male vocal delivered with angsty strained quality building into anthemic shouted chorus. Guitar solo with feedback and bends, then breakdown to core rhythmic elements."
BAD: "Funk, Soul, Groove, Male Vocals" (tag list — write flowing sentences)

lyrics — Use enriched section headers: [Intro - Arpeggiated Guitar], [Verse 1 - Slap Bass with soft male vocal], [Chorus - Horn Section staccato]. Write story/emotion with dynamic contrast. Empty string for instrumentals. Use \\n for newlines.

bpm — Ballad 60-80, R&B/Hip-hop 80-100, Pop/Funk 100-130, Rock/EDM 120-140, DnB 170-180.
keyscale — Minor for dark/intense, Major for bright/upbeat.
duration — Default 30s unless user specifies otherwise.`;

const CAMERA_MOVEMENTS = [
  'static tripod', 'slow push-in', 'slow pull-back',
  'smooth pan left', 'smooth pan right', 'slow tilt up', 'slow tilt down',
  'slow arc left', 'slow arc right', 'tracking follow', 'handheld subtle drift',
];

const VIDEO_SYSTEM_PROMPT = `You are an expert cinematographer writing prompts for the LTX-2.3 AI video model. Write a cohesive mini-scene in present tense. Use the compose_video tool to return your result.

FORMAT — The prompt MUST be ONE SINGLE PARAGRAPH with NO linebreaks. All sentences flow continuously with no blank lines, no numbered lists, no section headers. The video model parses a flat block of text; linebreaks degrade output quality.

PROMPT CONSTRUCTION — 4-8 flowing present-tense sentences. One continuous shot (no cuts, no montage):

1. ESTABLISH: Shot scale + genre/visual language. Close-ups need physical detail, wide shots need environmental detail.
2. SCENE: Environment, time of day, atmosphere, surface textures. Name light sources: "warm tungsten practicals", "golden hour sun through dusty windows".
3. CHARACTER(S): Age, hair, clothing, notable features. Keep identity stable throughout.
4. ACTION SEQUENCE: One main thread evolving start to end. Temporal connectors ("as", "then", "while"). Physically filmable behavior.
5. DIALOGUE: Weave ALL spoken words into the prose as attributed inline speech — always clarify WHO is speaking, HOW they deliver it, and WHAT they are doing while speaking. Example: 'The woman turns toward him and says "We should leave now," her voice low and urgent as she grips his sleeve, then the man nods and replies "Give me one more minute," exhaling steadily while his fingers work the lock.' NEVER use script formatting, character name headers, parentheticals like (V.O.), [DIALOGUE: ...] tags, or any structural markup. Every line of dialogue must read like a sentence in a novel with the speaker identified by description or action.
6. AMBIENT SOUND: Weave 1-2 sounds naturally into prose per beat. Example: "rain tapping softly against the awning as a distant car horn echoes." NEVER use [AMBIENT: ...] tags.
7. EMOTIONAL CUES: Jaw tension, grip pressure, breathing pace, posture — express emotion through visible physical behavior.

CONSTRAINTS: Present tense only. Positive phrasing (describe what IS, not what isn't). No on-screen text/logos. No vague words ("beautiful", "nice"). Dense flowing prose, not bullet lists. Output the prompt as ONE UNBROKEN PARAGRAPH — no newlines within the prompt string.

REFERENCE PROMPT (study the style — notice it is one continuous paragraph):
"A medium close-up cinematic shot in a quiet rain-soaked alley at night, neon reflections shimmering across wet pavement. A man in his 30s with short dark hair and a worn leather jacket stands under a flickering sign, water beading on his collar. He exhales slowly, shoulders tightening as his fingers clamp around a small metal lighter, then steadies his hand and clicks it once, watching the flame struggle against the damp air, rain tapping softly against the awning while a distant car horn echoes. The camera performs a slow push-in toward his face as his jaw sets, tendons rising, weight shifting forward by half a step, breathing measured. Smooth and stabilised with cinematic motion consistency."`;

const IMAGE_SYSTEM_PROMPT = `You are a prompt engineer for a text-to-image model. Write flowing prose, never tag lists. All phrasing positive. Use the compose_image tool to return your result.

PROMPT CONSTRUCTION — 80-180 words of natural language sentences:

1. SUBJECT (front-load): Identity, distinctive traits, clothing/materials, action/state. Be concrete.
2. ENVIRONMENT: Location, time of day, atmosphere, background elements.
3. COMPOSITION: Shot type, focal priority, depth of field, composition rule.
4. LIGHTING (name it): "soft afternoon window light", "golden hour backlight", "Rembrandt lighting with delicate shadows".
5. CAMERA/LENS (optional): "Canon 5D 85mm f/1.8", "Kodak Portra 400 film grain look".
6. STYLE ANCHORS (max 2): "editorial raw portrait", "Spider-Verse animation style".
7. QUALITY: "crisp details", "natural skin texture", "sharp focus".

image_size guide: square_hd for centered/products, portrait_4_3 for people, portrait_16_9 for full-body/tall, landscape_4_3 for scenes/groups, landscape_16_9 for panoramic/cinematic.

REFERENCE PROMPT: "A 65-year-old Asian woman with silver hair sits in a cozy library, wearing a hand-knitted cardigan and reading glasses, holding an open book. Warm shelves and blurred book spines fill the background as dust motes drift. Tight portrait framing with shallow depth of field, rule of thirds. Soft afternoon window light, Canon 5D 85mm f/1.8, Kodak Portra 400 grain, crisp details and natural skin texture."`;

// ============================================================
// Composition tools — structured output via tool calling.
//
// Tool call arguments are always forwarded by the LLM worker
// regardless of thinking mode (unlike content, which may be
// routed to reasoning_content and lost). This makes tool calling
// the reliable way to get structured JSON from composition LLMs.
// ============================================================

const VIDEO_COMPOSITION_TOOL = {
  type: 'function',
  function: {
    name: 'compose_video',
    description: 'Output the composed video generation specification',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'One unbroken paragraph of 4-8 present-tense sentences describing a single continuous camera shot. No linebreaks. Dialogue must be attributed inline with speaker identity and delivery woven into the prose.' },
        camera_movement: {
          type: 'string',
          enum: ['static tripod', 'slow push-in', 'slow pull-back', 'smooth pan left', 'smooth pan right',
                 'slow tilt up', 'slow tilt down', 'slow arc left', 'slow arc right', 'tracking follow', 'handheld subtle drift'],
        },
        shot_scale: { type: 'string', enum: ['wide', 'medium', 'close-up'] },
        style_anchor: { type: 'string', description: '0-2 short style phrases' },
        stability_anchor: { type: 'string', description: 'e.g. smooth and stabilised, tripod-locked' },
      },
      required: ['prompt', 'camera_movement', 'shot_scale'],
    },
  },
};

const IMAGE_COMPOSITION_TOOL = {
  type: 'function',
  function: {
    name: 'compose_image',
    description: 'Output the composed image generation specification',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '80-180 words of flowing prose describing the image' },
        image_size: {
          type: 'string',
          enum: ['square_hd', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'],
        },
      },
      required: ['prompt', 'image_size'],
    },
  },
};

const AUDIO_COMPOSITION_TOOL = {
  type: 'function',
  function: {
    name: 'compose_song',
    description: 'Output the composed music generation specification',
    parameters: {
      type: 'object',
      properties: {
        positivePrompt: { type: 'string', description: 'Dense paragraph describing the sound' },
        lyrics: { type: 'string', description: 'Song lyrics with section headers, or empty string for instrumentals' },
        bpm: { type: 'number', description: 'Beats per minute (60-300)' },
        keyscale: { type: 'string', description: 'Key and scale, e.g. D minor' },
        timesignature: { type: 'string', enum: ['2', '3', '4', '6'] },
        duration: { type: 'number', description: 'Duration in seconds (10-600)' },
        language: { type: 'string', description: 'ISO language code' },
      },
      required: ['positivePrompt', 'lyrics', 'bpm', 'keyscale', 'timesignature', 'duration', 'language'],
    },
  },
};

// ============================================================
// LLM cost estimate + confirmation
// ============================================================

async function estimateLLMAndConfirm(sogni, messages, options, tokenType, label) {
  try {
    const estimate = await sogni.chat.estimateCost({
      model: options.model,
      messages,
      max_tokens: options.maxTokens || 8192,
      tokenType,
    });

    const tokenLabel = tokenType === 'spark' ? 'SPARK' : 'SOGNI';
    console.log();
    console.log(`  LLM Cost Estimate (${label}):`);
    console.log(`    ${tokenLabel}: ${estimate.costInToken.toFixed(6)}`);
    console.log(`    USD:   $${estimate.costInUSD.toFixed(6)}`);
    console.log();

    const proceed = await askQuestion('  Proceed with LLM prompt composition? [Y/n]: ');
    if (proceed && (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no')) {
      console.log('  Cancelled');
      return false;
    }
    return true;
  } catch (e) {
    console.log(`  (Could not estimate LLM cost: ${e.message})`);
    return true;
  }
}

// ============================================================
// LLM: Compose a video specification for LTX-2.3
// ============================================================

function parseVideoJSON(raw, fallbackPrompt) {
  const attempts = [
    () => JSON.parse(raw.trim()),
    () => {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      return m ? JSON.parse(m[1].trim()) : null;
    },
    () => {
      const m = raw.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    },
  ];

  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (parsed && parsed.prompt) {
        // Collapse any linebreaks into a single flowing paragraph
        const cleanPrompt = String(parsed.prompt).replace(/\s*[\r\n]+\s*/g, ' ').trim();
        return {
          prompt: cleanPrompt,
          camera_movement: CAMERA_MOVEMENTS.includes(parsed.camera_movement) ? parsed.camera_movement : 'slow push-in',
          shot_scale: ['wide', 'medium', 'close-up'].includes(parsed.shot_scale) ? parsed.shot_scale : 'medium',
          style_anchor: String(parsed.style_anchor || ''),
          stability_anchor: String(parsed.stability_anchor || 'smooth and stabilised'),
        };
      }
    } catch {
      // try next parsing strategy
    }
  }

  const preview = raw.substring(0, 200).replace(/\n/g, '\\n');
  console.log(`  (Could not parse video JSON from LLM — raw ${raw.length} chars: ${preview}${raw.length > 200 ? '...' : ''})`);
  return {
    prompt: fallbackPrompt,
    camera_movement: 'slow push-in',
    shot_scale: 'medium',
    style_anchor: '',
    stability_anchor: 'smooth and stabilised',
  };
}

async function composeVideo(sogni, userMessage, options, tokenType, duration = 10) {
  const pacingHint = computePacingHint(duration);
  const userContent = `${userMessage}\n\n${pacingHint}`;
  const messages = [
    { role: 'system', content: VIDEO_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const confirmed = await estimateLLMAndConfirm(sogni, messages, options, tokenType, 'video prompt');
  if (!confirmed) return null;

  console.log('\n  Composing video prompt via LLM...');

  try {
    const raw = await streamComposition(sogni, messages, options, tokenType, [VIDEO_COMPOSITION_TOOL]);
    const videoParams = parseVideoJSON(raw, userMessage);

    console.log(`  Camera:   ${videoParams.camera_movement}`);
    console.log(`  Scale:    ${videoParams.shot_scale}`);
    if (videoParams.style_anchor) console.log(`  Style:    ${videoParams.style_anchor}`);
    console.log(`  Prompt:   ${videoParams.prompt}`);

    return videoParams;
  } catch (err) {
    console.log(`  (Video prompt composition failed: ${err.message})`);
    return null;
  }
}

// ============================================================
// LLM: Compose an image specification for Z-Image Turbo
// ============================================================

const IMAGE_SIZES = {
  'square_hd': { width: 1080, height: 1080 },
  'square': { width: 1080, height: 1080 },
  'portrait_4_3': { width: 1080, height: 1440 },
  'portrait_16_9': { width: 1080, height: 1920 },
  'landscape_4_3': { width: 1440, height: 1080 },
  'landscape_16_9': { width: 1920, height: 1080 },
};

// Video aspect ratio presets — all dimensions are multiples of 64 (LTX dimensionStep)
const VIDEO_ASPECT_RATIOS = {
  'portrait':      { width: 1088, height: 1920 },  // 9:16 vertical
  'landscape':     { width: 1920, height: 1088 },  // 16:9 horizontal
  'widescreen':    { width: 1920, height: 1088 },  // 16:9 alias
  'square':        { width: 1088, height: 1088 },  // 1:1
  'portrait_4_3':  { width: 832,  height: 1088 },  // ~3:4 vertical
  'landscape_4_3': { width: 1088, height: 832  },  // ~4:3 horizontal
};

function parseImageJSON(raw, fallbackPrompt) {
  const attempts = [
    () => JSON.parse(raw.trim()),
    () => {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      return m ? JSON.parse(m[1].trim()) : null;
    },
    () => {
      const m = raw.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    },
  ];

  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (parsed && parsed.prompt) {
        return {
          prompt: String(parsed.prompt),
          image_size: IMAGE_SIZES[parsed.image_size] ? parsed.image_size : 'portrait_16_9',
        };
      }
    } catch {
      // try next parsing strategy
    }
  }

  const preview = raw.substring(0, 200).replace(/\n/g, '\\n');
  console.log(`  (Could not parse image JSON from LLM — raw ${raw.length} chars: ${preview}${raw.length > 200 ? '...' : ''})`);
  return {
    prompt: fallbackPrompt,
    image_size: 'portrait_16_9',
  };
}

async function composeImage(sogni, userMessage, options, tokenType) {
  const messages = [
    { role: 'system', content: IMAGE_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const confirmed = await estimateLLMAndConfirm(sogni, messages, options, tokenType, 'image prompt');
  if (!confirmed) return null;

  console.log('\n  Composing image prompt via LLM...');

  try {
    const raw = await streamComposition(sogni, messages, options, tokenType, [IMAGE_COMPOSITION_TOOL]);
    const imageParams = parseImageJSON(raw, userMessage);
    const size = IMAGE_SIZES[imageParams.image_size];

    console.log(`  Size:   ${imageParams.image_size} (${size.width}x${size.height})`);
    console.log(`  Prompt: ${imageParams.prompt}`);

    return imageParams;
  } catch (err) {
    console.log(`  (Image prompt composition failed: ${err.message})`);
    return null;
  }
}

// ============================================================
// LLM: Compose a complete song specification for ACE-Step 1.5
// ============================================================

function normalizeKeyscale(keyscale) {
  // Server expects "C major", "A# minor", etc. — note uppercase, scale lowercase.
  // LLMs may return "C Major", "c major", "C MAJOR", etc.
  const parts = keyscale.trim().split(/\s+/);
  if (parts.length >= 2) {
    const note = parts.slice(0, -1).join(' ');
    const scale = parts[parts.length - 1].toLowerCase();
    return `${note} ${scale}`;
  }
  return keyscale;
}

function parseSongJSON(raw, fallbackPrompt) {
  const attempts = [
    // Direct parse
    () => JSON.parse(raw.trim()),
    // Extract from markdown code fences
    () => {
      const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      return m ? JSON.parse(m[1].trim()) : null;
    },
    // Find first JSON object in text
    () => {
      const m = raw.match(/\{[\s\S]*\}/);
      return m ? JSON.parse(m[0]) : null;
    },
  ];

  for (const attempt of attempts) {
    try {
      const parsed = attempt();
      if (parsed && parsed.positivePrompt) {
        return {
          positivePrompt: String(parsed.positivePrompt),
          lyrics: String(parsed.lyrics || ''),
          bpm: Math.max(30, Math.min(300, parseInt(parsed.bpm) || 120)),
          keyscale: normalizeKeyscale(String(parsed.keyscale || 'C major')),
          timesignature: String(parsed.timesignature || '4'),
          duration: Math.max(10, Math.min(600, parseInt(parsed.duration) || 30)),
          language: String(parsed.language || 'en'),
        };
      }
    } catch {
      // try next parsing strategy
    }
  }

  // Fallback: use raw text as prompt with defaults
  const preview = raw.substring(0, 200).replace(/\n/g, '\\n');
  console.log(`  (Could not parse song JSON from LLM — raw ${raw.length} chars: ${preview}${raw.length > 200 ? '...' : ''})`);
  return {
    positivePrompt: fallbackPrompt,
    lyrics: '',
    bpm: 120,
    keyscale: 'C major',
    timesignature: '4',
    duration: 30,
    language: 'en',
  };
}

async function composeSong(sogni, userMessage, options, tokenType) {
  const messages = [
    { role: 'system', content: AUDIO_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ];

  const confirmed = await estimateLLMAndConfirm(sogni, messages, options, tokenType, 'song composition');
  if (!confirmed) return null;

  console.log('\n  Composing song via LLM...');

  try {
    const raw = await streamComposition(sogni, messages, options, tokenType, [AUDIO_COMPOSITION_TOOL]);
    const songParams = parseSongJSON(raw, userMessage);

    const tsLabels = { '2': '2/4', '3': '3/4', '4': '4/4', '6': '6/8' };
    console.log();
    console.log('  Song Composition:');
    console.log(`  Style:     ${songParams.positivePrompt}`);
    console.log(`  BPM:       ${songParams.bpm}`);
    console.log(`  Key:       ${songParams.keyscale}`);
    console.log(`  Time:      ${tsLabels[songParams.timesignature] || songParams.timesignature}`);
    console.log(`  Duration:  ${songParams.duration}s`);
    console.log(`  Language:  ${songParams.language}`);
    if (songParams.lyrics) {
      const lineCount = songParams.lyrics.split('\n').filter(l => l.trim()).length;
      console.log(`  Lyrics:    ${lineCount} lines`);
      console.log();
      for (const line of songParams.lyrics.split('\n')) {
        console.log(`    ${line}`);
      }
    }

    return songParams;
  } catch (err) {
    console.log(`  (Song composition failed: ${err.message})`);
    return null;
  }
}

// ============================================================
// Cost Estimation
// ============================================================

function getEstimateBaseUrl() {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) baseUrl = baseUrl.replace('wss://', 'https://');
  else if (baseUrl.startsWith('ws://')) baseUrl = baseUrl.replace('ws://', 'http://');
  return baseUrl;
}

async function getImageJobEstimate(tokenType, modelId, steps, guidance = 0, width = 1024, height = 1024, imageCount = 1, previewCount = 0, sampler = 'euler') {
  const url = `${getEstimateBaseUrl()}/api/v3/job/estimate/${tokenType}/fast/${encodeURIComponent(modelId)}/${imageCount}/${steps}/${previewCount}/false/1.0/${width}/${height}/${guidance}/${sampler}/0`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  return response.json();
}

async function getVideoJobEstimate(tokenType, modelId, width, height, frames, fps, steps, videoCount = 1) {
  const url = `${getEstimateBaseUrl()}/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}/${videoCount}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  return response.json();
}

async function getAudioJobEstimate(tokenType, modelId, duration, steps, audioCount = 1) {
  const url = `${getEstimateBaseUrl()}/api/v1/job-audio/estimate/${tokenType}/${encodeURIComponent(modelId)}/${duration}/${steps}/${audioCount}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  return response.json();
}

async function displayEstimateAndConfirm(estimate, tokenType) {
  console.log();
  console.log('  Cost Estimate:');

  if (tokenType === 'spark') {
    const cost = parseFloat(estimate.quote.project.costInSpark || 0);
    console.log(`    Spark: ${cost.toFixed(2)}`);
    console.log(`    USD:   $${(cost * 0.005).toFixed(4)}`);
  } else {
    const cost = parseFloat(estimate.quote.project.costInSogni || 0);
    console.log(`    Sogni: ${cost.toFixed(2)}`);
    console.log(`    USD:   $${(cost * 0.05).toFixed(4)}`);
  }

  console.log();
  const proceed = await askQuestion('  Proceed with generation? [Y/n]: ');
  if (proceed && (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no')) {
    console.log('  Generation cancelled');
    return false;
  }
  return true;
}

// ============================================================
// Generate media via Sogni Projects API
// ============================================================

// ============================================================
// Per-job progress tracking with incremental download/open
// ============================================================

function trackJobsAndDownload(project, quantity, mediaType, sogni) {
  const ext = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : null;
  const files = [];
  const pendingDownloads = []; // track in-flight downloads
  const jobLines = new Map(); // jobId -> { index, pct, status, workerName, startTime, lastStep, lastStepCount, lastETA, lastETAUpdate }
  let nextLineIndex = 0;
  let linesWritten = 0;
  let countdownInterval = null;

  function redrawProgress() {
    // Move cursor up to overwrite previous lines
    if (linesWritten > 0) {
      process.stdout.write(`\x1B[${linesWritten}A`);
    }
    linesWritten = 0;
    for (const [, info] of jobLines) {
      const bar = renderBar(info.pct);
      const label = quantity > 1 ? `  Job ${info.index}/${quantity}: ` : '  Progress: ';
      let statusStr;
      if (info.status === 'done') {
        statusStr = 'done';
      } else if (info.status === 'failed') {
        statusStr = 'FAILED';
      } else {
        // Build status with step info, ETA, and elapsed
        const parts = [];
        if (info.lastStep !== undefined && info.lastStepCount !== undefined) {
          parts.push(`Step ${info.lastStep}/${info.lastStepCount} (${info.pct}%)`);
        } else {
          parts.push(`${info.pct}%`);
        }
        if (info.lastETA !== undefined && info.lastETAUpdate) {
          const elapsedSinceUpdate = (Date.now() - info.lastETAUpdate) / 1000;
          const adjustedETA = Math.max(1, info.lastETA - elapsedSinceUpdate);
          parts.push(`ETA: ${formatDuration(adjustedETA)}`);
        }
        const elapsed = (Date.now() - info.startTime) / 1000;
        parts.push(`${formatDuration(elapsed)} elapsed`);
        statusStr = parts.join(' ');
      }
      const worker = info.workerName ? ` [${info.workerName}]` : '';
      process.stdout.write(`\x1B[K${label}${bar} ${statusStr}${worker}\n`);
      linesWritten++;
    }
  }

  function renderBar(pct) {
    const width = 20;
    const filled = Math.round((pct / 100) * width);
    return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
  }

  async function downloadAndOpen(resultUrl) {
    const fileExt = ext || resultUrl.match(/\.(png|jpg|jpeg|webp)/i)?.[1] || 'jpg';
    const filename = `${OUTPUT_DIR}/sogni_${mediaType}_${Date.now()}_${files.length + 1}.${fileExt}`;
    try {
      const response = await fetch(resultUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filename, buffer);
      console.log(`  Saved: ${filename}`);
      files.push({ url: resultUrl, localPath: filename });
      openFile(filename);
    } catch (e) {
      console.log(`  URL: ${resultUrl}`);
      console.log(`  (Could not save locally: ${e.message})`);
      files.push({ url: resultUrl, localPath: null });
    }
  }

  return new Promise((resolve, reject) => {
    project.on('jobStarted', (job) => {
      const index = nextLineIndex + 1;
      nextLineIndex++;
      jobLines.set(job.id, {
        index, pct: 0, status: 'running', workerName: job.workerName || '',
        startTime: Date.now(), lastStep: undefined, lastStepCount: undefined,
        lastETA: undefined, lastETAUpdate: null,
      });
      // Start countdown interval on first job to keep ETA ticking
      if (!countdownInterval) {
        countdownInterval = setInterval(redrawProgress, 1000);
      }
      redrawProgress();

      job.on('updated', (keys) => {
        const info = jobLines.get(job.id);
        if (!info) return;
        if (keys.includes('workerName') && job.workerName) {
          info.workerName = job.workerName;
        }
      });

      job.on('progress', (pct) => {
        const info = jobLines.get(job.id);
        if (info) {
          info.pct = pct;
          if (job.workerName) info.workerName = job.workerName;
          redrawProgress();
        }
      });

      job.on('completed', (resultUrl) => {
        const info = jobLines.get(job.id);
        if (info) {
          info.pct = 100;
          info.status = 'done';
          redrawProgress();
        }
        if (resultUrl) {
          pendingDownloads.push(downloadAndOpen(resultUrl));
        }
      });

      job.on('failed', () => {
        const info = jobLines.get(job.id);
        if (info) {
          info.status = 'failed';
          redrawProgress();
        }
      });
    });

    // Listen for job-level events (jobETA and step progress)
    const jobEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      const info = jobLines.get(event.jobId);
      if (!info) return;

      switch (event.type) {
        case 'jobETA':
          info.lastETA = event.etaSeconds;
          info.lastETAUpdate = Date.now();
          break;
        case 'progress':
          if (event.step !== undefined && event.stepCount !== undefined) {
            info.lastStep = event.step;
            info.lastStepCount = event.stepCount;
          }
          break;
      }
    };
    sogni.projects.on('job', jobEventHandler);

    function cleanup() {
      if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
      }
      sogni.projects.off('job', jobEventHandler);
    }

    project.on('completed', async () => {
      cleanup();
      // Wait for all in-flight downloads to finish before resolving
      await Promise.all(pendingDownloads);
      if (files.length < quantity) {
        console.log(`  Warning: requested ${quantity} but only ${files.length} completed`);
      }
      resolve(files);
    });

    project.on('failed', async (error) => {
      cleanup();
      await Promise.all(pendingDownloads);
      if (files.length > 0) {
        console.log(`  Warning: project failed after ${files.length}/${quantity} completed`);
        resolve(files);
      } else {
        reject(error);
      }
    });
  });
}

async function generateMedia(sogni, mediaType, promptOrParams, tokenType, quantity = 1, options = {}) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  switch (mediaType) {
    case 'image': {
      const modelId = DEFAULT_IMAGE_MODEL;
      const imageParams = promptOrParams; // structured object for image
      const size = IMAGE_SIZES[imageParams.image_size] || IMAGE_SIZES['portrait_16_9'];
      const imageModelConfig = Object.values(MODELS.image).find(m => m.id === modelId);
      const imageSteps = imageModelConfig?.defaultSteps || 8;
      const imageGuidance = imageModelConfig?.defaultGuidance ?? 1;
      const imageSampler = imageModelConfig?.defaultComfySampler || 'euler';
      const imageScheduler = imageModelConfig?.defaultComfyScheduler || 'simple';

      try {
        const estimate = await getImageJobEstimate(tokenType, modelId, imageSteps, imageGuidance, size.width, size.height, quantity, 0, imageSampler);
        const confirmed = await displayEstimateAndConfirm(estimate, tokenType);
        if (!confirmed) return null;
      } catch (e) {
        console.log(`  (Could not fetch cost estimate: ${e.message})`);
      }

      console.log(`\n  Generating ${quantity > 1 ? quantity + ' images' : 'image'} with ${modelId} (${size.width}x${size.height})...`);

      const project = await sogni.projects.create({
        type: 'image',
        modelId,
        positivePrompt: imageParams.prompt,
        numberOfMedia: quantity,
        steps: imageSteps,
        guidance: imageGuidance,
        sampler: imageSampler,
        scheduler: imageScheduler,
        seed: -1,
        width: size.width,
        height: size.height,
        outputFormat: 'jpg',
        tokenType,
      });

      const files = await trackJobsAndDownload(project, quantity, 'image', sogni);
      if (!files.length) {
        console.error('  Image generation failed or was filtered');
        return null;
      }

      return { type: 'image', url: files[0]?.url, localPath: files[0]?.localPath, files, model: modelId, prompt: imageParams.prompt };
    }

    case 'video': {
      const modelId = DEFAULT_VIDEO_MODEL;
      const videoParams = promptOrParams; // structured object for video

      // Assemble final prompt: ensure camera/style/stability metadata is included
      // The LLM is instructed to embed these in the prompt text, but if it only
      // placed them in the separate JSON fields, append them so they reach the model.
      let finalPrompt = videoParams.prompt;
      if (videoParams.camera_movement && !finalPrompt.toLowerCase().includes(videoParams.camera_movement.toLowerCase())) {
        finalPrompt += ` The camera performs a ${videoParams.camera_movement}.`;
      }
      if (videoParams.style_anchor && !finalPrompt.toLowerCase().includes(videoParams.style_anchor.toLowerCase())) {
        finalPrompt += ` ${videoParams.style_anchor}.`;
      }
      if (videoParams.stability_anchor && !finalPrompt.toLowerCase().includes(videoParams.stability_anchor.toLowerCase())) {
        finalPrompt += ` ${videoParams.stability_anchor}.`;
      }

      const modelConfig = MODELS.t2v?.[modelId];
      const videoDuration = options.duration || 10;
      const videoFps = modelConfig?.defaultFps || 24;
      // Resolve dimensions: user aspect ratio > default portrait (1088x1920)
      const aspectSize = VIDEO_ASPECT_RATIOS[options.aspect_ratio] || VIDEO_ASPECT_RATIOS['portrait'];
      const videoWidth = aspectSize.width;
      const videoHeight = aspectSize.height;
      const videoSteps = modelConfig?.defaultSteps || 20;
      const frames = calculateVideoFrames(modelId, videoDuration, videoFps);

      try {
        const estimate = await getVideoJobEstimate(tokenType, modelId, videoWidth, videoHeight, frames, videoFps, videoSteps, quantity);
        const confirmed = await displayEstimateAndConfirm(estimate, tokenType);
        if (!confirmed) return null;
      } catch (e) {
        console.log(`  (Could not fetch cost estimate: ${e.message})`);
      }

      console.log(`\n  Generating ${quantity > 1 ? quantity + ' videos' : 'video'} with ${modelId} (${videoDuration}s, ${videoFps}fps, ${videoWidth}x${videoHeight})...`);

      const project = await sogni.projects.create({
        type: 'video',
        network: 'fast',
        modelId,
        positivePrompt: finalPrompt,
        numberOfMedia: quantity,
        seed: -1,
        width: videoWidth,
        height: videoHeight,
        duration: videoDuration,
        fps: videoFps,
        steps: videoSteps,
        guidance: modelConfig?.defaultGuidance || 1.0,
        sampler: modelConfig?.defaultComfySampler,
        scheduler: modelConfig?.defaultComfyScheduler,
        tokenType,
      });

      const files = await trackJobsAndDownload(project, quantity, 'video', sogni);
      if (!files.length) {
        console.error('  Video generation failed');
        return null;
      }

      return { type: 'video', url: files[0]?.url, localPath: files[0]?.localPath, files, model: modelId, prompt: finalPrompt };
    }

    case 'audio': {
      const modelId = DEFAULT_AUDIO_MODEL;
      const songParams = promptOrParams; // structured object for audio
      const AUDIO_MODEL_DEFAULTS = {
        'ace_step_1.5_turbo': { steps: 8, sampler: 'euler', scheduler: 'simple' },
        'ace_step_1.5_sft': { steps: 50, sampler: 'er_sde', scheduler: 'linear_quadratic' },
      };
      const audioDefaults = AUDIO_MODEL_DEFAULTS[modelId] || AUDIO_MODEL_DEFAULTS['ace_step_1.5_turbo'];
      const audioSteps = audioDefaults.steps;

      try {
        const estimate = await getAudioJobEstimate(tokenType, modelId, songParams.duration, audioSteps, quantity);
        const confirmed = await displayEstimateAndConfirm(estimate, tokenType);
        if (!confirmed) return null;
      } catch (e) {
        console.log(`  (Could not fetch cost estimate: ${e.message})`);
      }

      console.log(`\n  Generating ${quantity > 1 ? quantity + ' tracks' : 'music'} with ${modelId}...`);

      const createParams = {
        type: 'audio',
        network: 'fast',
        modelId,
        positivePrompt: songParams.positivePrompt,
        language: songParams.language,
        numberOfMedia: quantity,
        duration: songParams.duration,
        bpm: songParams.bpm,
        keyscale: songParams.keyscale,
        timesignature: songParams.timesignature,
        steps: audioSteps,
        sampler: audioDefaults.sampler,
        scheduler: audioDefaults.scheduler,
        seed: -1,
        outputFormat: 'mp3',
        tokenType,
      };

      // Only include lyrics if present (omit for instrumentals)
      if (songParams.lyrics) {
        createParams.lyrics = songParams.lyrics;
      }

      const project = await sogni.projects.create(createParams);

      const files = await trackJobsAndDownload(project, quantity, 'audio', sogni);
      if (!files.length) {
        console.error('  Music generation failed');
        return null;
      }

      return { type: 'audio', url: files[0]?.url, localPath: files[0]?.localPath, files, model: modelId, prompt: songParams.positivePrompt };
    }

    default:
      return null;
  }
}

// ============================================================
// Chat with LLM (non-media conversation)
// ============================================================

function buildSystemPrompt(customPrompt) {
  if (customPrompt) return customPrompt;
  return [
    'You are a creative assistant with access to the Sogni Supernet for generating images, videos, and music.',
    'When the user asks to create, generate, draw, compose, or produce any media, call the appropriate tool immediately. Do not describe what you plan to create — just call the tool.',
    'For the tool\'s "prompt" argument, pass the user\'s creative intent as a concise description. Do NOT rewrite or elaborate the prompt yourself — a specialist will enhance it.',
    'When the user is having a conversation and not requesting media, respond normally without calling tools.',
    'After media generation, summarize what was created. NEVER include URLs, links, or download paths — the user already has the file locally.',
  ].join('\n');
}

async function chatWithLLM(sogni, messages, options, tokenType) {
  const stateHandler = (event) => {
    if (event.type === 'pending') console.log(`Status:      pending authorization`);
    else if (event.type === 'queued') console.log(`Status:      queued`);
    else if (event.type === 'assigned' && event.workerName) console.log(`Worker:      ${event.workerName} (assigned)`);
    else if (event.type === 'jobStarted' && event.workerName) console.log(`Worker:      ${event.workerName} (started)`);
  };
  sogni.chat.on('jobState', stateHandler);

  try {
    const startTime = Date.now();
    let firstTokenTime = null;

    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      ...(options.topK != null && { top_k: options.topK }),
      stream: true,
      tokenType,
    });

    let content = '';
    const filter = createThinkingFilter(options.showThinking);
    process.stdout.write('\nAssistant: ');
    for await (const chunk of stream) {
      if (chunk.content) {
        if (!firstTokenTime) firstTokenTime = Date.now();
        filter.write(chunk.content);
        content += chunk.content;
      }
    }
    filter.flush();
    console.log();

    const result = stream.finalResult;
    if (result) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const ttft = firstTokenTime ? ((firstTokenTime - startTime) / 1000).toFixed(2) : 'n/a';
      console.log();
      console.log('-'.repeat(60));
      if (result.workerName) console.log(`Worker:      ${result.workerName}`);
      console.log(`TTFT:        ${ttft}s`);
      console.log(`Time:        ${elapsed}s (server: ${result.timeTaken.toFixed(2)}s)`);
      if (result.usage) {
        const tps = result.usage.completion_tokens / result.timeTaken;
        console.log(
          `Tokens:      ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`,
        );
        console.log(`Speed:       ${tps.toFixed(1)} tokens/sec`);
      }
    }

    return content;
  } finally {
    sogni.chat.off('jobState', stateHandler);
  }
}

// ============================================================
// Handle tool calls — bridge to composition pipeline
// ============================================================

async function handleToolCalls(sogni, toolCalls, options, tokenType) {
  const results = [];

  for (const toolCall of toolCalls) {
    if (!isSogniToolCall(toolCall)) {
      results.push({ tool_call_id: toolCall.id, content: JSON.stringify({ success: false, error: `Unknown tool: ${toolCall.function.name}` }) });
      continue;
    }

    const args = parseToolCallArguments(toolCall);
    const mediaType = toolNameToMediaType(toolCall.function.name);
    const rawPrompt = args.prompt || options.prompt;
    // LLM-specified quantity (from user's natural language) takes priority over CLI flag
    const quantity = Math.max(1, Math.min(512, parseInt(args.quantity, 10) || options.quantity || 1));
    const startTime = Date.now();

    console.log(`\n  Tool call: ${toolCall.function.name}`);
    console.log(`  Intent: ${rawPrompt}`);
    if (quantity > 1) console.log(`  Quantity: ${quantity}`);

    let result = null;
    try {
      if (mediaType === 'audio') {
        const songParams = await composeSong(sogni, rawPrompt, options, tokenType);
        if (songParams) result = await generateMedia(sogni, 'audio', songParams, tokenType, quantity, options);
      } else if (mediaType === 'image') {
        const imageParams = await composeImage(sogni, rawPrompt, options, tokenType);
        if (imageParams) result = await generateMedia(sogni, 'image', imageParams, tokenType, quantity, options);
      } else if (mediaType === 'video') {
        const rawDuration = args.duration || options.duration || 10;
        const duration = Math.max(1, Math.min(20, parseFloat(rawDuration) || 10));
        // Resolve aspect ratio: LLM-extracted > CLI option > default portrait
        const aspect_ratio = (args.aspect_ratio && VIDEO_ASPECT_RATIOS[args.aspect_ratio]) ? args.aspect_ratio : (options.aspect_ratio || 'portrait');
        const arSize = VIDEO_ASPECT_RATIOS[aspect_ratio];
        if (arSize) console.log(`  Aspect:  ${aspect_ratio} (${arSize.width}x${arSize.height})`);
        const videoParams = await composeVideo(sogni, rawPrompt, options, tokenType, duration);
        if (videoParams) result = await generateMedia(sogni, 'video', videoParams, tokenType, quantity, { ...options, duration, aspect_ratio });
      }
    } catch (err) {
      console.error(`\n  Media generation error: ${err.message}`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(); console.log('-'.repeat(60));
    console.log(`Type:        ${mediaType}`);
    if (result) {
      console.log(`Model:       ${result.model}`);
      if (result.files?.length > 1) console.log(`Files:       ${result.files.filter(f => f.localPath).length} saved`);
      else if (result.localPath) console.log(`File:        ${result.localPath}`);
    }
    console.log(`Time:        ${elapsed}s`);

    results.push({
      tool_call_id: toolCall.id,
      content: JSON.stringify(result
        ? {
            success: true,
            media_type: mediaType,
            model: result.model,
            prompt: result.prompt,
            local_file: result.localPath || result.files?.[0]?.localPath || null,
            files_saved: result.files?.filter(f => f.localPath).length || (result.localPath ? 1 : 0),
            note: 'The file has been saved locally and shown to the user. Do NOT include any URLs or links in your response — the user already has the file.',
          }
        : { success: false, media_type: mediaType, error: 'Generation cancelled or failed' }),
    });
  }
  return results;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const options = parseArgs();

  if (!options.prompt) {
    console.error('Error: A prompt is required.');
    console.error('');
    showHelp();
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('  Sogni Chat — Platform Tools');
  console.log('  (Image, Video, and Music Generation)');
  console.log('='.repeat(60));
  showHelp();

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

  // Wait for LLM models and read capabilities
  let modelInfo = null;
  try {
    const availableModels = await sogni.chat.waitForModels();
    console.log('Available LLM models:');
    const modelIds = Object.keys(availableModels).sort((a, b) => {
      if (a === options.model) return -1;
      if (b === options.model) return 1;
      return 0;
    });
    for (let i = 0; i < modelIds.length; i++) {
      const id = modelIds[i];
      const info = availableModels[id];
      const ctx = info.maxContextLength ? `, ${(info.maxContextLength / 1024).toFixed(0)}K ctx` : '';
      const maxOut = info.maxOutputTokens ? `, max ${info.maxOutputTokens.max} out` : '';
      console.log(`  [${i + 1}] ${id} (${info.workers} worker${info.workers !== 1 ? 's' : ''}${ctx}${maxOut})`);
    }
    console.log();

    // Validate that the selected model is available
    if (!modelIds.includes(options.model)) {
      console.log(`Note: Selected model "${options.model}" is not currently available. Request will be queued.`);
    }

    // Store selected model's capabilities
    modelInfo = availableModels[options.model] || null;
  } catch {
    console.log('Warning: No LLM models currently available');
  }

  // Resolve max tokens: CLI override > model default > fallback
  // When thinking is enabled, use max output tokens to give the model room for reasoning
  options.maxTokens = options.maxTokens
    || (options.think ? modelInfo?.maxOutputTokens?.max : undefined)
    || modelInfo?.maxOutputTokens?.default
    || 8192;

  // Resolve sampling parameters: CLI override > server defaults for thinking mode > hardcoded fallback
  const samplingDefaults = options.think ? modelInfo?.defaultsThinking : modelInfo?.defaultsNonThinking;
  options.temperature = options.temperature ?? samplingDefaults?.temperature ?? 0.7;
  options.topP = options.topP ?? samplingDefaults?.top_p ?? 0.9;
  options.topK = options.topK ?? samplingDefaults?.top_k;

  // Wait for media models to be available
  try {
    await sogni.projects.waitForModels(15000);
  } catch {
    console.log('Warning: No media models currently available');
  }
  console.log();

  // Display config
  console.log(`LLM Model:   ${options.model}`);
  if (modelInfo?.maxContextLength) {
    console.log(`Context:     ${modelInfo.maxContextLength} tokens (${(modelInfo.maxContextLength / 1024).toFixed(0)}K)`);
  }
  if (modelInfo?.maxOutputTokens) {
    console.log(`Max Output:  ${modelInfo.maxOutputTokens.max} tokens (default: ${modelInfo.maxOutputTokens.default})`);
  }
  console.log(`Thinking:    ${options.think ? 'enabled' : 'disabled'}`);
  console.log(`Payment:     ${tokenLabel}`);
  if (options.quantity > 1) console.log(`Quantity:    ${options.quantity}`);
  console.log();

  // Process the prompt
  const userInput = options.prompt;
  console.log(`Prompt: ${userInput}`);

  // Build messages with tool-aware system prompt
  const systemPrompt = buildSystemPrompt(options.system);
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userInput },
  ];

  // LLM call: let the model decide intent via tool calling
  const stateHandler = (event) => {
    if (event.type === 'pending') console.log(`Status:      pending authorization`);
    else if (event.type === 'queued') console.log(`Status:      queued`);
    else if (event.type === 'assigned' && event.workerName) console.log(`Worker:      ${event.workerName} (assigned)`);
    else if (event.type === 'jobStarted' && event.workerName) console.log(`Worker:      ${event.workerName} (started)`);
  };
  sogni.chat.on('jobState', stateHandler);

  try {
    const mainStartTime = Date.now();
    let mainFirstTokenTime = null;

    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      ...(options.topK != null && { top_k: options.topK }),
      stream: true,
      tokenType,
      think: options.think,
      tools: HYBRID_TOOLS,
      tool_choice: 'auto',
    });

    // Stream response (text for conversation, empty for tool calls)
    let content = '';
    let hasContent = false;
    const filter = createThinkingFilter(options.showThinking);
    for await (const chunk of stream) {
      if (chunk.content) {
        if (!mainFirstTokenTime) mainFirstTokenTime = Date.now();
        if (!hasContent) { process.stdout.write('\nAssistant: '); hasContent = true; }
        filter.write(chunk.content);
        content += chunk.content;
      }
    }
    filter.flush();
    if (hasContent) console.log();

    const result = stream.finalResult;
    const toolCalls = stream.toolCalls;

    if (toolCalls.length > 0) {
      // ---- TOOL CALLING PATH ----
      // Remove main stateHandler so composition functions can manage their own
      sogni.chat.off('jobState', stateHandler);
      const intentElapsed = ((Date.now() - mainStartTime) / 1000).toFixed(2);
      console.log(`\n  LLM requested ${toolCalls.length} tool call${toolCalls.length > 1 ? 's' : ''} (${intentElapsed}s)`);

      const toolResults = await handleToolCalls(sogni, toolCalls, options, tokenType);

      // Feed results back to LLM for summary (no tools — pure text response)
      const followUpMessages = [
        ...messages,
        { role: 'assistant', content: content || null, tool_calls: toolCalls },
        ...toolResults.map(tr => ({ role: 'tool', content: tr.content, tool_call_id: tr.tool_call_id })),
      ];
      await chatWithLLM(sogni, followUpMessages, options, tokenType);
    } else {
      // ---- CONVERSATION PATH ----
      if (result) {
        const elapsed = ((Date.now() - mainStartTime) / 1000).toFixed(2);
        const ttft = mainFirstTokenTime ? ((mainFirstTokenTime - mainStartTime) / 1000).toFixed(2) : 'n/a';
        console.log(); console.log('-'.repeat(60));
        if (result.workerName) console.log(`Worker:      ${result.workerName}`);
        console.log(`TTFT:        ${ttft}s`);
        console.log(`Time:        ${elapsed}s (server: ${result.timeTaken.toFixed(2)}s)`);
        if (result.usage) {
          const tps = result.usage.completion_tokens / result.timeTaken;
          console.log(`Tokens:      ${result.usage.prompt_tokens} prompt + ${result.usage.completion_tokens} completion = ${result.usage.total_tokens} total`);
          console.log(`Speed:       ${tps.toFixed(1)} tokens/sec`);
        }
      }
    }
  } finally {
    sogni.chat.off('jobState', stateHandler);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
