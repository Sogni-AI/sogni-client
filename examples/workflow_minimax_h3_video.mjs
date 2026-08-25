#!/usr/bin/env node
/**
 * MiniMax H3 Video Workflow (t2v / i2v / flf2v / r2v)
 *
 * MiniMax H3 generates video and 32kHz stereo audio jointly in a single pass on
 * Sogni. t2v, i2v, and flf2v share the FL2VA checkpoint; r2v is a separate
 * Ref2VA checkpoint that conditions on labelled reference material rather than
 * on frame anchors. Standard H3 uses fixed 24fps, 20 steps, guidance 1, and
 * res_multistep/simple. FL2VA Turbo uses fixed 24fps, 4 steps, guidance 1, and
 * its validated sampler set with the simple scheduler. Ref2VA Turbo uses its
 * dedicated four-step LoRA with Euler/simple and a 960x544 default. Frames sit on the
 * 124 + n*17 grid (124-362 frames, 5.167s to 15.083s) and the canvas uses a
 * 32px grid capped at 1032192 pixels, which is why 1344x768 and 768x1344 are
 * the two shipped presets. Availability depends on current compatible
 * capacity. Sogni's open-weights H3 is 768p-class; MiniMax's 2K stage is
 * hosted-only and is not part of the open release.
 *
 * ## How to prompt H3: use MiniMax's official Context-IR format
 *
 * MiniMax's official prompt-writing skill calls Context-IR critical to quality.
 * Source: https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438/skills/h3-prompt-writing
 * T2VA, I2VA, L2VA, and FL2VA use these fields in this exact order:
 *
 *   integrated_multimodal_description: [Shot 1] ...
 *   overall_soundscape: ...
 *   non_diegetic_music: ...
 *
 * I2VA, L2VA, and FL2VA also require their mode-specific alignment instruction
 * as the first line, followed by one blank line. `[Shot 1]` has no timestamp; later
 * shots begin `[Shot N] At MM:SS.mmm, ...`. Speakers keep stable `(S1)` IDs and
 * user-supplied dialogue stays exact inside `<d>[Language] ...</d>`; author a
 * concise line only when the request explicitly asks for speech without words.
 * Soundscape contains
 * ambience, action, and non-verbal sounds but not dialogue or music.
 * `non_diegetic_music` describes audience-only score, or `N/A` when absent.
 *
 * Ref2VA uses six ordered sections instead: `subject_definitions`, `summary`,
 * `retention_analysis`, `detailed_description`, `overall_soundscape`, and
 * `non_diegetic_music`. References must keep stable `<Subject N>`, `<Picture N>`,
 * `<Video N>`, and `<Audio N>` meanings across all sections. Ref2VA requires at
 * least one visual reference (an image OR video); audio alone is invalid.
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_minimax_h3_video.mjs                              # Interactive, t2v
 *   node workflow_minimax_h3_video.mjs --mode t2v --no-interactive  # Example t2v prompt
 *   node workflow_minimax_h3_video.mjs --mode i2v --image start.jpg
 *   node workflow_minimax_h3_video.mjs --mode i2v --end-image finish.jpg
 *   node workflow_minimax_h3_video.mjs --mode i2v --image start.jpg --end-image finish.jpg
 *   node workflow_minimax_h3_video.mjs --mode flf2v --image start.jpg --end-image end.jpg
 *   node workflow_minimax_h3_video.mjs --mode r2v --ref-image face.jpg --ref-image jacket.jpg --ref-image street.jpg
 *   node workflow_minimax_h3_video.mjs --mode flf2v --print-prompt  # Print prompt, do not submit
 *   node workflow_minimax_h3_video.mjs --mode t2v --prompt-file my_prompt.txt
 *   node workflow_minimax_h3_video.mjs --mode t2v --no-audio        # Strip audio before upload
 */

import { SogniClient } from '../dist/index.js';
import * as fs from 'node:fs';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  loadCredentials,
  loadTokenTypePreference,
  saveTokenTypePreference
} from './credentials.mjs';
import {
  MODELS,
  MINIMAX_H3_FPS,
  MINIMAX_H3_FRAME_STEP,
  MINIMAX_H3_BASE_FRAMES,
  MINIMAX_H3_MIN_FRAMES,
  MINIMAX_H3_MAX_FRAMES,
  MINIMAX_H3_MIN_DURATION,
  MINIMAX_H3_MAX_DURATION,
  MINIMAX_H3_MAX_REFERENCE_IMAGES,
  MINIMAX_H3_MAX_REFERENCE_VIDEOS,
  MINIMAX_H3_MAX_REFERENCE_AUDIOS,
  MINIMAX_H3_MAX_REFERENCE_FILES,
  snapMinimaxH3Frames,
  askQuestion,
  askMultilinePrompt,
  pickImageFile,
  processImageForVideo,
  readFileAsBuffer,
  log,
  formatDuration,
  displayConfig,
  getUniqueFilename,
  generateVideoFilename,
  generateRandomSeed,
  defaultExamplesOutputDir,
  displaySafeContentFilterMessage,
  isSensitiveContentError,
  defaultBillingMode,
  parseBillingModeArg,
  billingModeHelpText,
  billingModeLabel,
  shouldCheckTokenBalance
} from './workflow-helpers.mjs';

const streamPipeline = promisify(pipeline);
const execFileAsync = promisify(execFile);

const MODES = ['t2v', 'i2v', 'flf2v', 'r2v'];

// Shipped canvas presets. Both are 1032192 pixels exactly, which is the cap.
const RESOLUTION_PRESETS = {
  landscape: { width: 1344, height: 768 },
  portrait: { width: 768, height: 1344 }
};

const H3_DIMENSION_STEP = 32;
const H3_MAX_PIXELS = 1032192;

// Default duration lands on 192 frames (124 + 4*17), which is exactly 8.00s.
// Picked deliberately: it divides cleanly into the timed beats of the example
// prompts below, and it renders exactly in the two-decimal duration slot of the
// required duration-aware L2VA/FL2VA alignment lines.
const DEFAULT_DURATION = 8;

// ============================================
// Required MiniMax Context-IR instructions
// ============================================

/** MiniMax's required I2VA alignment line, verbatim from the official guide. */
const I2V_ALIGNMENT_LINE =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';

/**
 * MiniMax's required L2VA alignment line for a last-frame-only request.
 * @param {number} durationSeconds - Effective video duration
 * @param {number} finalShotIndex - Index N of the final shot
 * @returns {string} The alignment line
 */
function l2vAlignmentLine(durationSeconds, finalShotIndex = 1) {
  return (
    'How the reference pictures align with the target video — ' +
    `<Picture 1> (from [Shot ${finalShotIndex}]) aligns with the ${durationSeconds.toFixed(2)}-second mark of the target video.`
  );
}

/**
 * MiniMax's required FL2VA alignment line.
 *
 * Note it differs from the I2VA line in three ways that are easy to get wrong:
 * Picture and Shot are bare (no angle or square brackets), the separator is a
 * U+2014 em dash surrounded by spaces, and the second clause carries the
 * effective duration to exactly two decimals. FL2VA generally favors a single
 * shot, so the final shot index is normally 1.
 * @param {number} durationSeconds - Effective video duration
 * @param {number} finalShotIndex - Index N of the final shot
 * @returns {string} The alignment line
 */
function flf2vAlignmentLine(durationSeconds, finalShotIndex = 1) {
  return (
    'How the reference pictures align with the target video — ' +
    'Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; ' +
    `Picture 2 (from Shot ${finalShotIndex}) aligns with the ${durationSeconds.toFixed(2)}-second mark of the target video.`
  );
}

// ============================================
// Example prompts: official MiniMax Context-IR
// ============================================

// The examples are written for the 8-second default (192 frames). If you change
// --duration or --frames, update later-shot MM:SS.mmm cut times accordingly.

/**
 * T2VA begins directly with the three required fields. Shot 1 has no timestamp;
 * every later shot has a strictly increasing MM:SS.mmm cut time.
 */
const T2V_PROMPT = `integrated_multimodal_description: [Shot 1] Live-action cinematic footage on 35mm with an anamorphic lens and shallow depth of field. A medium-wide shot frames two railway engineers beside a stopped commuter train on a rain-slick service platform under sodium lamps. The camera pushes in with small amplitude at slow speed. The older engineer in a reflective orange vest, with a low gravelly voice (S1), wipes rain from a clipboard, taps it twice, and says: <d>[English] The eastbound line is clear, but we hold here until the signal turns.</d>
[Shot 2] At 00:02.000, the camera cuts to the younger engineer in a dark blue jacket leaning from the open carriage door, one hand on the handrail. The younger engineer, with a bright quick voice (S2), answers: <d>[English] Copy that. I'll keep the doors shut.</d>
[Shot 3] At 00:04.000, the shot cuts to a low-angle close-up of the signal mast against the black sky. Water beads along the housing as the lamp switches from red to green. The camera tilts down with small amplitude at slow speed to reveal both engineers walking toward the front of the train.
[Shot 4] At 00:06.000, the shot cuts to a static wide composition as the train's marker lights brighten. The engineers (S1,S2) glance at each other and say together, <d>[English] That's our green.</d> The frame contains no on-screen text, subtitles, logos, or watermarks.

overall_soundscape: Steady rain drums on the metal carriage roofs above a low electrical hum. Boots splash through shallow puddles, pressure hisses beneath the train, and the signal relay closes with a dull metallic clunk.

non_diegetic_music: Sparse low piano at a slow tempo, joined by a soft low-frequency beat at 00:04.000 and fading after the final line.`;

/**
 * I2VA's alignment instruction is added by defaultPromptForMode. Its core body
 * uses the same three ordered fields as T2VA.
 */
