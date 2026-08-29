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

const audioModelIds = [
  'ace_step_1.5_xl_turbo',
  'ace_step_1.5_xl_sft',
  'ace_step_1.5_turbo',
  'ace_step_1.5_sft',
  'minimax_music3'
];

// @sogni-ai/sogni-protocol@1.0.0-alpha.6 still exposes legacy generate_music
// selectors ("turbo", "sft"). The SDK accepts canonical model IDs only, so keep
// the generated tool schema aligned with SDK routing until protocol catches up.
const generateMusicTool = manifest.tools?.find((tool) => tool?.function?.name === 'generate_music');
const generateMusicModel = generateMusicTool?.function?.parameters?.properties?.model;
if (generateMusicModel) {
  generateMusicModel.enum = audioModelIds;
  generateMusicModel.description =
    'Canonical music model ID. Default: ace_step_1.5_xl_turbo. ' +
    'Use minimax_music3 (MiniMax Music 3, premium autoregressive composer, ~20x cost, duration is a ceiling) ' +
    'when the user asks for the best quality, realistic vocals, or full songs. ' +
    'Use ace_step_1.5_xl_sft only when the user explicitly requests XL SFT. ' +
    'Use legacy ace_step_1.5_turbo or ace_step_1.5_sft only when the user explicitly requests a legacy model.';
}

const MINIMAX_H3_PDD_SOURCE_URL = 'https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs';
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
      'minimax-h3-balanced',
      'minimax-h3-t2v-balanced',
      'minimax-h3-r2v-balanced',
      'wan3.0-video',
      'wan3.0-spicy-video'
    ])
  ];
  generateVideoModel.description = appendDescriptionOnce(
    generateVideoModel.description,
    `MiniMax H3 Balanced uses Alibaba PAI Parallel Decoding Distillation (PDD) for fixed 8-step generation between 4-step Turbo and 20-step Standard; use "minimax-h3-balanced" or "minimax-h3-t2v-balanced" for FL2VA text-to-video and "minimax-h3-r2v-balanced" for Ref2VA reference-to-video. PDD source: ${MINIMAX_H3_PDD_SOURCE_URL}.`
  );
}

const animatePhotoTool = manifest.tools?.find((tool) => tool?.function?.name === 'animate_photo');
const animatePhotoModel = animatePhotoTool?.function?.parameters?.properties?.videoModel;
if (animatePhotoModel) {
  animatePhotoModel.enum = [
    ...new Set([
      ...(Array.isArray(animatePhotoModel.enum) ? animatePhotoModel.enum : []),
      'minimax-h3-i2v-balanced',
      'minimax-h3-flf2v-balanced'
    ])
  ];
  animatePhotoModel.description = appendDescriptionOnce(
    animatePhotoModel.description,
    `MiniMax H3 Balanced uses Alibaba PAI Parallel Decoding Distillation (PDD) for fixed 8-step generation; use "minimax-h3-i2v-balanced" for one endpoint image and "minimax-h3-flf2v-balanced" for required first-and-last frames. PDD source: ${MINIMAX_H3_PDD_SOURCE_URL}.`
  );
}

const h3LoraSelectorsByTool = {
  generate_video: [
    'minimax-h3-t2v',
    'minimax-h3-t2v-turbo',
    'minimax-h3-t2v-balanced',
    'minimax-h3-r2v',
    'minimax-h3-r2v-turbo',
    'minimax-h3-r2v-balanced',
    'minimax-h3-turbo',
    'minimax-h3-balanced'
  ],
  animate_photo: [
    'minimax-h3-i2v',
    'minimax-h3-i2v-turbo',
    'minimax-h3-i2v-balanced',
    'minimax-h3-flf2v',
    'minimax-h3-flf2v-turbo',
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
