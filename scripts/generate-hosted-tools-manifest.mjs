// Generates src/Chat/_hostedToolsManifest.generated.ts by reading the
// hosted-tools manifest from @sogni-ai/sogni-protocol/manifests/openai-tools.json,
// applying SDK-local compatibility patches, and emitting it inline as a
// TypeScript constant.
//
// Why codegen instead of importing the JSON directly: this package builds
// to both CJS and ESM. CJS `require('./foo.json')` works natively, but ESM
// (Node >= 22) requires `import x from './foo.json' with { type: 'json' }`,
// and TypeScript cannot conditionally emit that attribute for a dual build.
// Inlining the data as a TS constant sidesteps the issue entirely and
// matches the pattern @sogni-ai/sogni-intelligence-client uses for the same
// reason.
//
// The generated file is .gitignored. Run via `npm run build` (via the
// pre-build script) or explicitly via `npm run codegen`.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const protocolPkgPath = require.resolve('@sogni-ai/sogni-protocol/package.json');
const manifestPath = join(dirname(protocolPkgPath), 'manifests', 'openai-tools.json');

const outFile = join(process.cwd(), 'src', 'Chat', '_hostedToolsManifest.generated.ts');

const raw = await readFile(manifestPath, 'utf8');
const manifest = JSON.parse(raw); // validate

// MiniMax Music 3 first: it is the default music model.
const audioModelIds = [
  'minimax_music3',
  'ace_step_1.5_xl_turbo',
  'ace_step_1.5_xl_sft',
  'ace_step_1.5_turbo',
  'ace_step_1.5_sft'
];

// The protocol exposes generate_music selectors ("music3", "turbo", "sft").
// The SDK accepts canonical model IDs only, so keep the generated tool schema
// aligned with SDK routing.
const generateMusicTool = manifest.tools?.find((tool) => tool?.function?.name === 'generate_music');
const generateMusicModel = generateMusicTool?.function?.parameters?.properties?.model;
if (generateMusicModel) {
  generateMusicModel.enum = audioModelIds;
  generateMusicModel.description =
    'Canonical music model ID. Default: minimax_music3 (MiniMax Music 3, premium autoregressive composer ' +
    'with the best vocals, lyric adherence and song structure; 10-300 s, and duration is a ceiling, so the ' +
    'song may end earlier at a musical resolution). Music 3 takes tempo and key in the prompt text; bpm, ' +
    'keyscale and timesig apply to ACE-Step only. ' +
    'Use ace_step_1.5_xl_turbo only when the user asks for a quick, cheap or draft track, names ACE-Step, ' +
    'or wants a track longer than 300 s (with no model named, a duration over 300 s uses ACE-Step XL Turbo). ' +
    'Use ace_step_1.5_xl_sft only when the user explicitly requests XL SFT. ' +
    'Use legacy ace_step_1.5_turbo or ace_step_1.5_sft only when the user explicitly requests a legacy model.';
}

// Same text as @sogni-ai/sogni-protocol 382e051 (protocolVersion 7.6.0): Music 3's
// duration range and the ACE-Step-only tempo, key and time-signature controls.
// A no-op once the pinned protocol carries it.
const MUSIC_DURATION_DESCRIPTION =
  'Duration in seconds. music3 (the default model): 10-300, default 60, and a ceiling — the song may end earlier at a musical resolution. ACE-Step turbo/sft: 10-600, default 30. Short clips: 10-30s. Standard songs: 120-300s.';
const aceStepOnlyMusicDescription = (what) =>
  `ACE-Step (turbo, sft) only — music3 does not use it; for music3 put the ${what} in the prompt instead. `;
const generateMusicProperties = generateMusicTool?.function?.parameters?.properties;
if (generateMusicProperties?.duration) {
  generateMusicProperties.duration.description = MUSIC_DURATION_DESCRIPTION;
}
for (const [propertyName, what] of [
  ['bpm', 'tempo'],
  ['keyscale', 'key'],
  ['timesig', 'time signature']
]) {
  const property = generateMusicProperties?.[propertyName];
  const prefix = aceStepOnlyMusicDescription(what);
  if (property && !property.description?.startsWith(prefix)) {
    property.description = `${prefix}${property.description ?? ''}`;
  }
}

const MINIMAX_H3_LIGHTX2V_BALANCED_SOURCE_URL =
  'https://huggingface.co/lightx2v/Minimax-h3-Turbo/tree/f3d9da6dac47dcb985684ca150f02893f619a171';
const MINIMAX_H3_LARRY_BALANCED_SOURCE_URL =
  'https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora/tree/7b7ac96b0616100db75ea285090210c3ddf37c04';