const I2V_PROMPT = `integrated_multimodal_description: [Shot 1] Live-action, cinematic. The young woman shown in <Picture 1> remains at the record-store counter in the exact opening composition, preserving her face, dark wavy hair, brown jacket, the turntable, and the dense rows of album sleeves. The camera pushes in with small amplitude at slow speed as she lifts a vinyl record from its paper sleeve, checks its surface under the warm pendant light, and places it carefully on the turntable. The quiet young woman with a close, dry voice (S1) looks toward the customer beyond the camera and says: <d>[English] This pressing has been waiting here since Tuesday.</d> She lowers the stylus, listens for the first note, and gives a restrained smile while the framing, lighting direction, and fine shelf detail remain consistent with <Picture 1>. No new people enter and no visible text is added.

overall_soundscape: Low record-store room tone and rain against the front window continue throughout. The paper sleeve rustles, the vinyl settles onto the platter, and the tonearm produces a soft mechanical click followed by faint surface noise.

non_diegetic_music: N/A`;

/**
 * L2VA converges on Picture 1 as the final frame. Its duration-specific
 * alignment instruction is added by defaultPromptForMode.
 */
const L2V_PROMPT = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, one continuous shot inside a densely stocked independent record store. A young woman with dark wavy hair and a brown jacket stands behind the counter beneath warm pendant lights as rain moves down the front window. The camera pulls out with small amplitude at slow speed while she lifts a vinyl record from the turntable, holds it by the edges, and slides it into a paper sleeve. The woman with a close, dry voice (S1) looks toward a customer beyond the camera and says: <d>[English] This pressing has been waiting here since Tuesday.</d> She turns toward the wooden record bins, parts two album sleeves with one hand, and inserts the record. Her movement gradually settles as the camera, her face and hands, the sleeve, the turntable, the dense rows of cover art, the pendant-light reflections, and every background spacing detail converge on the exact final pose and composition established by <Picture 1>. No new person enters, no cut or dissolve occurs, and the final moment lands precisely on <Picture 1>.

overall_soundscape: Low record-store room tone continues beneath steady rain against the front window. The paper sleeve rustles, shoes scuff softly on the wooden floor, and cardboard brushes against neighboring record jackets before the movement becomes still.

non_diegetic_music: N/A`;

/**
 * FL2VA uses one continuous shot and reaches Picture 2 at the exact end. Its
 * duration-specific alignment instruction is added by defaultPromptForMode.
 */
const FLF2V_PROMPT = `integrated_multimodal_description: [Shot 1] Live-action, cinematic, one continuous shot inside a densely stocked independent record store. The young woman begins in the exact pose, spacing, wardrobe, warm pendant lighting, and camera composition established by Picture 1. The camera pulls out with small amplitude at slow speed as she shifts her weight naturally, slides one hand beneath a vinyl record, and lifts it from the turntable without changing its orientation abruptly. Her arms follow a smooth physical arc while the album sleeves, counter objects, and rain-lit front window retain stable fine detail. The woman with a warm unhurried voice (S1) says: <d>[English] Give it another second, it's almost there.</d> She turns gradually toward the final eyeline, carries the record to the shelf, and settles it between two sleeves. The camera distance, hand position, head angle, light, and background spacing progressively converge on Picture 2, reaching its exact pose and composition at the end of the shot. There is no cut, morph, dissolve, or crossfade.

overall_soundscape: Low record-store ambience continues beneath rain tapping the front window. Clothing rustles, shoes scuff softly on the wooden floor, the record sleeve brushes against its neighbors, and the movement ends with a quiet cardboard contact sound.

non_diegetic_music: A single slow ascending synthesizer figure narrows to one sustained tone and fades as the shot reaches Picture 2.`;

/**
 * Build an official six-section Ref2VA example whose labels match the supplied
 * media types. With no reported references (for --print-prompt), it shows a
 * one-picture example. Images used only for reusable identity/style become
 * <Subject N>; <Picture N> is not misused as a keyframe anchor.
 */
function r2vPromptForReferences(references = {}) {
  const reportedImages = Math.max(0, references.images ?? 0);
  const reportedVideos = Math.max(0, references.videos ?? 0);
  const reportedAudios = Math.max(0, references.audios ?? 0);
  const soundtrackedVideoIndices = [...new Set(references.soundtrackedVideoIndices ?? [])]
    .filter((index) => Number.isInteger(index) && index >= 1 && index <= reportedVideos)
    .sort((a, b) => a - b);
  const soundtrackOrdinalByVideo = new Map(
    soundtrackedVideoIndices.map((videoIndex, audioIndex) => [videoIndex, audioIndex + 1])
  );
  const imageCount = reportedImages || reportedVideos ? reportedImages : 1;
  const primarySource = imageCount > 0 ? '<Picture 1>' : '<Video 1>';
  const subjectDefinitions = [
    `<Subject 1> is the lead woman whose face, dark wavy hair, and brown jacket come from ${primarySource}.`
  ];
  const retention = [
    '<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - her facial identity, dark wavy hair, and brown jacket remain consistent throughout.'
  ];

  for (let index = 2; index <= imageCount; index++) {
    subjectDefinitions.push(
      `<Subject ${index}> is the record-store environment and fine visual detail sourced from <Picture ${index}>, including the warm pendant lights, wooden record bins, album sleeves, turntable, and rain-covered front window.`
    );
    retention.push(
      `<Subject ${index}> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved - the store layout, lighting palette, record bins, album sleeves, turntable, and wet window are retained.`
    );
  }
  for (let index = 1; index <= reportedVideos; index++) {
    subjectDefinitions.push(
      index === 1 && imageCount === 0
        ? '<Video 1> is a reference for handheld camera movement, blocking, and temporal rhythm; its lead performer is separately tracked as <Subject 1>, while its other cast and location are not reused.'
        : `<Video ${index}> is a reference for handheld camera movement, blocking, and temporal rhythm; its cast, wardrobe, and location are not reused.`
    );
    retention.push(
      `<Video ${index}> (camera movement and temporal rhythm): weak_reference - only the handheld movement, blocking cadence, and pacing are followed.`
    );
    const soundtrackOrdinal = soundtrackOrdinalByVideo.get(index);
    if (soundtrackOrdinal) {
      subjectDefinitions.push(
        `<Audio ${soundtrackOrdinal}> is the synchronized soundtrack from <Video ${index}>; its ambience, rhythm, and sound texture guide the target audio without copying the original signal.`
      );
      retention.push(
        `<Audio ${soundtrackOrdinal}>: reference - its ambience, rhythm, and sound texture guide the target audio without copying the original signal.`
      );
    }
  }
  for (let index = 1; index <= reportedAudios; index++) {
    const audioOrdinal = soundtrackedVideoIndices.length + index;
    subjectDefinitions.push(
      `<Audio ${audioOrdinal}> is a voice-timbre and measured-delivery reference for <Subject 1> (S1); its original signal and spoken words are not copied.`
    );
    retention.push(
      `<Audio ${audioOrdinal}>: reference - its voice timbre and measured delivery guide the performance without copying the original signal or words.`
    );
  }

  const environmentSubject = imageCount >= 2 ? ' The setting follows <Subject 2>.' : '';
  const videoDirection =
    reportedVideos > 0
      ? ' The camera movement and blocking rhythm weakly reference <Video 1> without copying its people or location.'
      : '';
  const voiceDirection =
    reportedAudios > 0
      ? ` Her close, measured delivery references <Audio ${soundtrackedVideoIndices.length + 1}> without copying its original signal or words.`
      : '';
  const taskTypes =
    reportedAudios + soundtrackedVideoIndices.length > 0
      ? 'reference generation + audio reference'
      : 'reference generation';

  return `subject_definitions:
${subjectDefinitions.join('\n')}

summary:
[${taskTypes}] The target video follows <Subject 1> through a three-shot interaction in a densely stocked independent record store.${environmentSubject}${videoDirection}${voiceDirection}

retention_analysis:
${retention.join('\n')}

detailed_description:
The target video uses a live-action cinematic style with warm practical lighting, natural skin texture, controlled 35mm film grain, and crisp fine detail across album sleeves, wood grain, glass reflections, and the turntable.
[Shot 1] A medium-wide shot establishes the narrow independent record store during a rainstorm. Wooden bins packed with individually visible record sleeves run toward the front window, warm pendant lamps reflect in the wet glass, and a turntable sits on the counter. <Subject 1> (S1), preserving the facial identity, dark wavy hair, and brown jacket defined by ${primarySource}, stands behind the counter holding a vinyl record by its edges.${environmentSubject}${videoDirection} The camera pushes in with small amplitude at slow speed as she rotates the record under the pendant light, checks its surface, and slides it carefully into a paper sleeve.
[Shot 2] At 00:03.000, the camera cuts to a close shot of <Subject 1> (S1) lowering the record onto the turntable. Her fingertips remain anatomically stable as she guides the tonearm toward the outer groove. She listens to the first soft crackle, looks toward a customer beyond the camera, and says in a close measured voice, <d>[English] This pressing has been waiting here since Tuesday.</d>${voiceDirection} She closes her lips after the line, steadies the sleeve against the counter, and gives a restrained smile while the background shelves remain coherent.
[Shot 3] At 00:06.000, the shot cuts to a low tracking view moving beside <Subject 1> as she carries the sleeved record along the aisle. Fine cover art remains legible as distinct visual shapes without inventing readable text. She stops at a wooden bin, parts two sleeves with one hand, inserts the record between them, and taps the top edge until it aligns with its neighbors. The camera settles into a static medium composition that holds her, the dense shelves, the glowing lamps, and rain moving down the front glass. No extra person enters, and no subtitles, logos, or new on-screen text appear.

overall_soundscape:
Low record-store room tone continues beneath steady rain against the front window. Paper sleeves rustle, vinyl touches the platter, the tonearm mechanism clicks, faint surface noise emerges from the speakers, and shoes move softly across the wooden floor.

