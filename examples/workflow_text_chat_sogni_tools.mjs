#!/usr/bin/env node
/**
 * Text Chat with Sogni Platform Tools
 *
 * Single-turn chat that generates images, videos, and music through natural
 * language. Detects media generation intent from the user's message, uses the
 * LLM to enhance prompts (or compose full songs), then generates media directly
 * via the Sogni Projects API and opens the result.
 *
 * Default Generation Models:
 *   Image: z_image_turbo_bf16
 *   Video: ltx2-19b-fp8_t2v_distilled (LTX-2)
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
 *   node workflow_text_chat_sogni_tools.mjs --think "What is the meaning of life?"
 *
 * Options:
 *   --model         LLM model ID (default: qwen3-30b-a3b-gptq-int4)
 *   --max-tokens    Maximum tokens to generate (default: 4096)
 *   --temperature   Sampling temperature 0-2 (default: 0.7)
 *   --top-p         Top-p sampling 0-1 (default: 0.9)
 *   --system        System prompt override
 *   --quantity, -n  Number of media to generate per request, 1-512 (default: 1)
 *   --think         Enable model thinking/reasoning (shows <think> blocks)
 *   --no-think      Disable model thinking (default)
 *   --help          Show this help message
 */

import { SogniClient } from '../dist/index.js';
import { loadCredentials, loadTokenTypePreference } from './credentials.mjs';
import { askQuestion, calculateVideoFrames } from './workflow-helpers.mjs';
import * as fs from 'node:fs';
import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { resolve } from 'node:path';