const appendDescriptionOnce = (description, addition) =>
  description?.includes(addition) ? description : `${description || ''} ${addition}`.trim();

// The protocol owns the original MiniMax H3 selectors. Keep SDK additions here
// until the protocol manifest catches up. Generic aliases resolve to t2v or i2v
// based on whether a first-frame image is present.
const generateVideoTool = manifest.tools?.find((tool) => tool?.function?.name === 'generate_video');
const generateVideoModel = generateVideoTool?.function?.parameters?.properties?.videoModel;
if (generateVideoModel) {
  generateVideoModel.enum = [
    ...new Set([
      ...(Array.isArray(generateVideoModel.enum) ? generateVideoModel.enum : []),
      'minimax-h3-turbo',
      'minimax-h3-fasth3-turbo',
      'minimax-h3-fasth3-t2v-turbo',
      'minimax-h3-fasth3-turbo-2stage',
      'minimax-h3-fasth3-t2v-turbo-2stage',
      'minimax-h3-balanced',
      'minimax-h3-t2v-balanced',
      'minimax-h3-r2v-balanced',
      'minimax-h3-r2v-2stage',
      'minimax-h3-r2v-balanced-2stage',
      'wan3.0-video',
      'wan3.0-spicy-video'
    ])
  ];
  generateVideoModel.description = appendDescriptionOnce(
    generateVideoModel.description,
    `MiniMax H3 Balanced uses the LightX2V 8-step 768p accelerator for FL2VA and Larry v4 step-600 EMA for Ref2VA, between 4-step Turbo and 20-step Standard; use "minimax-h3-balanced" or "minimax-h3-t2v-balanced" for FL2VA text-to-video and "minimax-h3-r2v-balanced" for Ref2VA reference-to-video. Sources: ${MINIMAX_H3_LIGHTX2V_BALANCED_SOURCE_URL} and ${MINIMAX_H3_LARRY_BALANCED_SOURCE_URL}.`
  );
  generateVideoModel.description = appendDescriptionOnce(
    generateVideoModel.description,
    'MiniMax H3 FastH3 Turbo is the separate FastVideo VSA four-step engine, qualified only with Euler/simple; use "minimax-h3-fasth3-turbo" or "minimax-h3-fasth3-t2v-turbo" for text-to-video. Existing "minimax-h3-turbo" selectors remain LightX2V Turbo. FastH3 has no R2V mode.'
  );
  generateVideoModel.description = appendDescriptionOnce(
    generateVideoModel.description,
    'MiniMax H3 FastH3 Two-Stage renders the FastH3 canvas, then enlarges it 2x and refines it, delivering twice the canvas with the same length and audio; use "minimax-h3-fasth3-turbo-2stage" or "minimax-h3-fasth3-t2v-turbo-2stage" for two-stage text-to-video. Its targetResolution names the delivered class: 1080 (544px canvas, 960x544 delivers 1920x1088), 1440 or omitted for 2K (768p canvas, 1344x768 delivers 2688x1536), or 720 (384px canvas, 672x384 delivers 1344x768).'
  );
  generateVideoModel.description = appendDescriptionOnce(
    generateVideoModel.description,
    'MiniMax H3 Two-Stage Reference-to-Video is the Standard or Balanced Ref2VA request delivered at twice the canvas with the same length, audio and references; use "minimax-h3-r2v-2stage" (20 steps) or "minimax-h3-r2v-balanced-2stage" (8 steps). targetResolution names the delivered class exactly as for the FastH3 two-stage selectors (1080, 1440 or omitted for 2K, 720), and each bills its tier\'s rate plus the two-stage surcharge of that class; keep "minimax-h3-r2v" or "minimax-h3-r2v-balanced" for ordinary 768p output.'
  );
}