non_diegetic_music:
Sparse upright-bass notes at a slow tempo enter after 00:06.000 and remain low beneath the final shot.`;
}

/**
 * Pick the official example prompt for a mode.
 *
 * @param {string} mode - t2v, i2v, flf2v, or r2v
 * @param {number} durationSeconds - Effective duration, used by L2VA/FL2VA lines
 * @param {Object} references - Reported Ref2VA reference counts
 * @param {string} framePromptMode - t2v, i2v, l2v, flf2v, or r2v prompt contract
 * @returns {string} The complete prompt
 */
function defaultPromptForMode(mode, durationSeconds, references = {}, framePromptMode = mode) {
  if (framePromptMode === 'i2v') {
    return `${I2V_ALIGNMENT_LINE}\n\n${I2V_PROMPT}`;
  }
  if (framePromptMode === 'l2v') {
    return `${l2vAlignmentLine(durationSeconds)}\n\n${L2V_PROMPT}`;
  }
  if (framePromptMode === 'flf2v') {
    return `${flf2vAlignmentLine(durationSeconds)}\n\n${FLF2V_PROMPT}`;
  }
  if (mode === 'r2v') {
    return r2vPromptForReferences(references);
  }
  return T2V_PROMPT;
}

/** Resolve the official prompt contract from the endpoint assets on an i2v id. */
function resolveFramePromptMode(mode, hasFirstFrame, hasLastFrame) {
  if (mode === 'flf2v') return 'flf2v';
  if (mode !== 'i2v') return mode;
  if (hasFirstFrame && hasLastFrame) return 'flf2v';
  if (hasLastFrame) return 'l2v';
  return 'i2v';
}

/**
 * Detect which uploaded reference videos will contribute an H3 `<Audio N>`
 * item. The worker preserves each present soundtrack and presents those audio
 * items before standalone references, so prompt ordinals must include them.
 *
 * If ffprobe cannot inspect a file, assume it is soundtracked. That avoids the
 * more damaging failure mode where `<Audio 1>` accidentally binds a standalone
 * voice role to an earlier video soundtrack.
 */
async function detectSoundtrackedReferenceVideos(videoPaths) {
  const detected = [];
  for (const [index, videoPath] of videoPaths.entries()) {
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=index',
          '-of',
          'csv=p=0',
          videoPath
        ],
        { encoding: 'utf8' }
      );
      if (stdout.trim()) detected.push(index + 1);
    } catch {
      detected.push(index + 1);
      log(
        '⚠️',
        `Could not inspect reference video ${index + 1} with ffprobe; assuming it has a soundtrack for safe <Audio N> numbering.`
      );
    }
  }
  return detected;
}

// ============================================
// Prompt contract review
// ============================================

/**
 * How long a video can run before a single untimed shot deserves a reminder.
 */
const TIMED_BEATS_RECOMMENDED_ABOVE_SECONDS = 8;

/**
 * Modes where an untimed prompt is a deliberate choice, not an oversight.
 *
 * MiniMax documents FL2VA as favouring a single continuous shot between the two
 * anchor frames - the whole job is one unbroken path from the first image to
 * the last - so a flf2v prompt with no timed beats is following their guide
 * rather than missing something. Warning about it there was simply wrong.
 */
const SINGLE_SHOT_MODES = new Set(['flf2v', 'l2v']);

/**
 * Advisory only: does the prompt say outright that it is one continuous take?
 *
 * Used for r2v, where either shape is valid - a timed shot list, or one uncut
 * causal chain the prose commits to explicitly. Nothing here changes what is
 * sent; a false negative costs one extra advisory line.
 *
 * The continuity adjectives have to land on a take/shot/sequence within a few
 * words, so "a low continuous room ambience" in an audio direction does not
 * read as a camera instruction.
 */
const SINGLE_CONTINUOUS_SHOT_PATTERN =
  /\b(?:continuous|unbroken|uninterrupted)[\s-](?:\w+[\s-]){0,3}?(?:take|shot|sequence)\b|\b(?:single|one)[\s-](?:take|shot)\b|\boner\b|\bdo(?:es)? not cut\b|\bno cuts?\b|\bnever cuts?\b|\bwithout cutting\b/i;

/**
 * Advisory only: does the prompt address at least one numbered reference?
 *
 * The official Ref2VA contract uses the exact tags `<Picture 1>`, `<Video 1>`,
 * and `<Audio 1>`; prose aliases do not define stable reference labels.
 */
const NUMBERED_REFERENCE_PATTERN = /<(?:Picture|Video|Audio)\s+\d+>/;

/**
 * Prompt length limit for H3, matching what fal.ai documents for the model.
 * Full production briefs (timed shot list + reference assignments + audio
 * direction) fit comfortably; the server-side 4096-char clamp is audio-only
 * and does not apply to video prompts.
 */
const PROMPT_CHAR_LIMIT = 7000;

/**
 * Collect official later-shot cut times from `[Shot N] At MM:SS.mmm, ...`.
 *
 * @param {string} prompt - The prompt to scan
 * @returns {number[]} Beat end times in seconds
 */
function findTimedBeats(prompt) {
  const beats = [0];
  const pattern = /\[Shot\s+\d+\]\s+At\s+(\d{2}):(\d{2}(?:\.\d{3})),/g;
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    beats.push(Number(match[1]) * 60 + Number(match[2]));
  }
  return beats;
}

function fieldsAppearInOrder(prompt, fields) {
  let previousIndex = -1;
  for (const field of fields) {
    const index = prompt.indexOf(`${field}:`);
    if (index < 0 || index <= previousIndex) return false;
    previousIndex = index;
  }
  return true;
}

function fieldValue(prompt, name) {
  return new RegExp(`^${name}:[ \\t]*([\\s\\S]*?)(?=^[a-z][a-z0-9_]*:|$)`, 'm')
    .exec(prompt)?.[1]?.trim() ?? '';
}

const REF2VA_TASK_TYPES = new Set([
  'keyframe completion',
  'reference generation',
  'video editing',
  'video continuation',
  'audio reuse',
  'audio reference'
]);

/**
 * Review a prompt and return advisory warnings.
 *
 * The worker accepts an arbitrary string, but MiniMax's official skill defines
 * a strict Context-IR contract. These checks flag a prompt that does not follow
 * the mode's required section order, alignment line, shot syntax, or audio
 * separation.
 *
 * @param {string} prompt - The prompt to review
 * @param {number} durationSeconds - Effective video duration
 * @param {string} mode - t2v, i2v, l2v, flf2v, or r2v prompt contract
 * @param {Object} [references] - Attached r2v references
 * @param {number} [references.images] - Reference images attached
 * @param {number} [references.videos] - Reference videos attached
 * @param {number} [references.audios] - Reference audio clips attached
 * @returns {string[]} Warnings, empty when nothing looks off
 */
function reviewPrompt(prompt, durationSeconds, mode, references = {}) {
  const warnings = [];
  const beats = findTimedBeats(prompt);

  const baseFields = [
    'integrated_multimodal_description',
    'overall_soundscape',
    'non_diegetic_music'
  ];
  const refFields = [
    'subject_definitions',
    'summary',
    'retention_analysis',
    'detailed_description',
    'overall_soundscape',
    'non_diegetic_music'
  ];
  if (!fieldsAppearInOrder(prompt, mode === 'r2v' ? refFields : baseFields)) {
    warnings.push(
      mode === 'r2v'
        ? `Ref2VA requires these fields in order: ${refFields.join(', ')}.`
        : `H3 Base requires these fields in order: ${baseFields.join(', ')}.`
    );
  }
  if (mode === 'i2v' && !prompt.startsWith(`${I2V_ALIGNMENT_LINE}\n\n`)) {
    warnings.push('I2VA requires its exact image-alignment instruction as the first line.');
  }
  if (
    mode === 'l2v' &&
    !prompt.startsWith('How the reference pictures align with the target video — <Picture 1> ')
  ) {
    warnings.push('L2VA requires its exact last-frame alignment instruction as the first line.');
  }
  if (
    mode === 'flf2v' &&
    !prompt.startsWith('How the reference pictures align with the target video — ')
  ) {
    warnings.push(
      'FL2VA requires its exact first/last-frame alignment instruction as the first line.'
    );
  }
  if (!prompt.includes('[Shot 1]')) {
    warnings.push('The main description must begin its timeline with [Shot 1] and no timestamp.');
  }
  if (/\[Shot 1\]\s+At\s+/.test(prompt)) {
    warnings.push('[Shot 1] must not have a timestamp.');
  }
  if (/<\|[^>]+\|>/.test(prompt)) {
    warnings.push('Do not author tokenizer-internal <|...|> controls; use <d>, </d>, <scenetrans>, and <cutoff>.');
  }
  const shotMatches = [...prompt.matchAll(/\[Shot\s+(\d+)\](?:\s+At\s+(\d{2}):(\d{2})\.(\d{3}),)?/g)];
  shotMatches.forEach((match, index) => {
    if (Number(match[1]) !== index + 1) {
      warnings.push('Shot numbers must be contiguous and start at [Shot 1].');
    }
    if (index > 0 && match[2] === undefined) {
      warnings.push(`[Shot ${match[1]}] must use "At MM:SS.mmm," syntax.`);
    }
  });
  const shotTimes = shotMatches.slice(1).flatMap((match) =>
    match[2] === undefined
      ? []
      : [Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000]
  );
  // Shot 1 is implicitly at zero even though its timestamp is omitted.
  if (shotTimes.some((time, index) => time <= (index === 0 ? 0 : shotTimes[index - 1]))) {
    warnings.push('Later-shot timestamps must be strictly increasing.');
  }
  if (
    /\b(?:says?|asks?|replies?|shouts?|sings?)\b/i.test(prompt) &&
    !/<d>\[[^\]]+\][\s\S]*?<\/d>/.test(prompt)
  ) {
    warnings.push(
      'Spoken words require a stable (S1) speaker ID and exact `<d>[Language] ...</d>` markup.'
    );
  }

  // flf2v is single-shot by design; r2v is single-shot when the prose says so.
  const untimedIsIntentional =
    SINGLE_SHOT_MODES.has(mode) || (mode === 'r2v' && SINGLE_CONTINUOUS_SHOT_PATTERN.test(prompt));

  if (
    beats.length === 1 &&
    !untimedIsIntentional &&
    durationSeconds > TIMED_BEATS_RECOMMENDED_ABOVE_SECONDS
  ) {
    warnings.push(
      `Only Shot 1 is present, and this render is ${durationSeconds.toFixed(2)}s. If it is not one ` +
        'continuous shot, add later cuts as `[Shot N] At MM:SS.mmm, ...`.'
    );
  }

  if (mode === 'r2v') {
    const summary = fieldValue(prompt, 'summary');
    const taskPrefix = /^\[([^\]\n]+)\]\s+(\S[\s\S]*)$/.exec(summary);
    if (!taskPrefix) {
      warnings.push('Ref2VA summary must begin with a square-bracketed official task prefix.');
    } else {
      const tasks = taskPrefix[1].split(' + ');
      if (tasks.join(' + ') !== taskPrefix[1] || tasks.some((task) => !REF2VA_TASK_TYPES.has(task))) {
        warnings.push('Ref2VA summary tasks must use the official names joined exactly with " + ".');
      }
      if (new Set(tasks).size !== tasks.length) {
        warnings.push('Ref2VA summary task types must not be repeated.');
      }
      if (tasks.includes('video editing') && !taskPrefix[2].startsWith('The target video is an edited version of <Video 1>.')) {
        warnings.push('A video-editing summary must begin "The target video is an edited version of <Video 1>."');
      }
      if (tasks.some((task) => task === 'video editing' || task === 'video continuation')) {
        warnings.push('This example attaches loose video references, so it cannot promise video editing or continuation without a typed transformation relationship.');
      }
    }
    if (!NUMBERED_REFERENCE_PATTERN.test(prompt)) {
      warnings.push(
        'No numbered reference found. r2v conditions on labelled material, and an unassigned ' +
          'reference just gets averaged into everything. Give each one an explicit job, using the ' +
          'same tags the text encoder emits: ' +
          '"Use <Picture 1> for the face and hairstyle. Use <Picture 2> only for environment and lighting."'
      );
    }
    if (references.videos > 0 && !/\bvideo\s*#?\s*\d+/i.test(prompt)) {
      warnings.push(
        'A reference video is attached but the prompt never mentions <Video 1>. Say what it is ' +
          'for - "Use <Video 1> only for the camera movement" - or it competes with the images.'
      );
    }
    if (references.audios > 0 && !/\baudio\s*#?\s*\d+/i.test(prompt)) {
      warnings.push(
        'A reference audio clip is attached but the prompt never mentions <Audio 1>. Say whether ' +
          'it supplies the voice character, the music, or the ambience.'
      );
    }
    for (const [label, count] of [
      ['Picture', references.images ?? 0],
      ['Video', references.videos ?? 0],
      ['Audio', references.audios ?? 0]
    ]) {
      for (let index = 1; index <= count; index++) {
        if (!prompt.includes(`<${label} ${index}>`)) {
          warnings.push(`Attached <${label} ${index}> is missing an explicit prompt job.`);
        }
      }
    }
  }

  const lastBeat = Math.max(...beats);
  if (lastBeat > durationSeconds + 0.5) {
    warnings.push(
      `The prompt directs action out to ${lastBeat}s but the video is only ${durationSeconds.toFixed(2)}s. ` +
        'Rewrite the timecodes to fit, or raise --duration.'
    );
  }

  // H3 generates native 32kHz stereo audio before the optional upload-time
  // strip, so an undirected soundtrack is still one nobody chose whenever the
  // audio track is kept.
  const hasAudioDirection =
    /(^|\n)\s*(overall_soundscape|non_diegetic_music|audio|sound design|sound|sfx|soundscape|foley|music|bgm|score)\s*:/i.test(
      prompt
    ) ||
    /\b(ambien(?:ce|t)|soundscape|sound design|foley|sfx|room tone|voice-?over|music|silence)\b/i.test(
      prompt
    ) ||
    /\bsounds? of\b/i.test(prompt);
  if (!hasAudioDirection) {
    warnings.push(
      'No audio direction found. H3 generates native 32kHz stereo audio jointly with the video, ' +
        'so describe ambience, specific SFX, and music (with instrumentation and timing) - or say ' +
        'explicitly that there should be no music.'
    );
  }

  if (prompt.length > PROMPT_CHAR_LIMIT) {
    warnings.push(
      `Prompt is ${prompt.length} characters, over the ${PROMPT_CHAR_LIMIT}-character ` +
        `limit for H3. Trim it or split the concept across multiple clips.`
    );
  }

  return warnings;
}

// ============================================
// Frame / duration helpers
// ============================================

function clampDuration(durationSeconds) {
  return Math.min(MINIMAX_H3_MAX_DURATION, Math.max(MINIMAX_H3_MIN_DURATION, durationSeconds));
}

/**
 * Convert a frame count to a duration the SDK will snap back to that same
 * frame count. Clamping matters at both ends: 124/24 rounds just below the
 * documented minimum and 362/24 just above the documented maximum.
 *
 * @param {number} frames - A frame count on the H3 grid
 * @returns {number} Duration in seconds
 */
function durationForFrames(frames) {
  return clampDuration(frames / MINIMAX_H3_FPS);
}

function isValidH3FrameCount(frames) {
  return (
    Number.isInteger(frames) &&
    frames >= MINIMAX_H3_MIN_FRAMES &&
    frames <= MINIMAX_H3_MAX_FRAMES &&
    (frames - MINIMAX_H3_BASE_FRAMES) % MINIMAX_H3_FRAME_STEP === 0
  );
}

// ============================================
// Parse Command Line Arguments
// ============================================

function parseCliInteger(value, optionName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${optionName} requires a whole number; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseCliNumber(value, optionName) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} requires a finite number; received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    prompt: null,
    promptFile: null,
    mode: null,
    modelKey: null,
    image: null,
    endImage: null,
    refImages: [],
    refVideos: [],
    refAudios: [],
    width: null,
    height: null,
    portrait: false,
    duration: null,
    frames: null,
    batch: 1,
    seed: null,
    output: defaultExamplesOutputDir(),
    interactive: true,
    printPrompt: false,
    generateAudio: true,
    disableSafeContentFilter: false,
    billingMode: defaultBillingMode()
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (
      arg === '--billing-mode' ||
      arg === '--billing' ||
      arg === '--subscription' ||
      arg === '--tokens'
    ) {
      const billingModeIndex = parseBillingModeArg(args, i, options);
      if (billingModeIndex === null) {
        console.error('Missing value for --billing-mode');
        process.exit(1);
      }
      i = billingModeIndex;
    } else if (arg === '--no-interactive') {
      options.interactive = false;
    } else if (arg === '--mode' && args[i + 1]) {
      options.mode = args[++i].toLowerCase();
    } else if (arg === '--model' && args[i + 1]) {
      options.modelKey = args[++i];
    } else if ((arg === '--image' || arg === '--first-image') && args[i + 1]) {
      options.image = args[++i];
    } else if ((arg === '--end-image' || arg === '--last-image') && args[i + 1]) {
      options.endImage = args[++i];
    } else if (arg === '--ref-image' && args[i + 1]) {
      options.refImages.push(args[++i]);
    } else if (arg === '--ref-video' && args[i + 1]) {
      options.refVideos.push(args[++i]);
    } else if (arg === '--ref-audio' && args[i + 1]) {
      options.refAudios.push(args[++i]);
    } else if (arg === '--prompt-file' && args[i + 1]) {
      options.promptFile = args[++i];
    } else if (arg === '--width' && args[i + 1]) {
      options.width = parseCliInteger(args[++i], '--width');
    } else if (arg === '--height' && args[i + 1]) {
      options.height = parseCliInteger(args[++i], '--height');
    } else if (arg === '--portrait') {
      options.portrait = true;
    } else if (arg === '--landscape') {
      options.portrait = false;
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = parseCliNumber(args[++i], '--duration');
    } else if (arg === '--frames' && args[i + 1]) {
      options.frames = parseCliInteger(args[++i], '--frames');
    } else if (arg === '--batch' && args[i + 1]) {
      options.batch = parseCliInteger(args[++i], '--batch');
    } else if (arg === '--seed' && args[i + 1]) {
      options.seed = parseCliInteger(args[++i], '--seed');
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[++i];
    } else if (arg === '--print-prompt') {
      options.printPrompt = true;
      options.interactive = false;
    } else if (arg === '--alignment-line') {
      // Backwards-compatible no-op. Official I2VA/L2VA/FL2VA alignment is always included.
    } else if (arg === '--no-audio') {
      options.generateAudio = false;
    } else if (arg === '--audio') {
      options.generateAudio = true;
    } else if (arg === '--disable-safe-content-filter') {
      options.disableSafeContentFilter = true;
    } else if (arg === '--negative' || arg === '--negative-prompt') {
      console.error(
        'MiniMax H3 has no negative-prompt input. Put exclusions directly in the positive prompt.'
      );
      process.exit(1);
    } else if (!arg.startsWith('--') && !options.prompt) {
      options.prompt = arg;
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
MiniMax H3 Video Workflow

Usage:
  node workflow_minimax_h3_video.mjs                               # Interactive mode
  node workflow_minimax_h3_video.mjs --mode t2v --no-interactive   # Example t2v prompt
  node workflow_minimax_h3_video.mjs --mode i2v --image start.jpg
  node workflow_minimax_h3_video.mjs --mode i2v --end-image finish.jpg
  node workflow_minimax_h3_video.mjs --mode i2v --image start.jpg --end-image finish.jpg
  node workflow_minimax_h3_video.mjs --mode flf2v --image start.jpg --end-image end.jpg
  node workflow_minimax_h3_video.mjs --mode t2v --model minimax-h3-t2v-turbo
  node workflow_minimax_h3_video.mjs --mode r2v --ref-image face.jpg --ref-image jacket.jpg --ref-image street.jpg
  node workflow_minimax_h3_video.mjs --mode r2v --ref-video camera-move.mp4

Modes:
  t2v    Text-to-video                     (minimax-h3-fl2va-fp8_t2v)
  i2v    Endpoint-conditioned image-to-video (minimax-h3-fl2va-fp8_i2v, needs --image and/or --end-image)
  flf2v  First-and-last-frame video        (minimax-h3-fl2va-fp8_flf2v, needs --image and --end-image)
  r2v    Multi-reference video             (minimax-h3-ref2va-fp8_r2v, needs an image or video)

Fixed model parameters (not configurable):
  Standard: fps 24, steps 20, guidance 1, sampler res_multistep, scheduler simple
  FL2VA Turbo: fps 24, steps 4, guidance 1, server-selected sampler, scheduler simple
  Ref2VA Turbo: fps 24, steps 4, guidance 1, sampler Euler, scheduler simple
  Native 32kHz stereo audio is generated jointly and included by default;
  --no-audio returns a video without an audio track
  Frames follow 124 + n*17 in the range 124-362 (${MINIMAX_H3_MIN_DURATION}s to ${MINIMAX_H3_MAX_DURATION}s)
  Canvas uses a 32px grid, at most ${H3_MAX_PIXELS} pixels (1344x768 or 768x1344)
  Availability depends on current compatible capacity

Options:
  --mode <t2v|i2v|flf2v|r2v>  Workflow to run (default: t2v)
  --model <key>           Model key override (minimax-h3-t2v, minimax-h3-i2v,
                          minimax-h3-flf2v, minimax-h3-r2v, or the t2v/i2v/
                          flf2v keys ending in -turbo)
  --image <path>          First-frame reference image (i2v, flf2v)
  --end-image <path>      Last-frame reference image (i2v, flf2v)
  --ref-image <path>      Reference image (r2v, repeatable up to ${MINIMAX_H3_MAX_REFERENCE_IMAGES})
  --ref-video <path>      Reference video (r2v, repeatable up to ${MINIMAX_H3_MAX_REFERENCE_VIDEOS})
  --ref-audio <path>      Reference audio (r2v, repeatable up to ${MINIMAX_H3_MAX_REFERENCE_AUDIOS})
  --prompt-file <path>    Read the prompt from a file instead of using the example
  --portrait              Use the 768x1344 preset instead of 1344x768
  --width <px>            Custom width, multiple of 32
  --height <px>           Custom height, multiple of 32
  --duration <seconds>    ${MINIMAX_H3_MIN_DURATION}-${MINIMAX_H3_MAX_DURATION}, snapped to the frame grid (default: ${DEFAULT_DURATION})
  --frames <n>            Exact frame count on the 124 + n*17 grid; overrides --duration
  --batch <n>             Number of videos to generate (default: 1)
  --seed <n>              Random seed (default: random)
  --output <dir>          Output directory (default: ./output)
  --print-prompt          Print the assembled prompt and exit without submitting
  --alignment-line        Deprecated no-op; required I2VA/L2VA/FL2VA alignment is always included
  --no-audio              Strip the generated audio track before upload
  --audio                 Include generated audio (default)
  --negative [text]       Unsupported; exits with guidance to use the positive prompt
  --disable-safe-content-filter  Disable NSFW/safety filter
${billingModeHelpText()}
  --no-interactive        Skip interactive prompts
  --help                  Show this help message

Prompt format:
  T2VA, I2VA, L2VA, and FL2VA use these fields in this exact order:

    integrated_multimodal_description: [Shot 1] ...
    overall_soundscape: ...
    non_diegetic_music: ...

  I2VA, L2VA, and FL2VA require the exact mode-specific alignment instruction
  on the first line. Shot 1 has no timestamp. Later cuts use
  "[Shot N] At MM:SS.mmm, ...". Speakers keep stable (S1) IDs and user-supplied
  text is preserved exactly inside <d>[Language] ...</d>. Author a concise line
  only when the request explicitly asks for speech without supplying words.
  Keep dialogue and music out of
  overall_soundscape. Use non_diegetic_music: N/A when there is no audience-only
  score. State exclusions inside the positive prompt; H3 has no negative field.

Multi-reference video (--mode r2v):
  Ref2VA conditions on labelled reference material instead of frame anchors.
  The checkpoint accepts up to ${MINIMAX_H3_MAX_REFERENCE_IMAGES} reference images, ${MINIMAX_H3_MAX_REFERENCE_VIDEOS} reference videos (24fps,
  2-15s each), and ${MINIMAX_H3_MAX_REFERENCE_AUDIOS} reference audio clips (2-15s each), at most ${MINIMAX_H3_MAX_REFERENCE_FILES}
  reference files in total. Video references may total at most 15s, and audio
  references may separately total at most 15s.

  r2v runs on a Sogni worker rather than at a vendor, so every reference is
  uploaded through Sogni's asset path before the job is submitted.

  At least one visual reference is required: an image OR video. Audio alone is
  invalid. Repeat --ref-image up to ${MINIMAX_H3_MAX_REFERENCE_IMAGES} times; the SDK sends the first as
  referenceImage and the rest as contextImages, which upload to the numbered
  slots the worker feeds into ref_images.

  Repeat --ref-video and --ref-audio up to ${MINIMAX_H3_MAX_REFERENCE_VIDEOS} and ${MINIMAX_H3_MAX_REFERENCE_AUDIOS} times respectively. The SDK uploads each file to a distinct S3
  object. A reference video's own soundtrack is presented to the model and
  takes an <Audio N> ordinal before standalone --ref-audio clips. This example
  probes the files with ffprobe so its generated prompt uses the worker's exact
  numbering. Reference videos are read as 24fps; a clip at another frame rate
  plays back time-distorted.

  Ref2VA requires these six sections in exact order:

    subject_definitions:
    summary:
    retention_analysis:
    detailed_description:
    overall_soundscape:
    non_diegetic_music:

  Use <Subject N> for reusable visible content abstracted from a reference.
  Reserve standalone <Picture N> for concrete keyframes or composition anchors;
  a still used only for identity, wardrobe, environment, or style should be the
  provenance inside a <Subject N> definition. Use <Video N> for whole-video
  structure and <Audio N> for copied or referenced audio. Keep every label's
  meaning stable across all six sections.

  summary begins with one or more official task types: keyframe completion,
  reference generation, video editing, video continuation, audio reuse, or
  audio reference. Join multiple types exactly with " + " inside one bracketed
  prefix and never repeat a type. Choose a task from the assigned job, not file
  presence. A video-editing body begins exactly "The target video is an edited
  version of <Video 1>." This workflow supplies loose references and cannot
  promise editing or continuation without a typed transformation relationship.
  retention_analysis uses fully_preserved,
  partially_preserved, attribute_transfer, or weak_reference for visual labels,
  and fully_copy, partially_copy, reference, or weak_reference for audio.
  Bind a voice reference to its subject's (Sx) in subject_definitions, not
  retention_analysis. Timbre/rhythm/delivery references do not import source
  words; preserve explicitly reused speech and write [unclear] rather than
  guessing unintelligible spans.

  Reference resolution is a real cost/quality tradeoff. The workflow ships
  ref_image_size="match", which scales references down to the generation pixel
  area. The "max" setting uses a 2048px short edge for the best identity
  fidelity, but its reference tokens ride through every sampling step, making
  the render several times slower. Sogni does not expose "max".

  Write detailed_description in English, normally 350-500 words for a
  generation task. Preserve dialogue, lyrics, and visible text in their original
  language. Use stable speaker IDs and exact dialogue markup, for example:

    The young woman with a quiet, breathy voice (S1) says:
    <d>[English] I get off at the next station.</d>

  Run with --print-prompt to see the full example prompt for each mode.
`);
}