const DEFAULT_LLM_MODEL = 'qwen3-30b-a3b-gptq-int4';
const DEFAULT_IMAGE_MODEL = 'z_image_turbo_bf16';
const DEFAULT_VIDEO_MODEL = 'ltx2-19b-fp8_t2v_distilled';
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
    maxTokens: 4096,
    temperature: 0.7,
    topP: 0.9,
    system: null,
    think: true,
    thinkExplicit: false,
    quantity: 1,
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
    } else if ((arg === '--quantity' || arg === '-n') && args[i + 1]) {
      options.quantity = Math.max(1, Math.min(512, parseInt(args[++i], 10) || 1));
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
  --max-tokens    Maximum tokens to generate (default: 4096)
  --temperature   Sampling temperature 0-2 (default: 0.7)
  --top-p         Top-p sampling 0-1 (default: 0.9)
  --system        System prompt override
  --quantity, -n  Number of media to generate per request, 1-512 (default: 1)
  --think         Enable model thinking/reasoning (shows <think> blocks)
  --no-think      Disable model thinking (default)
  --help          Show this help message

Default Generation Models:
  Image: ${DEFAULT_IMAGE_MODEL}
  Video: ${DEFAULT_VIDEO_MODEL} (LTX-2)
  Audio: ${DEFAULT_AUDIO_MODEL} (ACE-Step 1.5)
`);
}

// ============================================================
// Media intent detection
// ============================================================

// Detect what type of media the user wants from their message.
// Returns 'image' | 'video' | 'audio' | null.
function detectMediaIntent(text) {
  const lower = text.toLowerCase();

  const videoWords = ['video', 'clip', 'animation', 'animate', 'movie', 'film'];
  const audioWords = ['music', 'song', 'track', 'beat', 'melody', 'tune', 'audio', 'compose', 'composition'];
  const imageWords = ['image', 'picture', 'photo', 'illustration', 'artwork', 'portrait', 'drawing', 'painting'];
  const actionWords = ['generate', 'create', 'make', 'draw', 'paint', 'sketch', 'render', 'produce', 'design', 'write'];

  const hasAction = actionWords.some(w => lower.includes(w));
  const hasVideo = videoWords.some(w => lower.includes(w));
  const hasAudio = audioWords.some(w => lower.includes(w));
  const hasImage = imageWords.some(w => lower.includes(w));

  // Explicit type mention takes priority
  if (hasVideo) return 'video';
  if (hasAudio) return 'audio';
  if (hasImage) return 'image';

  // Action words alone (e.g., "draw me a dog") imply image
  if (hasAction) return 'image';

  return null;
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

const AUDIO_SYSTEM_PROMPT = `You are an expert music producer and songwriter. The user wants to generate a song using the ACE-Step 1.5 AI music model. Craft a complete song specification.

Return ONLY a valid JSON object (no markdown fences, no commentary) with these fields:

{"positivePrompt":"...","lyrics":"...","bpm":120,"keyscale":"C major","timesignature":"4","duration":60,"language":"en"}

FIELD GUIDELINES:

positivePrompt — Write a single dense paragraph describing the sound like a producer's brief. Cover these dimensions:
1. Genre and subgenre identity
2. Each key instrument with its ROLE, TEXTURE, and BEHAVIOR (not just a list of names)
3. Vocal character: gender, tonal quality adjectives (warm, crisp, raspy, breathy, strained), delivery style (sung, rapped, whispered, chanted), and any processing (reverb, lo-fi saturation, distortion)
4. Arrangement arc: how the track opens, builds, peaks, and concludes
5. Production aesthetic: texture words like polished, raw, gritty, airy, punchy, lo-fi, overdriven
6. Mood and energy

GOOD positivePrompt example:
"A driving post-punk arrangement kicks off with layered electric guitars--one clean and arpeggiated, the other providing distorted chordal texture--over a solid bassline and powerful live drums. The male lead vocal is delivered with an angsty, strained quality that builds into an anthemic, shouted chorus where his voice cracks with emotion. Following a melodic yet noisy guitar solo filled with feedback and expressive bends, the track breaks down to its core rhythmic elements before fading out on lingering guitar noise."

Another GOOD example:
"A dark ominous high energy aggressive drum and bass intro driven by heavily processed vocal chops and synth melody that serve as both rhythmic and melodic hooks. The song opens with layered, pitched-down crisp deep female-sounding vocal samples creating an atmospheric texture before slamming into a high-tempo breakbeat. A powerful bassline underpins the driving rhythm section. The arrangement is dynamic, featuring intense build-ups where filters sweep open to create tension, followed by impactful drops that reintroduce the core groove."

BAD positivePrompt: "contemporary R&B" (too vague, gives model no guidance)
BAD positivePrompt: "Funk, Soul, Groove, Male Vocals, Slap Bass" (tag list — write flowing sentences instead)

IMPORTANT: Do NOT include BPM numbers, key signatures, or tempo numbers in the positivePrompt. Use the dedicated bpm and keyscale fields for those. Use texture adjectives for tempo feel: "driving", "laid-back", "relentless", "languid".

lyrics — Use enriched section headers that embed instrumental and vocal directions:
GOOD headers: [Intro - Arpeggiated Electric Guitar], [Verse 1 - Slap Bass riff with soft male vocal], [Chorus - Horn Section hitting sharp staccato accents], [Bridge - Hammond B3 Organ percussive stabs], [Breakdown - Heavy half time trap phonk style groove]
GOOD vocal direction: [Female Vocal - Soprano, haunting and clear], [Male Vocal - Baritone, gritty], [Pre-Chorus - Call and Response], [whispered]
For instrumentals: [Intro Industrial drones, metallic clangs, building tension], [Build-Up Steady percussion, rising arpeggios], [Climax Peak intensity, layered metallic sounds]
Write lyrics that tell a story or convey emotion with dynamic contrast. Match density to genre: sparse for ambient, dense for rap, catchy hooks for pop/EDM. Use \\n for newlines.

bpm — Match genre: Ballad 60-80, R&B/Hip-hop 80-100, Pop/Country/Funk 100-130, Rock/EDM 120-140, Metal/Trap/Dubstep 130-160, DnB 170-180

keyscale — Minor keys for dark/emotional/intense (D minor, A minor, E minor, C minor). Major keys for bright/upbeat (C major, G major, E major, Bb major, Ab major).

timesignature — "4" for 4/4 (most genres), "3" for 3/4 (waltzes, some ballads), "6" for 6/8 (compound time, folk)

duration — Default to 60s unless the user explicitly requests shorter or longer. 30-45s short pieces, 60s standard songs, 90-120s full compositions

language — ISO code: "en", "ja", "zh", "es", "fr", "de", "ko", "ar", "pt", "ru", "it", etc.

Return ONLY the JSON object.`;

const CAMERA_MOVEMENTS = [
  'static tripod', 'slow push-in', 'slow pull-back',
  'smooth pan left', 'smooth pan right', 'slow tilt up', 'slow tilt down',
  'slow arc left', 'slow arc right', 'tracking follow', 'handheld subtle drift',
];

const VIDEO_SYSTEM_PROMPT = `You are an expert cinematographer writing prompts for the LTX-2 AI video generation model. LTX-2 performs best when the prompt reads like a cohesive mini-scene: a complete story beat described in present tense. Clear camera-to-subject relationship improves motion consistency.

Return ONLY a valid JSON object (no markdown fences, no commentary) with these fields:
{"prompt":"...","camera_movement":"slow push-in","shot_scale":"medium","style_anchor":"cinematic nocturne","stability_anchor":"smooth and stabilised"}

PROMPT CONSTRUCTION — Write a single flowing paragraph of 4-8 sentences in present tense. A single continuous shot (no hard cuts, no "cut to", no montage). Follow this mandatory order:

1. ESTABLISH THE SHOT: Shot scale (wide, medium, close-up) + genre/visual language. Example: "A medium close-up cinematic shot..."

2. SET THE SCENE: Environment + time of day + atmosphere/weather + surface textures + one or two grounding details. Name light sources and their quality: "warm tungsten practical lights", "golden hour sun through dusty windows", "neon reflections shimmering across wet pavement".

3. DEFINE CHARACTER(S): Age range, hair, clothing, notable features. Keep identity stable and coherent throughout.

4. DESCRIBE ACTION AS A NATURAL SEQUENCE: One main action thread that evolves beginning to end. Use temporal connectors ("as", "then", "while"). Prefer physically filmable behavior: a steady walk, a slow turn, a hand reaching forward, eyes shifting.

5. DIALOGUE (when applicable): If the user's request involves a character speaking, pitching, narrating, or delivering lines, write the EXACT quoted dialogue the character says. Use direct quotes embedded in the action description, e.g.: He looks into the camera and says, "Welcome to the future of creative AI." Weave dialogue naturally into the action sequence — do not summarise or paraphrase what the character says; write the actual words.

6. SPECIFY ONE COMMITTED CAMERA MOVEMENT: Pick exactly one from: "static tripod", "slow push-in", "slow pull-back", "smooth pan left", "smooth pan right", "slow tilt up", "slow tilt down", "slow arc left", "slow arc right", "tracking follow", "handheld subtle drift". Describe the camera's relationship to the subject and what is revealed by the move.

7. EMOTIONAL SPECIFICITY VIA PHYSICAL CUES: Jaw tension, grip pressure, breathing pace, glance direction, weight shift, posture changes — express all emotion through visible physical behavior.

8. STABILITY + MOTION ANCHORS: Include at least one: "smooth and stabilised", "tripod-locked", "cinematic motion consistency", "natural motion blur", "steady pace".

HARD CONSTRAINTS:
- Exactly one camera movement per prompt
- Present tense verbs throughout
- All phrasing must be positive (express what IS present, visible, happening)
- No on-screen text, logos, or signage directives (quoted dialogue is fine)

camera_movement — Choose exactly one: "static tripod", "slow push-in", "slow pull-back", "smooth pan left", "smooth pan right", "slow tilt up", "slow tilt down", "slow arc left", "slow arc right", "tracking follow", "handheld subtle drift"

shot_scale — "wide", "medium", or "close-up"

style_anchor — 0-2 short phrases (e.g., "cinematic nocturne", "documentary handheld feel")

stability_anchor — One stabiliser phrase (e.g., "smooth and stabilised", "tripod-locked", "cinematic motion consistency")

REFERENCE (study the style and structure):
{"prompt":"A medium close-up cinematic shot in a quiet, rain-soaked alley at night, neon reflections shimmering across wet pavement and brick. A man in his 30s with short dark hair and a worn leather jacket stands under a flickering sign, water beading on his collar and eyelashes. He exhales slowly, shoulders tightening as his fingers clamp around a small metal lighter, then he steadies his hand and clicks it once, watching the flame struggle against the damp air. The camera performs a slow push-in toward his face, keeping the lighter flame in the foreground as his eyes track a faint movement deeper in the alley. His jaw sets, the tendons in his neck rising as he shifts his weight forward by half a step, breathing measured and controlled. Smooth and stabilised with cinematic motion consistency and natural motion blur, lit by diffused neon glow and soft practical highlights.","camera_movement":"slow push-in","shot_scale":"medium","style_anchor":"cinematic nocturne","stability_anchor":"smooth and stabilised"}

Return ONLY the JSON object.`;

const IMAGE_SYSTEM_PROMPT = `You are a prompt engineer for the Z-Image Turbo text-to-image model. This is a few-step distilled model. All constraints must be expressed positively ("crisp detail", "sharp focus", "clean background"). The model understands natural language sentences — write flowing prose, never comma-separated tag lists.

Return ONLY a valid JSON object (no markdown fences, no commentary) with these fields:
{"prompt":"...","image_size":"portrait_16_9"}

PROMPT CONSTRUCTION — Write natural language sentences, 80-180 words (max 250). Focus on 3-5 key visual concepts. Follow this mandatory order:

1. SUBJECT (front-load): Identity + distinctive traits + clothing/materials + action/state. Be concrete: age range, specific features, materials, surface conditions.

2. ENVIRONMENT: Location + time of day + atmosphere/weather + background elements.

3. COMPOSITION & FRAMING: Shot type (close-up, wide, top-down), focal priority, depth of field intent, composition rule if relevant (rule of thirds, centered).

4. LIGHTING (name the setup): "soft natural afternoon window light", "three-point studio lighting", "golden hour backlight with long shadows", "overcast diffused light", "Rembrandt lighting with delicate shadows".

5. CAMERA/LENS (optional, efficient aesthetic shortcut): "Canon 5D with 85mm f/1.8", "Hasselblad X2D with 90mm at f/4", "Leica M11 with 35mm Summilux", "Kodak Portra 400 film grain look", "iPhone 15 Pro ProRAW".

6. STYLE ANCHORS (max 2): Short and specific. "vintage Japanese woodblock print style", "editorial raw portrait", "Spider-Verse animation style", "intimate documentary style".

7. POSITIVE QUALITY CONSTRAINTS: "crisp details", "clean edges", "natural skin texture", "realistic reflections", "high micro-contrast", "sharp focus".

image_size — Choose based on the subject:
- "square_hd": general purpose, products, centered compositions
- "portrait_4_3": portraits, people, vertical subjects
- "portrait_16_9": full-body, tall architecture, story format
- "landscape_4_3": environmental scenes, groups, interiors
- "landscape_16_9": wide landscapes, panoramic, cinematic framing

REFERENCE (study the style):
{"prompt":"A 65-year-old Asian woman with silver hair and gentle wrinkles sits in a cozy library, wearing a hand-knitted cardigan and thin reading glasses, holding an open book close to her chest. Warm wooden shelves and softly blurred book spines fill the background as dust motes drift through the air. Tight portrait framing with shallow depth of field keeps her eyes and hands in sharp focus, following the rule of thirds. Soft natural afternoon window light creates delicate shadows and a calm glow. Shot on a Canon 5D with an 85mm f/1.8 lens, subtle Kodak Portra 400 film grain look, crisp details and natural skin texture.","image_size":"portrait_4_3"}

Return ONLY the JSON object.`;

// ============================================================
// LLM cost estimate + confirmation
// ============================================================

async function estimateLLMAndConfirm(sogni, messages, options, tokenType, label) {
  try {
    const estimate = await sogni.chat.estimateCost({
      model: options.model,
      messages,
      max_tokens: 4096,
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
// LLM: Compose a video specification for LTX-2
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
        return {
          prompt: String(parsed.prompt),
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

  console.log('  (Could not parse video JSON from LLM, using defaults)');
  return {
    prompt: fallbackPrompt,
    camera_movement: 'slow push-in',
    shot_scale: 'medium',
    style_anchor: '',
    stability_anchor: 'smooth and stabilised',
  };
}

async function composeVideo(sogni, userMessage, options, tokenType) {
  const userContent = options.think ? userMessage : `${userMessage} /no_think`;
  const messages = [
    { role: 'system', content: VIDEO_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const confirmed = await estimateLLMAndConfirm(sogni, messages, options, tokenType, 'video prompt');
  if (!confirmed) return null;

  console.log('\n  Composing video prompt via LLM...');

  const stateHandler = (event) => {
    if (event.type === 'pending') console.log(`  Status: pending authorization`);
    else if (event.type === 'queued') console.log(`  Status: queued`);
    else if (event.type === 'assigned' && event.workerName) console.log(`  Worker: ${event.workerName} (assigned)`);
    else if (event.type === 'jobStarted' && event.workerName) console.log(`  Worker: ${event.workerName} (started)`);
  };
  sogni.chat.on('jobState', stateHandler);

  try {
    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: options.topP,
      stream: true,
      tokenType,
    });

    let raw = '';
    process.stdout.write('  Composing: ');
    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        raw += chunk.content;
      }
    }
    console.log();

    const videoParams = parseVideoJSON(raw, userMessage);

    console.log(`  Camera:   ${videoParams.camera_movement}`);
    console.log(`  Scale:    ${videoParams.shot_scale}`);
    if (videoParams.style_anchor) console.log(`  Style:    ${videoParams.style_anchor}`);
    console.log(`  Prompt:   ${videoParams.prompt.substring(0, 120)}${videoParams.prompt.length > 120 ? '...' : ''}`);

    return videoParams;
  } catch (err) {
    console.log(`  (Video prompt composition failed: ${err.message}, using original)`);
    return {
      prompt: userMessage,
      camera_movement: 'slow push-in',
      shot_scale: 'medium',
      style_anchor: '',
      stability_anchor: 'smooth and stabilised',
    };
  } finally {
    sogni.chat.off('jobState', stateHandler);
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

  console.log('  (Could not parse image JSON from LLM, using defaults)');
  return {
    prompt: fallbackPrompt,
    image_size: 'portrait_16_9',
  };
}

async function composeImage(sogni, userMessage, options, tokenType) {
  const userContent = options.think ? userMessage : `${userMessage} /no_think`;
  const messages = [
    { role: 'system', content: IMAGE_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const confirmed = await estimateLLMAndConfirm(sogni, messages, options, tokenType, 'image prompt');
  if (!confirmed) return null;

  console.log('\n  Composing image prompt via LLM...');

  const stateHandler = (event) => {
    if (event.type === 'pending') console.log(`  Status: pending authorization`);
    else if (event.type === 'queued') console.log(`  Status: queued`);
    else if (event.type === 'assigned' && event.workerName) console.log(`  Worker: ${event.workerName} (assigned)`);
    else if (event.type === 'jobStarted' && event.workerName) console.log(`  Worker: ${event.workerName} (started)`);
  };
  sogni.chat.on('jobState', stateHandler);

  try {
    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: options.topP,
      stream: true,
      tokenType,
    });

    let raw = '';
    process.stdout.write('  Composing: ');
    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        raw += chunk.content;
      }
    }
    console.log();

    const imageParams = parseImageJSON(raw, userMessage);
    const size = IMAGE_SIZES[imageParams.image_size];

    console.log(`  Size:   ${imageParams.image_size} (${size.width}x${size.height})`);
    console.log(`  Prompt: ${imageParams.prompt.substring(0, 120)}${imageParams.prompt.length > 120 ? '...' : ''}`);

    return imageParams;
  } catch (err) {
    console.log(`  (Image prompt composition failed: ${err.message}, using original)`);
    return {
      prompt: userMessage,
      image_size: 'portrait_16_9',
    };
  } finally {
    sogni.chat.off('jobState', stateHandler);
  }
}

// ============================================================
// LLM: Compose a complete song specification for ACE-Step 1.5
// ============================================================

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
          keyscale: String(parsed.keyscale || 'C major'),
          timesignature: String(parsed.timesignature || '4'),
          duration: Math.max(10, Math.min(600, parseInt(parsed.duration) || 60)),
          language: String(parsed.language || 'en'),
        };
      }
    } catch {
      // try next parsing strategy
    }
  }

  // Fallback: use raw text as prompt with defaults
  console.log('  (Could not parse song JSON from LLM, using defaults)');
  return {
    positivePrompt: fallbackPrompt,
    lyrics: '',
    bpm: 120,
    keyscale: 'C major',
    timesignature: '4',
    duration: 60,
    language: 'en',
  };
}

async function composeSong(sogni, userMessage, options, tokenType) {
  const userContent = options.think ? userMessage : `${userMessage} /no_think`;
  const messages = [
    { role: 'system', content: AUDIO_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];

  const confirmed = await estimateLLMAndConfirm(sogni, messages, options, tokenType, 'song composition');
  if (!confirmed) return null;

  console.log('\n  Composing song via LLM...');

  const stateHandler = (event) => {
    if (event.type === 'pending') console.log(`  Status: pending authorization`);
    else if (event.type === 'queued') console.log(`  Status: queued`);
    else if (event.type === 'assigned' && event.workerName) console.log(`  Worker: ${event.workerName} (assigned)`);
    else if (event.type === 'jobStarted' && event.workerName) console.log(`  Worker: ${event.workerName} (started)`);
  };
  sogni.chat.on('jobState', stateHandler);

  try {
    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: 4096,
      temperature: 0.7,
      top_p: options.topP,
      stream: true,
      tokenType,
    });

    let raw = '';
    process.stdout.write('  Composing: ');
    for await (const chunk of stream) {
      if (chunk.content) {
        process.stdout.write(chunk.content);
        raw += chunk.content;
      }
    }
    console.log();

    const songParams = parseSongJSON(raw, userMessage);

    // Display composition summary
    const tsLabels = { '2': '2/4', '3': '3/4', '4': '4/4', '6': '6/8' };
    console.log();
    console.log('  Song Composition:');
    console.log(`  Style:     ${songParams.positivePrompt.substring(0, 120)}${songParams.positivePrompt.length > 120 ? '...' : ''}`);
    console.log(`  BPM:       ${songParams.bpm}`);
    console.log(`  Key:       ${songParams.keyscale}`);
    console.log(`  Time:      ${tsLabels[songParams.timesignature] || songParams.timesignature}`);
    console.log(`  Duration:  ${songParams.duration}s`);
    console.log(`  Language:  ${songParams.language}`);
    if (songParams.lyrics) {
      const lineCount = songParams.lyrics.split('\n').filter(l => l.trim()).length;
      console.log(`  Lyrics:    ${lineCount} lines`);
    }

    return songParams;
  } catch (err) {
    console.log(`  (Song composition failed: ${err.message}, using defaults)`);
    return {
      positivePrompt: userMessage,
      lyrics: '',
      bpm: 120,
      keyscale: 'C major',
      timesignature: '4',
      duration: 60,
      language: 'en',
    };
  } finally {
    sogni.chat.off('jobState', stateHandler);
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

async function getImageJobEstimate(tokenType, modelId, steps, guidance = 0, width = 1024, height = 1024, imageCount = 1, previewCount = 0) {
  const url = `${getEstimateBaseUrl()}/api/v3/job/estimate/${tokenType}/fast/${encodeURIComponent(modelId)}/${imageCount}/${steps}/${previewCount}/false/1.0/${width}/${height}/${guidance}/euler/0`;
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

function trackJobsAndDownload(project, quantity, mediaType) {
  const ext = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : null;
  const files = [];
  const pendingDownloads = []; // track in-flight downloads
  const jobLines = new Map(); // jobId -> display info
  let nextLineIndex = 0;
  let linesWritten = 0;

  function redrawProgress() {
    // Move cursor up to overwrite previous lines
    if (linesWritten > 0) {
      process.stdout.write(`\x1B[${linesWritten}A`);
    }
    linesWritten = 0;
    for (const [, info] of jobLines) {
      const bar = renderBar(info.pct);
      const status = info.status === 'done' ? 'done'
        : info.status === 'failed' ? 'FAILED'
        : `${info.pct}%`;
      const worker = info.workerName ? ` [${info.workerName}]` : '';
      const label = quantity > 1 ? `  Job ${info.index}/${quantity}: ` : '  Progress: ';
      process.stdout.write(`\x1B[K${label}${bar} ${status}${worker}\n`);
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
      jobLines.set(job.id, { index, pct: 0, status: 'running', workerName: job.workerName || '' });
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

    project.on('completed', async () => {
      // Wait for all in-flight downloads to finish before resolving
      await Promise.all(pendingDownloads);
      if (files.length < quantity) {
        console.log(`  Warning: requested ${quantity} but only ${files.length} completed`);
      }
      resolve(files);
    });

    project.on('failed', async (error) => {
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

async function generateMedia(sogni, mediaType, promptOrParams, tokenType, quantity = 1) {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  switch (mediaType) {
    case 'image': {
      const modelId = DEFAULT_IMAGE_MODEL;
      const imageParams = promptOrParams; // structured object for image
      const size = IMAGE_SIZES[imageParams.image_size] || IMAGE_SIZES['portrait_16_9'];

      try {
        const estimate = await getImageJobEstimate(tokenType, modelId, 8, 1, size.width, size.height, quantity);
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
        steps: 8,
        guidance: 1,
        seed: -1,
        width: size.width,
        height: size.height,
        outputFormat: 'jpg',
        tokenType,
      });

      const files = await trackJobsAndDownload(project, quantity, 'image');
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

      const videoDuration = 10;
      const videoFps = 24;
      const videoWidth = 1920;
      const videoHeight = 1088;
      const videoSteps = 20;
      const frames = calculateVideoFrames(modelId, videoDuration, videoFps);

      try {
        const estimate = await getVideoJobEstimate(tokenType, modelId, videoWidth, videoHeight, frames, videoFps, videoSteps, quantity);
        const confirmed = await displayEstimateAndConfirm(estimate, tokenType);
        if (!confirmed) return null;
      } catch (e) {
        console.log(`  (Could not fetch cost estimate: ${e.message})`);
      }

      console.log(`\n  Generating ${quantity > 1 ? quantity + ' videos' : 'video'} with ${modelId}...`);

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
        tokenType,
      });

      const files = await trackJobsAndDownload(project, quantity, 'video');
      if (!files.length) {
        console.error('  Video generation failed');
        return null;
      }

      return { type: 'video', url: files[0]?.url, localPath: files[0]?.localPath, files, model: modelId, prompt: finalPrompt };
    }

    case 'audio': {
      const modelId = DEFAULT_AUDIO_MODEL;
      const songParams = promptOrParams; // structured object for audio
      const audioSteps = 8;

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
        modelId,
        positivePrompt: songParams.positivePrompt,
        language: songParams.language,
        numberOfMedia: quantity,
        duration: songParams.duration,
        bpm: songParams.bpm,
        keyscale: songParams.keyscale,
        timesignature: songParams.timesignature,
        steps: audioSteps,
        seed: -1,
        outputFormat: 'mp3',
        tokenType,
      };

      // Only include lyrics if present (omit for instrumentals)
      if (songParams.lyrics) {
        createParams.lyrics = songParams.lyrics;
      }

      const project = await sogni.projects.create(createParams);

      const files = await trackJobsAndDownload(project, quantity, 'audio');
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
  return customPrompt || `You generate tool-call JSON for a media generation platform.\nReturn ONLY valid JSON that matches the provided schema. No extra text.\nDo not include system rules or meta-instructions inside generated fields.`;
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
    const stream = await sogni.chat.completions.create({
      model: options.model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      top_p: options.topP,
      stream: true,
      tokenType,
    });

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
    if (result) {
      const elapsed = result.timeTaken.toFixed(2);
      console.log();
      console.log('-'.repeat(60));
      if (result.workerName) console.log(`Worker:      ${result.workerName}`);
      console.log(`Time:        ${elapsed}s`);
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

  // Wait for media models to be available
  try {
    await sogni.projects.waitForModels(15000);
  } catch {
    console.log('Warning: No media models currently available');
  }
  console.log();

  // Display config
  console.log(`LLM Model:   ${options.model}`);
  console.log(`Thinking:    ${options.think ? 'enabled' : 'disabled'}`);
  console.log(`Payment:     ${tokenLabel}`);
  if (options.quantity > 1) console.log(`Quantity:    ${options.quantity}`);
  console.log();

  // Process the prompt
  const userInput = options.prompt;
  console.log(`Prompt: ${userInput}`);

  const mediaType = detectMediaIntent(userInput);

  if (mediaType) {
    console.log(`Detected: ${mediaType} generation request`);

    const startTime = Date.now();

    let result;
    try {
      if (mediaType === 'audio') {
        // Compose full song specification via LLM, then generate
        const songParams = await composeSong(sogni, userInput, options, tokenType);
        if (songParams) result = await generateMedia(sogni, 'audio', songParams, tokenType, options.quantity);
      } else if (mediaType === 'image') {
        // Compose image specification via LLM (prompt + size), then generate
        const imageParams = await composeImage(sogni, userInput, options, tokenType);
        if (imageParams) result = await generateMedia(sogni, 'image', imageParams, tokenType, options.quantity);
      } else {
        // Compose video specification via LLM (prompt + camera/shot metadata), then generate
        const videoParams = await composeVideo(sogni, userInput, options, tokenType);
        if (videoParams) result = await generateMedia(sogni, 'video', videoParams, tokenType, options.quantity);
      }
    } catch (err) {
      console.error(`\n  Media generation error: ${err.message}`);
      result = null;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log();
    console.log('-'.repeat(60));
    console.log(`Type:        ${mediaType}`);
    if (result) {
      console.log(`Model:       ${result.model}`);
      if (result.files && result.files.length > 1) {
        console.log(`Files:       ${result.files.filter(f => f.localPath).length} saved`);
      } else if (result.localPath) {
        console.log(`File:        ${result.localPath}`);
      }
    }
    console.log(`Time:        ${elapsed}s`);
  } else {
    // Normal conversation (no media detected)
    const systemPrompt = buildSystemPrompt(options.system);
    const userContent = options.think ? userInput : `${userInput} /no_think`;
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
    await chatWithLLM(sogni, messages, options, tokenType);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