const animatePhotoTool = manifest.tools?.find((tool) => tool?.function?.name === 'animate_photo');
const animatePhotoModel = animatePhotoTool?.function?.parameters?.properties?.videoModel;
if (animatePhotoModel) {
  animatePhotoModel.enum = [
    ...new Set([
      ...(Array.isArray(animatePhotoModel.enum) ? animatePhotoModel.enum : []),
      'minimax-h3-i2v-balanced',
      'minimax-h3-flf2v-balanced',
      'minimax-h3-fasth3-i2v-turbo',
      'minimax-h3-fasth3-flf2v-turbo',
      'minimax-h3-fasth3-i2v-turbo-2stage',
      'minimax-h3-fasth3-flf2v-turbo-2stage'
    ])
  ];
  animatePhotoModel.description = appendDescriptionOnce(
    animatePhotoModel.description,
    `MiniMax H3 Balanced uses the LightX2V 8-step 768p accelerator for fixed 8-step generation; use "minimax-h3-i2v-balanced" for one endpoint image and "minimax-h3-flf2v-balanced" for required first-and-last frames. Source: ${MINIMAX_H3_LIGHTX2V_BALANCED_SOURCE_URL}.`
  );
  animatePhotoModel.description = appendDescriptionOnce(
    animatePhotoModel.description,
    'MiniMax H3 FastH3 Turbo is the separate FastVideo VSA four-step engine, qualified only with Euler/simple; use "minimax-h3-fasth3-i2v-turbo" for one endpoint image and "minimax-h3-fasth3-flf2v-turbo" for required first-and-last frames. Existing "minimax-h3-*-turbo" selectors remain LightX2V Turbo.'
  );
  animatePhotoModel.description = appendDescriptionOnce(
    animatePhotoModel.description,
    'MiniMax H3 FastH3 Two-Stage renders the FastH3 canvas, then enlarges it 2x and refines it, delivering twice the canvas with the same length and audio; use "minimax-h3-fasth3-i2v-turbo-2stage" for one endpoint image and "minimax-h3-fasth3-flf2v-turbo-2stage" for required first-and-last frames. Its targetResolution names the delivered class: 1080 (544px canvas, 960x544 delivers 1920x1088), 1440 or omitted for 2K (768p canvas, 1344x768 delivers 2688x1536), or 720 (384px canvas, 672x384 delivers 1344x768).'
  );
}

const h3LoraSelectorsByTool = {
  generate_video: [
    'minimax-h3-t2v',
    'minimax-h3-t2v-turbo',
    'minimax-h3-fasth3-t2v-turbo',
    'minimax-h3-fasth3-t2v-turbo-2stage',
    'minimax-h3-t2v-balanced',
    'minimax-h3-r2v',
    'minimax-h3-r2v-turbo',
    'minimax-h3-r2v-balanced',
    'minimax-h3-r2v-2stage',
    'minimax-h3-r2v-balanced-2stage',
    'minimax-h3-turbo',
    'minimax-h3-fasth3-turbo',
    'minimax-h3-fasth3-turbo-2stage',
    'minimax-h3-balanced'
  ],
  animate_photo: [
    'minimax-h3-i2v',
    'minimax-h3-i2v-turbo',
    'minimax-h3-fasth3-i2v-turbo',
    'minimax-h3-fasth3-i2v-turbo-2stage',
    'minimax-h3-i2v-balanced',
    'minimax-h3-flf2v',
    'minimax-h3-flf2v-turbo',
    'minimax-h3-fasth3-flf2v-turbo',
    'minimax-h3-fasth3-flf2v-turbo-2stage',
    'minimax-h3-flf2v-balanced'
  ]
};
for (const [toolName, selectors] of Object.entries(h3LoraSelectorsByTool)) {
  const tool = manifest.tools?.find((candidate) => candidate?.function?.name === toolName);
  const loras = tool?.function?.parameters?.properties?.loras;
  if (!loras?.description) continue;
  const paragraphs = loras.description.split('\n\n');
  const acceptedIndex = paragraphs.findIndex((paragraph) =>
    paragraph.startsWith('Accepted only when videoModel is one of')
  );
  if (acceptedIndex === -1) continue;
  paragraphs[acceptedIndex] =
    `Accepted only when videoModel is one of ${selectors.map((selector) => `"${selector}"`).join(', ')}. ` +
    'Every other video model on this tool loads no LoRAs and silently ignores these arrays, so set videoModel to an H3 mode in the same call when the user asks for one.';
  loras.description = paragraphs.join('\n\n');
}

// Wan 3 ships as one exact selector across its supported generation workflows.
// Video references are loose conditioning through generate_video; the provider
// has no video-to-video edit/extend task mode.
for (const toolName of ['animate_photo', 'sound_to_video']) {
  const tool = manifest.tools?.find((candidate) => candidate?.function?.name === toolName);
  const model = tool?.function?.parameters?.properties?.videoModel;
  if (!model) continue;
  model.enum = [...new Set([
    ...(Array.isArray(model.enum) ? model.enum : []),
    'wan3.0-video',
    'wan3.0-spicy-video'
  ])];
}

const banner = `// AUTO-GENERATED by scripts/generate-hosted-tools-manifest.mjs.
// Do not edit by hand. Re-run \`npm run codegen\` after updating
// @sogni-ai/sogni-protocol.
/* eslint-disable */
`;

const body = `\nexport const SOGNI_HOSTED_TOOLS_MANIFEST: unknown = ${JSON.stringify(manifest, null, 2)};\n`;

await writeFile(outFile, `${banner}${body}`, 'utf8');

console.log(`[generate-hosted-tools-manifest] wrote ${outFile}`);