// ============================================
// Main Logic
// ============================================

async function main() {
  const OPTIONS = parseArgs();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║             MiniMax H3 Video Workflow                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log();

  // Resolve mode
  if (OPTIONS.modelKey && !OPTIONS.mode) {
    OPTIONS.mode = MODELS.h3[OPTIONS.modelKey]?.workflowType || null;
  }
  if (!OPTIONS.mode && OPTIONS.interactive && process.stdin.isTTY) {
    console.log('Choose the H3 workflow:\n');
    console.log('  1. t2v    Text-to-video (default)');
    console.log('  2. i2v    First-, last-, or first-and-last-frame video');
    console.log('  3. flf2v  First-and-last-frame video');
    console.log('  4. r2v    Multi-reference video');
    console.log();
    const answer = await askQuestion(`Enter choice [1-${MODES.length}] (default: 1): `);
    OPTIONS.mode = MODES[Math.max(0, Math.min(MODES.length - 1, (parseInt(answer, 10) || 1) - 1))];
  }
  OPTIONS.mode = OPTIONS.mode || 't2v';

  if (!MODES.includes(OPTIONS.mode)) {
    console.error(`Error: --mode must be one of: ${MODES.join(', ')}`);
    process.exit(1);
  }

  const modelKey = OPTIONS.modelKey || `minimax-h3-${OPTIONS.mode}`;
  const modelConfig = MODELS.h3[modelKey];
  if (!modelConfig) {
    console.error(
      `Error: Unknown model '${modelKey}'. Available: ${Object.keys(MODELS.h3).join(', ')}`
    );
    process.exit(1);
  }
  if (modelConfig.workflowType !== OPTIONS.mode) {
    console.error(
      `Error: model '${modelKey}' is a ${modelConfig.workflowType} model, not ${OPTIONS.mode}.`
    );
    process.exit(1);
  }

  log('🎬', `Selected model: ${modelConfig.name} (${modelConfig.id})`);
  console.log();

  // Reference assets. --image/--end-image are frame anchors (i2v, flf2v);
  // --ref-image/--ref-video/--ref-audio are labelled r2v references. Mixing the
  // two vocabularies for one slot would make the prompt's reference numbering
  // ambiguous, so each mode accepts only its own flags.
  const hasR2vReferences =
    OPTIONS.refImages.length > 0 || OPTIONS.refVideos.length > 0 || OPTIONS.refAudios.length > 0;
  if (OPTIONS.mode !== 'r2v' && hasR2vReferences) {
    const frameFlags =
      OPTIONS.mode === 'i2v'
        ? '--image and/or --end-image'
        : OPTIONS.mode === 'flf2v'
          ? '--image and --end-image'
          : 'no frame-reference flags';
    console.error(
      `Error: --ref-image/--ref-video/--ref-audio belong to --mode r2v. In ${OPTIONS.mode}, use ${frameFlags}.`
    );
    process.exit(1);
  }
  if (OPTIONS.mode === 'r2v' && (OPTIONS.image || OPTIONS.endImage)) {
    console.error(
      'Error: r2v has no frame anchors. Pass visual references as --ref-image or --ref-video ' +
        'instead of --image/--end-image.'
    );
    process.exit(1);
  }

  if (OPTIONS.mode === 'flf2v' && !OPTIONS.printPrompt) {
    OPTIONS.image = await pickImageFile(OPTIONS.image, 'first-frame image');
    OPTIONS.endImage = await pickImageFile(OPTIONS.endImage, 'last-frame image');
  }
  if (OPTIONS.mode === 'i2v' && !OPTIONS.printPrompt) {
    if (!OPTIONS.image && !OPTIONS.endImage) {
      if (!OPTIONS.interactive || !process.stdin.isTTY) {
        console.error(
          'Error: i2v requires at least one frame anchor: --image, --end-image, or both.'
        );
        process.exit(1);
      }
      const role = (await askQuestion('Frame anchors [first/last/both] (default: first): '))
        .trim()
        .toLowerCase();
      if (role === 'last') {
        OPTIONS.endImage = await pickImageFile(null, 'last-frame image');
      } else if (role === 'both') {
        OPTIONS.image = await pickImageFile(null, 'first-frame image');
        OPTIONS.endImage = await pickImageFile(null, 'last-frame image');
      } else {
        OPTIONS.image = await pickImageFile(null, 'first-frame image');
      }
    } else {
      if (OPTIONS.image) {
        OPTIONS.image = await pickImageFile(OPTIONS.image, 'first-frame image');
      }
      if (OPTIONS.endImage) {
        OPTIONS.endImage = await pickImageFile(OPTIONS.endImage, 'last-frame image');
      }
    }
  }
  if (
    OPTIONS.mode === 'r2v' &&
    OPTIONS.refImages.length === 0 &&
    OPTIONS.refVideos.length === 0 &&
    !OPTIONS.printPrompt
  ) {
    if (!OPTIONS.interactive || !process.stdin.isTTY) {
      console.error(
        OPTIONS.refAudios.length > 0
          ? 'Error: r2v audio cannot be the sole input; add at least one --ref-image or --ref-video.'
          : 'Error: r2v requires at least one visual reference: --ref-image or --ref-video.'
      );
      process.exit(1);
    }
    OPTIONS.refImages.push(await pickImageFile(null, 'first reference image'));
  }
  if (OPTIONS.mode === 't2v' && (OPTIONS.image || OPTIONS.endImage)) {
    console.error('Error: t2v does not accept reference images. Use --mode i2v or --mode flf2v.');
    process.exit(1);
  }
  if (OPTIONS.mode === 'r2v') {
    // Enforce the model ceilings before reading and uploading the files.
    const modelCeilings = [
      ['--ref-image', OPTIONS.refImages.length, MINIMAX_H3_MAX_REFERENCE_IMAGES, 'images'],
      ['--ref-video', OPTIONS.refVideos.length, MINIMAX_H3_MAX_REFERENCE_VIDEOS, 'videos'],
      ['--ref-audio', OPTIONS.refAudios.length, MINIMAX_H3_MAX_REFERENCE_AUDIOS, 'audio clips']
    ];
    for (const [flag, count, ceiling, label] of modelCeilings) {
      if (count > ceiling) {
        console.error(
          `Error: MiniMax H3 accepts at most ${ceiling} reference ${label}; got ${count} ${flag} values.`
        );
        process.exit(1);
      }
    }
    const totalReferences =
      OPTIONS.refImages.length + OPTIONS.refVideos.length + OPTIONS.refAudios.length;
    if (totalReferences > MINIMAX_H3_MAX_REFERENCE_FILES) {
      console.error(
        `Error: MiniMax H3 accepts at most ${MINIMAX_H3_MAX_REFERENCE_FILES} reference files in total; got ${totalReferences}.`
      );
      process.exit(1);
    }
  }

  // Resolution
  const preset = OPTIONS.portrait ? RESOLUTION_PRESETS.portrait : RESOLUTION_PRESETS.landscape;
  if (!OPTIONS.width) OPTIONS.width = preset.width;
  if (!OPTIONS.height) OPTIONS.height = preset.height;

  if (OPTIONS.width <= 0 || OPTIONS.height <= 0) {
    console.error(
      `Error: width and height must be positive. Got ${OPTIONS.width}x${OPTIONS.height}.`
    );
    process.exit(1);
  }
  if (OPTIONS.width % H3_DIMENSION_STEP !== 0 || OPTIONS.height % H3_DIMENSION_STEP !== 0) {
    console.error(
      `Error: width and height must be multiples of ${H3_DIMENSION_STEP}. Got ${OPTIONS.width}x${OPTIONS.height}.`
    );
    process.exit(1);
  }
  if (OPTIONS.width * OPTIONS.height > H3_MAX_PIXELS) {
    console.error(
      `Error: ${OPTIONS.width}x${OPTIONS.height} is ${OPTIONS.width * OPTIONS.height} pixels, over the ${H3_MAX_PIXELS} cap. Use 1344x768 or 768x1344.`
    );
    process.exit(1);
  }

  // Frames and duration. The SDK snaps a duration onto the H3 grid, so the
  // request sends `duration` and the local frame count is only used for the
  // cost estimate, duration-aware frame alignment, and the output filename.
  if (OPTIONS.frames !== null) {
    if (!isValidH3FrameCount(OPTIONS.frames)) {
      const snapped = snapMinimaxH3Frames(OPTIONS.frames);
      console.error(
        `Error: ${OPTIONS.frames} is not on the H3 frame grid. Nearest valid value is ${snapped} (grid: ${MINIMAX_H3_BASE_FRAMES} + n*${MINIMAX_H3_FRAME_STEP}, range ${MINIMAX_H3_MIN_FRAMES}-${MINIMAX_H3_MAX_FRAMES}).`
      );
      process.exit(1);
    }
    OPTIONS.duration = durationForFrames(OPTIONS.frames);
  } else {
    OPTIONS.duration = clampDuration(OPTIONS.duration ?? DEFAULT_DURATION);
    OPTIONS.frames = snapMinimaxH3Frames(Math.round(OPTIONS.duration * MINIMAX_H3_FPS));
    OPTIONS.duration = durationForFrames(OPTIONS.frames);
  }
  // Effective duration of the rendered video, used by L2VA/FL2VA alignment lines.
  const effectiveDuration = OPTIONS.frames / MINIMAX_H3_FPS;
  const framePromptMode = resolveFramePromptMode(OPTIONS.mode, !!OPTIONS.image, !!OPTIONS.endImage);

  const soundtrackedVideoIndices =
    OPTIONS.mode === 'r2v' ? await detectSoundtrackedReferenceVideos(OPTIONS.refVideos) : [];

  // Prompt
  if (OPTIONS.promptFile) {
    OPTIONS.prompt = fs.readFileSync(OPTIONS.promptFile, 'utf8').trim();
  }
  if (!OPTIONS.prompt && OPTIONS.interactive && process.stdin.isTTY) {
    console.log(
      '\nUse MiniMax Context-IR with the required ordered fields, shot syntax, and audio sections.\n' +
        'Press enter to use the example prompt for this mode.\n'
    );
    OPTIONS.prompt = await askMultilinePrompt(
      'Prompt:',
      defaultPromptForMode(
        OPTIONS.mode,
        effectiveDuration,
        {
          images: OPTIONS.refImages.length,
          videos: OPTIONS.refVideos.length,
          audios: OPTIONS.refAudios.length,
          soundtrackedVideoIndices
        },
        framePromptMode
      ),
      { consecutiveEmptyLinesToEnd: 2 }
    );
  }
  if (!OPTIONS.prompt) {
    OPTIONS.prompt = defaultPromptForMode(
      OPTIONS.mode,
      effectiveDuration,
      {
        images: OPTIONS.refImages.length,
        videos: OPTIONS.refVideos.length,
        audios: OPTIONS.refAudios.length,
        soundtrackedVideoIndices
      },
      framePromptMode
    );
  } else if (OPTIONS.mode === 'i2v' || OPTIONS.mode === 'flf2v') {
    // MiniMax requires the mode-specific alignment instruction as the first line.
    // Preserve the caller's body byte-for-byte and prepend only when absent.
    const alignmentLine =
      framePromptMode === 'i2v'
        ? I2V_ALIGNMENT_LINE
        : framePromptMode === 'l2v'
          ? l2vAlignmentLine(effectiveDuration)
          : flf2vAlignmentLine(effectiveDuration);
    if (!OPTIONS.prompt.startsWith(alignmentLine)) {
      OPTIONS.prompt = `${alignmentLine}\n\n${OPTIONS.prompt}`;
    }
  }

  const promptWarnings = reviewPrompt(OPTIONS.prompt, effectiveDuration, framePromptMode, {
    images: OPTIONS.refImages.length,
    videos: OPTIONS.refVideos.length,
    audios: OPTIONS.refAudios.length + soundtrackedVideoIndices.length
  });

  if (OPTIONS.printPrompt) {
    console.log(
      `--- ${framePromptMode} prompt (${OPTIONS.frames} frames, ${effectiveDuration.toFixed(2)}s, ${OPTIONS.prompt.length} chars) ---\n`
    );
    console.log(OPTIONS.prompt);
    console.log('\n--- end of prompt ---');
    if (promptWarnings.length) {
      console.log('\n⚠️  Prompt review:');
      promptWarnings.forEach((warning) => console.log(`   - ${warning}`));
    } else {
      console.log('\n✓ Prompt review found nothing to flag.');
    }
    process.exit(0);
  }

  if (promptWarnings.length) {
    console.log('\n⚠️  Prompt contract review:');
    promptWarnings.forEach((warning) => console.log(`   - ${warning}`));
    console.log();
  }

  // Fixed sampling parameters
  OPTIONS.fps = MINIMAX_H3_FPS;
  OPTIONS.steps = modelConfig.defaultSteps;
  OPTIONS.guidance = modelConfig.defaultGuidance;
  OPTIONS.sampler = modelConfig.allowedComfySamplers?.length
    ? modelConfig.defaultComfySampler
    : undefined;
  OPTIONS.scheduler = modelConfig.defaultComfyScheduler;

  if (OPTIONS.batch < 1 || OPTIONS.batch > 512) {
    console.error('Error: Batch count must be between 1 and 512');
    process.exit(1);
  }

  if (!fs.existsSync(OPTIONS.output)) {
    fs.mkdirSync(OPTIONS.output, { recursive: true });
  }

  // Load credentials and connect
  const credentials = await loadCredentials();

  const clientConfig = {
    appId: `sogni-workflow-h3-${OPTIONS.mode}-${Date.now()}`,
    network: 'fast'
  };

  const testnet = process.env.SOGNI_TESTNET === 'true';
  const socketEndpoint = process.env.SOGNI_SOCKET_ENDPOINT;
  const restEndpoint = process.env.SOGNI_REST_ENDPOINT;

  if (testnet) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    clientConfig.testnet = testnet;
  }
  if (socketEndpoint) clientConfig.socketEndpoint = socketEndpoint;
  if (restEndpoint) clientConfig.restEndpoint = restEndpoint;
  if (credentials.apiKey) clientConfig.apiKey = credentials.apiKey;

  const sogni = await SogniClient.createInstance(clientConfig);

  let projectEventHandler;
  let jobEventHandler;
  const jobStates = new Map();

  try {
    if (!credentials.apiKey) {
      log('🔓', 'Logging in...');
      await sogni.account.login(credentials.username, credentials.password);
      log('✓', `Logged in as: ${credentials.username}`);
    } else {
      log('✓', 'Authenticated with API key');
    }
    console.log();

    const balance = await sogni.account.refreshBalance();

    let tokenType = loadTokenTypePreference();
    if (!tokenType) {
      console.log('💳 Select payment token type:\n');
      if (balance) {
        console.log(
          `  1. Spark Points (Balance: ${parseFloat(balance.spark.net || 0).toFixed(2)})`
        );
        console.log(
          `  2. Sogni Tokens (Balance: ${parseFloat(balance.sogni.net || 0).toFixed(2)})`
        );
      } else {
        console.log('  1. Spark Points');
        console.log('  2. Sogni Tokens');
      }
      console.log();
      const tokenChoice = (await askQuestion('Enter choice [1/2] (default: 1): ')).trim() || '1';
      tokenType = tokenChoice === '2' || tokenChoice.toLowerCase() === 'sogni' ? 'sogni' : 'spark';
      console.log(`  → Using ${tokenType === 'sogni' ? 'Sogni tokens' : 'Spark tokens'}\n`);

      const savePreference = await askQuestion('Save payment preference to .env file? [Y/n]: ');
      if (savePreference.toLowerCase() !== 'n' && savePreference.toLowerCase() !== 'no') {
        saveTokenTypePreference(tokenType);
        console.log('✓ Payment preference saved\n');
      }
    } else {
      console.log(`💳 Using saved payment preference: ${tokenType} tokens\n`);
    }

    // Prepare reference images at the exact output canvas.
    //
    // The image slots mean different things per mode. In i2v/flf2v they are
    // frame anchors. In r2v there are no anchors at all: reference 1 goes to
    // referenceImage and references 2-9 to contextImages, which the SDK uploads
    // to the numbered slots the worker packs into ref_images.
    let referenceImage;
    let referenceImageEnd;
    let contextImages;
    let referenceVideo;
    let referenceVideos;
    let referenceAudio;
    let referenceAudios;

    const prepareImage = async (path, label) => {
      const processed = await processImageForVideo(path, OPTIONS.frames, {
        targetWidth: OPTIONS.width,
        targetHeight: OPTIONS.height,
        dimensionStep: H3_DIMENSION_STEP
      });
      log('🖼️', `${label}: ${path} (${processed.width}x${processed.height})`);
      return new Blob([processed.buffer]);
    };

    if (OPTIONS.image) {
      referenceImage = await prepareImage(OPTIONS.image, 'First frame');
    }
    if (OPTIONS.endImage) {
      referenceImageEnd = await prepareImage(OPTIONS.endImage, 'Last frame');
    }
    if (OPTIONS.refImages.length) {
      const prepared = [];
      for (const [index, path] of OPTIONS.refImages.entries()) {
        prepared.push(
          await prepareImage(path, `Reference image ${index + 1} (<Picture ${index + 1}>)`)
        );
      }
      [referenceImage] = prepared;
      if (prepared.length > 1) {
        contextImages = prepared.slice(1);
      }
    }
    if (OPTIONS.refVideos.length) {
      const prepared = OPTIONS.refVideos.map((path, index) => {
        log('🎞️', `Reference video ${index + 1} (<Video ${index + 1}>): ${path}`);
        return readFileAsBuffer(path);
      });
      [referenceVideo] = prepared;
      referenceVideos = prepared.slice(1);
    }
    if (OPTIONS.refAudios.length) {
      const prepared = OPTIONS.refAudios.map((path, index) => {
        const audioOrdinal = soundtrackedVideoIndices.length + index + 1;
        log('🔊', `Reference audio ${index + 1} (<Audio ${audioOrdinal}>): ${path}`);
        return readFileAsBuffer(path);
      });
      [referenceAudio] = prepared;
      referenceAudios = prepared.slice(1);
    }

    const referenceSummary =
      OPTIONS.mode === 'r2v'
        ? {
            References: `${OPTIONS.refImages.length} image(s), ${OPTIONS.refVideos.length} video(s), ${OPTIONS.refAudios.length} audio clip(s)`,
            'Reference sizing': 'ref_image_size=match (references scaled to the generation area)'
          }
        : {};

    displayConfig('MiniMax H3 Generation Configuration', {
      Model: modelConfig.name,
      Workflow: OPTIONS.mode,
      ...referenceSummary,
      Resolution: `${OPTIONS.width}x${OPTIONS.height}`,
      Duration: `${effectiveDuration.toFixed(2)}s`,
      FPS: `${OPTIONS.fps} (fixed)`,
      Frames: `${OPTIONS.frames} (grid ${MINIMAX_H3_BASE_FRAMES} + n*${MINIMAX_H3_FRAME_STEP})`,
      Steps: `${OPTIONS.steps} (fixed)`,
      Guidance: `${OPTIONS.guidance} (fixed, distilled)`,
      'Comfy Sampler': OPTIONS.sampler,
      'Comfy Scheduler': OPTIONS.scheduler,
      Audio: OPTIONS.generateAudio ? 'included' : 'not included in the returned video',
      'Audio source': 'native 32kHz stereo, generated jointly',
      Batch: OPTIONS.batch,
      Seed: OPTIONS.seed !== null ? OPTIONS.seed : -1,
      Billing: billingModeLabel(OPTIONS.billingMode),
      Safety: OPTIONS.disableSafeContentFilter ? '⚠️  DISABLED' : 'enabled'
    });

    console.log('\n📝 Prompt:\n');
    console.log(OPTIONS.prompt);
    console.log();

    // Cost estimate
    log('💵', 'Fetching cost estimate...');
    const estimate = await getVideoJobEstimate(
      tokenType,
      modelConfig.id,
      OPTIONS.width,
      OPTIONS.height,
      OPTIONS.frames,
      OPTIONS.fps,
      OPTIONS.steps,
      OPTIONS.batch
    );

    console.log();
    console.log('📊 Cost Estimate:');
    const isSpark = tokenType === 'spark';
    const totalCost = parseFloat(
      (isSpark ? estimate.quote.project.costInSpark : estimate.quote.project.costInSogni) || 0
    );
    const unit = isSpark ? 'Spark' : 'Sogni';
    if (OPTIONS.batch > 1) {
      console.log(`   Per video: ${(totalCost / OPTIONS.batch).toFixed(2)} ${unit}`);
      console.log(`   Total (${OPTIONS.batch} videos): ${totalCost.toFixed(2)} ${unit}`);
    } else {
      console.log(`   ${unit}: ${totalCost.toFixed(2)}`);
    }
    if (balance && shouldCheckTokenBalance(OPTIONS.billingMode)) {
      const currentBalance = parseFloat((isSpark ? balance.spark.net : balance.sogni.net) || 0);
      console.log(`   Balance remaining: ${(currentBalance - totalCost).toFixed(2)} ${unit}`);
    }
    console.log(`   USD: $${(totalCost * (isSpark ? 0.005 : 0.05)).toFixed(4)}`);
    console.log();

    if (OPTIONS.interactive) {
      const proceed = await askQuestion('Proceed with generation? [Y/n]: ');
      if (proceed.toLowerCase() === 'n' || proceed.toLowerCase() === 'no') {
        log('❌', 'Generation cancelled');
        process.exit(0);
      }
    } else {
      console.log('✓ Proceeding with generation (non-interactive mode)');
    }

    log('🔄', 'Loading available models...');
    const models = await sogni.projects.waitForModels();
    const videoModel = models.find((m) => m.id === modelConfig.id);
    if (!videoModel) {
      throw new Error(`Model ${modelConfig.id} is not currently available on the fast network.`);
    }
    log('✓', `Model ready: ${videoModel.name}`);
    console.log();

    if (OPTIONS.seed === null || OPTIONS.seed === -1) {
      OPTIONS.seed = generateRandomSeed();
      log('🎲', `Generated seed: ${OPTIONS.seed}`);
    }

    log('📤', `Submitting ${OPTIONS.mode} job...`);
    console.log();

    const projectParams = {
      type: 'video',
      modelId: modelConfig.id,
      positivePrompt: OPTIONS.prompt,
      numberOfMedia: OPTIONS.batch,
      width: OPTIONS.width,
      height: OPTIONS.height,
      // Sending duration rather than frames exercises the SDK's H3 frame grid:
      // it snaps duration * 24 onto 124 + n*17 and clamps to 124-362.
      duration: OPTIONS.duration,
      fps: OPTIONS.fps,
      steps: OPTIONS.steps,
      guidance: OPTIONS.guidance,
      seed: OPTIONS.seed,
      sampler: OPTIONS.sampler,
      scheduler: OPTIONS.scheduler,
      generateAudio: OPTIONS.generateAudio,
      disableNSFWFilter: OPTIONS.disableSafeContentFilter,
      tokenType,
      billingMode: OPTIONS.billingMode
      // No negativePrompt: H3 is distilled and runs at guidance 1.
    };
    if (referenceImage) projectParams.referenceImage = referenceImage;
    if (referenceImageEnd) projectParams.referenceImageEnd = referenceImageEnd;
    if (contextImages) projectParams.contextImages = contextImages;
    if (referenceVideo) projectParams.referenceVideo = referenceVideo;
    if (referenceVideos?.length) projectParams.referenceVideos = referenceVideos;
    if (referenceAudio) projectParams.referenceAudio = referenceAudio;
    if (referenceAudios?.length) projectParams.referenceAudios = referenceAudios;

    const project = await sogni.projects.create(projectParams);

    let completedVideos = 0;
    let failedVideos = 0;
    const totalVideos = OPTIONS.batch;
    let projectFailed = false;

    function getJobLabel(event, jobId = null) {
      if (totalVideos === 1) return '';
      let jobNum = event.jobIndex;
      if (jobNum === undefined && jobId) {
        jobNum = jobStates.get(jobId)?.jobIndex;
      }
      jobNum = jobNum !== undefined ? jobNum + 1 : '?';
      return `[${jobNum}/${totalVideos}] `;
    }

    function clearProgressLine() {
      process.stdout.write('\r' + ' '.repeat(80) + '\r');
    }

    function stopJobProgress(jobId) {
      const state = jobStates.get(jobId);
      if (state?.interval) {
        clearInterval(state.interval);
        state.interval = null;
        clearProgressLine();
      }
    }

    function checkWorkflowCompletion() {
      if (completedVideos + failedVideos === totalVideos) {
        if (failedVideos === 0) {
          log(
            '🎉',
            totalVideos === 1
              ? 'Video generated successfully!'
              : `All ${totalVideos} videos generated successfully!`
          );
          console.log();
          process.exit(0);
        } else {
          log('❌', `${failedVideos} out of ${totalVideos} video(s) failed to generate`);
          console.log();
          process.exit(1);
        }
      }
    }

    projectEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      switch (event.type) {
        case 'queued':
          log('📋', `Project queued at position: ${event.queuePosition}`);
          break;
        case 'completed':
          log('✅', 'Project completed!');
          break;
        case 'error':
          projectFailed = true;
          log('❌', `Project failed: ${event.error?.message || event.error || 'Unknown error'}`);
          if (event.error?.code) console.log(`   Error code: ${event.error.code}`);
          checkWorkflowCompletion();
          break;
      }
    };

    jobEventHandler = (event) => {
      if (event.projectId !== project.id) return;
      const jobId = event.jobId;

      switch (event.type) {
        case 'queued':
          log('📋', `${getJobLabel(event, jobId)}Job queued at position: ${event.queuePosition}`);
          break;

        case 'initiating': {
          if (!jobStates.has(jobId)) {
            jobStates.set(jobId, { jobIndex: event.jobIndex, interval: null });
          } else if (event.jobIndex !== undefined) {
            jobStates.get(jobId).jobIndex = event.jobIndex;
          }
          log(
            '⚙️',
            `${getJobLabel(event, jobId)}Model initiating on worker: ${event.workerName || 'Unknown'}`
          );
          break;
        }

        case 'started': {
          let state = jobStates.get(jobId);
          if (!state) {
            state = { jobIndex: event.jobIndex, interval: null };
            jobStates.set(jobId, state);
          }
          state.startTime = Date.now();
          state.lastETAUpdate = Date.now();
          if (event.jobIndex !== undefined) state.jobIndex = event.jobIndex;

          state.interval = setInterval(() => {
            const current = jobStates.get(jobId);
            if (!current?.startTime) return;
            const elapsed = (Date.now() - current.startTime) / 1000;
            let progressStr = `\r  ${getJobLabel({}, jobId)}Generating...`;
            if (current.lastStep !== undefined && current.lastStepCount !== undefined) {
              const stepPercent = Math.round((current.lastStep / current.lastStepCount) * 100);
              progressStr += ` Step ${current.lastStep}/${current.lastStepCount} (${stepPercent}%)`;
            }
            if (current.lastETA !== undefined) {
              const sinceUpdate = (Date.now() - current.lastETAUpdate) / 1000;
              progressStr += ` ETA: ${formatDuration(Math.max(1, current.lastETA - sinceUpdate))}`;
            }
            progressStr += ` (${formatDuration(elapsed)} elapsed)   `;
            process.stdout.write(progressStr);
          }, 1000);

          log(
            '🚀',
            `${getJobLabel(event, jobId)}Job started on worker: ${event.workerName || 'Unknown'}`
          );
          break;
        }

        case 'jobETA': {
          const state = jobStates.get(jobId);
          if (state) {
            state.lastETA = event.etaSeconds;
            state.lastETAUpdate = Date.now();
          }
          break;
        }

        case 'progress': {
          const state = jobStates.get(jobId);
          if (state && event.step !== undefined && event.stepCount !== undefined) {
            state.lastStep = event.step;
            state.lastStepCount = event.stepCount;
          }
          break;
        }

        case 'completed': {
          const state = jobStates.get(jobId);
          const label = getJobLabel(event, jobId);
          stopJobProgress(jobId);

          if (event.isNSFW && !OPTIONS.disableSafeContentFilter) {
            failedVideos++;
            displaySafeContentFilterMessage();
            jobStates.delete(jobId);
            checkWorkflowCompletion();
            return;
          }

          if (!event.resultUrl || event.error) {
            failedVideos++;
            log('❌', `${label}Job completed with error: ${event.error || 'No result URL'}`);
            jobStates.delete(jobId);
            checkWorkflowCompletion();
            return;
          }

          if (projectFailed) {
            log('⚠️', `${label}Ignoring completion event for already failed project`);
            return;
          }

          const jobElapsedSeconds = state?.startTime ? (Date.now() - state.startTime) / 1000 : null;
          const jobSeed = event.seed ?? OPTIONS.seed + (state?.jobIndex || 0);

          const outputPath = getUniqueFilename(
            generateVideoFilename({
              modelId: modelConfig.id,
              frames: OPTIONS.frames,
              fps: OPTIONS.fps,
              width: OPTIONS.width,
              height: OPTIONS.height,
              seed: jobSeed,
              prompt: OPTIONS.prompt,
              generationTime: jobElapsedSeconds,
              outputDir: OPTIONS.output
            })
          );

          downloadVideo(event.resultUrl, outputPath)
            .then(() => {
              completedVideos++;
              log(
                '✓',
                `${label}Video completed (${jobElapsedSeconds ? jobElapsedSeconds.toFixed(2) : '?'}s)`
              );
              log('💾', `Saved: ${outputPath}`);
              openVideo(outputPath);
              jobStates.delete(jobId);
              checkWorkflowCompletion();
            })
            .catch((error) => {
              failedVideos++;
              log('❌', `${label}Download failed: ${error.message}`);
              jobStates.delete(jobId);
              checkWorkflowCompletion();
            });
          break;
        }

        case 'error':
        case 'failed': {
          const label = getJobLabel(event, jobId);
          stopJobProgress(jobId);
          failedVideos++;
          if (isSensitiveContentError(event) && !OPTIONS.disableSafeContentFilter) {
            displaySafeContentFilterMessage();
          } else {
            const errorMsg = event.error?.message || event.error || 'Unknown error';
            const errorCode = event.error?.code;
            log(
              '❌',
              errorCode !== undefined && errorCode !== null
                ? `${label}Job failed: ${errorMsg} (Error code: ${errorCode})`
                : `${label}Job failed: ${errorMsg}`
            );
          }
          jobStates.delete(jobId);
          checkWorkflowCompletion();
          break;
        }
      }
    };

    sogni.projects.on('project', projectEventHandler);
    sogni.projects.on('job', jobEventHandler);

    await new Promise((resolve) => {
      const checkCompletion = () => {
        if (projectFailed || completedVideos + failedVideos >= totalVideos) {
          resolve();
        } else {
          setTimeout(checkCompletion, 1000);
        }
      };
      checkCompletion();
    });

    if (projectFailed) {
      process.exit(1);
    }
  } catch (error) {
    log('❌', `Error: ${error.message}`);
    process.exit(1);
  } finally {
    if (projectEventHandler) sogni.projects.off('project', projectEventHandler);
    if (jobEventHandler) sogni.projects.off('job', jobEventHandler);
    for (const [, state] of jobStates) {
      if (state?.interval) clearInterval(state.interval);
    }
    jobStates.clear();
    try {
      await sogni.account.logout();
    } catch {
      // API-key sessions have no logout endpoint; nothing to revoke.
    } finally {
      // Releases the WebSocket. Without this the process never exits.
      sogni.dispose();
    }
  }
}

/**
 * Get video job cost estimate
 */
async function getVideoJobEstimate(
  tokenType,
  modelId,
  width,
  height,
  frames,
  fps,
  steps,
  videoCount = 1
) {
  let baseUrl = process.env.SOGNI_SOCKET_ENDPOINT || 'https://socket.sogni.ai';
  if (baseUrl.startsWith('wss://')) {
    baseUrl = baseUrl.replace('wss://', 'https://');
  } else if (baseUrl.startsWith('ws://')) {
    baseUrl = baseUrl.replace('ws://', 'https://');
  }
  const url = `${baseUrl}/api/v1/job-video/estimate/${tokenType}/${encodeURIComponent(modelId)}/${width}/${height}/${frames}/${fps}/${steps}/${videoCount}`;
  console.log(`🔗 Video cost estimate URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to get cost estimate: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Download video from URL
 */
async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  const fileStream = fs.createWriteStream(outputPath);
  await streamPipeline(response.body, fileStream);
}

/**
 * Open video in default OS video player
 */
function openVideo(videoPath) {
  const { platform } = process;
  let command;
  let commandArgs;

  if (platform === 'darwin') {
    command = 'open';
    commandArgs = [videoPath];
  } else if (platform === 'win32') {
    command = 'explorer.exe';
    commandArgs = [videoPath];
  } else {
    command = 'xdg-open';
    commandArgs = [videoPath];
  }

  execFile(command, commandArgs, (error) => {
    if (error) {
      log('⚠️', `Could not auto-open video: ${error.message}`);
    } else {
      log('🎬', `Opened video in player: ${videoPath}`);
    }
  });
}

// ============================================
// Run Main
// ============================================

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
