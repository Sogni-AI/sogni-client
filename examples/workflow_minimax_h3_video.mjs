#!/usr/bin/env node
/**
 * MiniMax H3 Video Workflow (t2v / i2v / flf2v / r2v)
 *
 * MiniMax H3 generates video and 32kHz stereo audio jointly in a single pass on
 * Sogni. t2v, i2v, and flf2v share the FL2VA checkpoint; r2v is a separate
 * Ref2VA checkpoint that conditions on labelled reference material rather than
 * on frame anchors. Every sampling parameter is fixed by the checkpoint:
 * 24fps, 20 steps, guidance 1 (distilled, so a negative prompt does nothing),
 * res_multistep / simple. Frames sit on the 124 + n*17 grid (124-362 frames,
 * 5.167s to 15.083s) and the canvas uses a 32px grid capped at 1032192 pixels,
 * which is why 1344x768 and 768x1344 are the two shipped presets. Availability
 * depends on current compatible capacity. Sogni's open-weights H3 is
 * 768p-class; MiniMax's 2K stage is hosted-only and is not part of the open
 * release.
 *
 * ## How to prompt H3: write natural cinematic prose
 *
 * There is no required structure, no field names, and no tags. Write what a
 * director would write. In priority order:
 *
 * 1. Natural cinematic prose. Plain sentences describing what is on screen.
 * 2. For anything longer than a single beat, use a timed shot list with plain
 *    bracketed timecodes - "[0-2 seconds] ...", "[2-5 seconds] ...". This is
 *    the single highest-leverage technique for pacing, and it is what stops
 *    long generations from drifting into a slideshow.
 * 3. Direct the audio as deliberately as the picture. H3 generates native
 *    32kHz stereo audio jointly with the video, so describe ambience, specific
 *    SFX, and music with instrumentation and timing ("bring in the low beat at
 *    3 seconds"). Plain labels like "Audio:", "Sound design:", or "Music:"
 *    inside the prose work well. Say so explicitly when you want no music.
 * 4. Dialogue is ordinary quoted prose: `The pilot says: "We need more
 *    datacenters."` (See the ADVANCED note on MiniMax's <d> markup below.)
 * 5. State what you do NOT want directly in the prompt text - negative
 *    direction is unusually effective on H3. There is no negative-prompt
 *    field; the checkpoint is CFG-distilled with guidance locked at 1, so a
 *    separate `negativePrompt` parameter is unsupported and rejected.
 * 6. Lock identity by naming concrete features, and give every reference image
 *    an explicit job ("use the first frame for the character, keep her jacket
 *    and hairstyle"). This matters most in r2v, where several references
 *    compete: separate identity from style, motion from appearance, and voice
 *    character from spoken words, and say which reference wins when two of them
 *    disagree.
 * 7. Use real camera and film vocabulary - lens, movement, exposure, stock -
 *    and describe transitions as physical events rather than named effects.
 *
 * Prompts can be long: up to 7000 characters for H3, and
 * timed shot lists get long fast. The Sogni SDK forwards `positivePrompt`
 * without truncating it.
 *
 * ### Why this file no longer ships IR-format prompts
 *
 * MiniMax's tagged formats (`integrated_multimodal_description:` /
 * `overall_soundscape:` / `non_diegetic_music:`, `<d>[English] ...</d>`) are
 * real, but they live in MiniMax's *_ref_en.md rewrite schema - they are the
 * output format of their internal rewriting layer, not something an end user
 * should hand-write.
 *
 * Sogni ran the controlled experiment: identical prompt, seed, and words in
 * three dialogue formats - (a) `<d>[English](S1) ...</d>`, (b) MiniMax's strict
 * three-field IR format, (c) plain quoted prose with no markup. There was no
 * perceptible difference in output quality, speech intelligibility, or lip sync
 * (2026-08-03, RTX 5090, minimax-h3-fl2va-fp8_t2v, 768x1344, 243 frames).
 * fal.ai, a MiniMax day-0 launch partner, documents only natural-language
 * prompting for H3, uses zero markup across 44 worked examples, and ships no
 * prompt_optimizer flag on its H3 endpoints.
 *
 * So: prose is the default. The markup is kept here as an optional advanced
 * path (see ADVANCED_DIALOGUE_MARKUP and --alignment-line), and a caller's own
 * markup is never stripped.
 *
 * Prerequisites:
 * - Set SOGNI_API_KEY or SOGNI_USERNAME/SOGNI_PASSWORD in .env file (or will prompt)
 * - You need access to the 'fast' network for video generation
 *
 * Usage:
 *   node workflow_minimax_h3_video.mjs                              # Interactive, t2v
 *   node workflow_minimax_h3_video.mjs --mode t2v --no-interactive  # Example t2v prompt
 *   node workflow_minimax_h3_video.mjs --mode i2v --image start.jpg
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
// optional flf2v alignment line.
const DEFAULT_DURATION = 8;

// ============================================
// ADVANCED / OPTIONAL: MiniMax rewrite-schema markup
// ============================================

/**
 * ADVANCED, OPTIONAL. MiniMax's I2VA alignment line, verbatim from their
 * rewrite schema.
 *
 * Sogni A/B testing found no quality difference from writing the same
 * instruction as prose ("use the provided image as the first frame and keep it
 * exactly"), so this is not used by default. Pass --alignment-line to prepend
 * it, which is occasionally useful when you want the anchor timing stated in
 * MiniMax's own wording.
 */
const I2V_ALIGNMENT_LINE =
  'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';

/**
 * ADVANCED, OPTIONAL. MiniMax's FL2VA alignment line.
 *
 * Note it differs from the I2VA line in three ways that are easy to get wrong:
 * Picture and Shot are bare (no angle or square brackets), the separator is a
 * U+2014 em dash surrounded by spaces, and the second clause carries the
 * effective duration to exactly two decimals. FL2VA generally favors a single
 * shot, so the final shot index is normally 1.
 *
 * Also not used by default - see --alignment-line.
 *
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

/**
 * ADVANCED, OPTIONAL. MiniMax also defines a dialogue markup where the language
 * tag and the verbatim spoken words go inside a <d> tag and the speaker id sits
 * outside it:
 *
 *   The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>
 *
 * It can help disambiguate a scene with many speakers. Sogni A/B testing found
 * no quality difference for ordinary dialogue, so treat it as optional and
 * never required. This example never rewrites or strips a caller's markup - if
 * you pass a prompt that uses it, it is sent through byte-identical.
 */
const ADVANCED_DIALOGUE_MARKUP =
  'The young woman with a quiet, breathy voice (S1) says: <d>[English] I get off at the next station.</d>';

// ============================================
// Example prompts: natural cinematic prose
// ============================================

// All three examples are written for the 8-second default (192 frames). If you
// change --duration or --frames, rewrite the bracketed timecodes to cover the
// new length; the prompt review below warns when beats overrun the video.

/**
 * t2v: no reference images, so the prose builds the whole timeline.
 *
 * Demonstrates a timed shot list, camera and lens vocabulary, two speakers as
 * ordinary quoted prose, deliberate audio direction with a timed music cue, and
 * an explicit statement of what should not appear.
 */
const T2V_PROMPT = `Live-action cinematic footage on 35mm with an anamorphic lens, shallow depth of field, rain-slick night exterior lit by sodium platform lamps.

[0-2 seconds] A medium-wide shot of two railway engineers beside a stopped commuter train on a wet service platform, the lamps throwing long reflections across the concrete. The camera pushes in slowly on a dolly. The older engineer in a reflective orange vest wipes rain off a clipboard, taps it twice, and says: "The eastbound line is clear, but we hold here until the signal turns."

[2-4 seconds] The younger engineer in a dark blue jacket leans out of the open carriage door, one hand still on the handrail, and answers without stepping down: "Copy that. I'll keep the doors shut."

[4-6 seconds] Cut to a low-angle close shot of the signal mast against the black sky, water beading along the housing, as the lamp switches from red to green and the wet metal picks up the new colour. The camera tilts down to find both engineers walking toward the front of the train, their boots throwing up thin sheets of water.

[6-8 seconds] Back to a wide, locked-off shot as the train's marker lights brighten. The two of them glance at each other and say together: "That's our green."

Audio: steady rain drumming on the metal carriage roofs, a low electrical hum from the overhead lamps underneath it, boots splashing through shallow puddles, a pressurised hiss from beneath the train, and a dull metallic clunk as the signal relay switches over at 4 seconds. Both voices sit close and clear over the rain - the older man low and gravelly, the younger one brighter and quicker.

Music: sparse low piano at a slow tempo, with a soft low beat coming in at 4 seconds under the signal change and dropping away again on the final line.

Do not include on-screen text, subtitles, captions, logos, or watermarks. No slow motion, no speed ramping, no lens flares.`;

/**
 * i2v: the first frame is supplied, so the prose gives that image an explicit
 * job and then develops forward from it.
 *
 * Demonstrates identity locking by naming concrete features, a timed shot list,
 * dialogue as quoted prose, and an explicit "no music" instruction - H3 always
 * generates audio, so silence has to be directed rather than assumed.
 */
const I2V_PROMPT = `Use the provided image as the first frame and keep it exactly: the same woman, the same dark jacket and hairstyle, the same mug and papers on the table, lit from the same side at the same colour temperature.

[0-3 seconds] The shot opens locked off on the framing from the reference image, then begins a slow push-in on her face. She lifts her head, shifts her weight forward, and lets the hand resting on the table open. The jacket keeps the same folds and the same key light. She looks into the lens and says, quietly and evenly: "I told them I would wait until the last train, and I meant it."

[3-6 seconds] She glances down at the table and breathes out once. The push-in continues; the background falls further out of focus.

[6-8 seconds] A hand enters from the right, straightens the mug, and withdraws. The camera settles and holds.

Audio: quiet interior room tone, faint traffic passing somewhere beyond the wall, fabric rustling as she shifts in the chair, one controlled exhale, and a small ceramic scrape as the mug is straightened. Her voice is close, dry, and low.

No music at all - the scene plays on room tone and dialogue only.

Do not change her face, hair, or clothing from the reference image. No on-screen text or subtitles, no cutaway to another location, and no extra people entering the frame.`;

/**
 * flf2v: both anchors are supplied, so the prose describes the physical path
 * between them in one unbroken take.
 *
 * Demonstrates giving each reference image its own job, describing the
 * transition as a physical event rather than a named effect, and converging on
 * the final composition.
 */
const FLF2V_PROMPT = `Use the first reference image as the opening frame and the second reference image as the final frame, and generate one continuous take that travels between them. The same woman, the same wardrobe, and the same room throughout - nothing is recast, replaced, or relit between the two anchors.

[0-3 seconds] Hold near the opening pose from the first image, then begin the move: her weight shifts from one foot to the other and her arms travel along a smooth arc rather than snapping into place. The camera starts a slow dolly-out on a 40mm lens, widening the frame by a small margin.

[3-6 seconds] The turn carries on through plausible intermediate positions. Her head rotates gradually toward the direction it faces in the second image, and whatever she is holding moves with her hands. The shadows lengthen at an even rate toward the light angle of the second image. She says, warm and unhurried: "Give it another second, it's almost there."

[6-8 seconds] The pose, the spacing to the background, the camera distance, and the lighting all converge, and the last frame settles into exactly the composition of the second image.

Audio: a low continuous room ambience under the whole shot, clothing rustling as she shifts, quiet footsteps scuffing the floor, and one soft contact sound as the movement settles into its final position.

Music: a single slow ascending synthesiser figure that thins to one sustained tone as the shot reaches its final composition.

Do not cut - this is one unbroken take. No morph, dissolve, or crossfade between the two images. No on-screen text or watermarks, and no change of wardrobe or location.`;

/**
 * r2v: several references compete, so the first thing the prose does is hand
 * each one a separate job and settle who wins when two of them disagree.
 *
 * Written for three reference images, which is what `--mode r2v` sends when you
 * pass three `--ref-image` files: reference 1 is `referenceImage` and references
 * 2 and 3 ride in `contextImages`. Pass fewer and the later assignments simply
 * have nothing to bind to, so trim them from the prompt.
 *
 * Uses MiniMax's own `<Picture i>` tags, which is the form the model literally
 * sees: `comfy/text_encoders/minimax.py` splices `"<Picture %d>: "` (and
 * `"<Video %d>: "`, `"<Audio %d>: "`) in front of each reference before your
 * prompt text, so a sentence written with the same tags shares a token sequence
 * with the label of the reference it is about. Prose aliases ("Image 1", "the
 * second photo") do not, which is why every Sogni layer now writes the tags.
 *
 * Demonstrates per-reference jobs (identity, wardrobe, environment), the 1-based
 * per-type numbering, an explicit conflict rule, a timed shot list, deliberate
 * audio direction, and an explicit statement of what must not appear.
 */
const R2V_PROMPT = `<Picture 1> is the identity reference for the woman: her face, her bone structure, and her hairstyle carry over exactly, and nothing else from that frame does. <Picture 2> is the wardrobe reference: the dark red jacket, its collar, and the way it hangs - take the garment, not the person wearing it. <Picture 3> is the location, lighting palette, and film texture: the wet street, the sodium and neon colour, the grain. Do not copy any person, vehicle, or signage from <Picture 3>. Where <Picture 1> and <Picture 3> disagree on colour or exposure, <Picture 1> wins on her face and <Picture 3> wins on everything behind her.

[0-3 seconds] She walks toward camera along the rain-slicked street, hands in the jacket pockets. Handheld medium shot on a fast 50mm, shallow focus, neon reflections sliding across the wet asphalt beneath her.

[3-6 seconds] She stops and glances back over her shoulder. The camera arcs slowly around her as a bus passes behind, its headlights sweeping across her face and briefly blowing out the highlights on the jacket.

[6-8 seconds] She turns back to camera and the shot settles into a medium close-up, the street lights blooming behind her. She says, quietly, almost to herself: "It was never going to be the last train."

Audio: steady rain on asphalt, tyres hissing through standing water, a bus engine passing left to right at 4 seconds, and distant traffic underneath all of it. Her voice is close, dry, and low over the rain.

Music: one low warm synth pad that fades in at 6 seconds and holds under the final line. Nothing before that.

Do not include on-screen text, subtitles, captions, logos, or watermarks. No extra people in frame, no cuts to another location, and no change of wardrobe.`;

/**
 * Pick the example prompt for a mode, optionally prefixed with MiniMax's
 * alignment line (advanced, off by default).
 *
 * @param {string} mode - t2v, i2v, flf2v, or r2v
 * @param {number} durationSeconds - Effective duration, used by the flf2v line
 * @param {boolean} withAlignmentLine - Prepend the optional alignment line
 * @returns {string} The complete prompt
 */
function defaultPromptForMode(mode, durationSeconds, withAlignmentLine = false) {
  if (mode === 'i2v') {
    return withAlignmentLine ? `${I2V_ALIGNMENT_LINE}\n\n${I2V_PROMPT}` : I2V_PROMPT;
  }
  if (mode === 'flf2v') {
    return withAlignmentLine
      ? `${flf2vAlignmentLine(durationSeconds)}\n\n${FLF2V_PROMPT}`
      : FLF2V_PROMPT;
  }
  if (mode === 'r2v') {
    // r2v references are not pinned to a timecode, so MiniMax's alignment lines
    // have nothing to say about them - the per-reference jobs in the prose do
    // that work instead.
    return R2V_PROMPT;
  }
  // t2v has no reference images, so an alignment line would have nothing to
  // align to.
  return T2V_PROMPT;
}

// ============================================
// Prompt review (advisory only)
// ============================================

/**
 * How long a video can run before an untimed prompt tends to drift into a
 * slideshow. Below this a single well-written beat is fine.
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
const SINGLE_SHOT_MODES = new Set(['flf2v']);

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
 * The canonical form is the tag the text encoder emits - `<Picture 1>`,
 * `<Video 1>`, `<Audio 1>` - but this stays deliberately loose and also matches
 * prose aliases ("Image 1", "picture 2"), because a warning that fires on a
 * prompt which DOES assign its references, just informally, is worse than one
 * that misses an edge case.
 */
const NUMBERED_REFERENCE_PATTERN = /\b(?:picture|image|video|audio)\s*#?\s*\d+/i;

/**
 * Prompt length limit for H3, matching what fal.ai documents for the model.
 * Full production briefs (timed shot list + reference assignments + audio
 * direction) fit comfortably; the server-side 4096-char clamp is audio-only
 * and does not apply to video prompts.
 */
const PROMPT_CHAR_LIMIT = 7000;

/**
 * Collect the bracketed timecodes in a prompt: "[0-2 seconds]", "[2 - 5 s]",
 * "[7 seconds]". Returns the end (or only) second of each beat.
 *
 * @param {string} prompt - The prompt to scan
 * @returns {number[]} Beat end times in seconds
 */
function findTimedBeats(prompt) {
  const beats = [];
  const pattern =
    /\[\s*(\d+(?:\.\d+)?)\s*(?:[-–—]|to)?\s*(\d+(?:\.\d+)?)?\s*(?:s|sec|secs|second|seconds)\s*\]/gi;
  let match;
  while ((match = pattern.exec(prompt)) !== null) {
    beats.push(parseFloat(match[2] ?? match[1]));
  }
  return beats;
}

/**
 * Review a prompt and return advisory warnings.
 *
 * H3 takes any string, and there is no required structure, so nothing here is
 * an error. These checks only flag the things that measurably cost quality or
 * silently do nothing.
 *
 * @param {string} prompt - The prompt to review
 * @param {number} durationSeconds - Effective video duration
 * @param {string} mode - t2v, i2v, flf2v, or r2v
 * @param {Object} [references] - Attached r2v references
 * @param {number} [references.videos] - Reference videos attached
 * @param {number} [references.audios] - Reference audio clips attached
 * @returns {string[]} Warnings, empty when nothing looks off
 */
function reviewPrompt(prompt, durationSeconds, mode, references = {}) {
  const warnings = [];
  const beats = findTimedBeats(prompt);

  // flf2v is single-shot by design; r2v is single-shot when the prose says so.
  const untimedIsIntentional =
    SINGLE_SHOT_MODES.has(mode) || (mode === 'r2v' && SINGLE_CONTINUOUS_SHOT_PATTERN.test(prompt));

  if (
    !beats.length &&
    !untimedIsIntentional &&
    durationSeconds > TIMED_BEATS_RECOMMENDED_ABOVE_SECONDS
  ) {
    warnings.push(
      `No timed beats found, and this render is ${durationSeconds.toFixed(2)}s. Over about ` +
        `${TIMED_BEATS_RECOMMENDED_ABOVE_SECONDS}s an untimed prompt tends to drift into a slideshow. ` +
        'Add a shot list with plain timecodes: "[0-2 seconds] ...", "[2-5 seconds] ...", ' +
        'or state outright that it is one continuous uncut take.'
    );
  }

  if (mode === 'r2v') {
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
  }

  const lastBeat = beats.length ? Math.max(...beats) : 0;
  if (lastBeat > durationSeconds + 0.5) {
    warnings.push(
      `The prompt directs action out to ${lastBeat}s but the video is only ${durationSeconds.toFixed(2)}s. ` +
        'Rewrite the timecodes to fit, or raise --duration.'
    );
  } else if (beats.length && lastBeat > 0 && lastBeat < durationSeconds - 2) {
    warnings.push(
      `The last timed beat ends at ${lastBeat}s but the video runs to ${durationSeconds.toFixed(2)}s, ` +
        'leaving the tail undirected. Extend the shot list to the end.'
    );
  }

  // H3 generates native 32kHz stereo audio before the optional upload-time
  // strip, so an undirected soundtrack is still one nobody chose whenever the
  // audio track is kept.
  const hasAudioDirection =
    /(^|\n)\s*(audio|sound design|sound|sfx|soundscape|foley|music|bgm|score)\s*:/i.test(prompt) ||
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
    alignmentLine: false,
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
      options.alignmentLine = true;
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
  node workflow_minimax_h3_video.mjs --mode flf2v --image start.jpg --end-image end.jpg
  node workflow_minimax_h3_video.mjs --mode r2v --ref-image face.jpg --ref-image jacket.jpg --ref-image street.jpg

Modes:
  t2v    Text-to-video                     (minimax-h3-fl2va-fp8_t2v)
  i2v    First-frame image-to-video        (minimax-h3-fl2va-fp8_i2v,  needs --image)
  flf2v  First-and-last-frame video        (minimax-h3-fl2va-fp8_flf2v, needs --image and --end-image)
  r2v    Multi-reference video             (minimax-h3-ref2va-fp8_r2v, needs at least one --ref-image)

Fixed model parameters (not configurable):
  fps 24, steps 20, guidance 1, sampler res_multistep, scheduler simple
  Native 32kHz stereo audio is generated jointly and included by default;
  --no-audio returns a video without an audio track
  Frames follow 124 + n*17 in the range 124-362 (${MINIMAX_H3_MIN_DURATION}s to ${MINIMAX_H3_MAX_DURATION}s)
  Canvas uses a 32px grid, at most ${H3_MAX_PIXELS} pixels (1344x768 or 768x1344)
  Availability depends on current compatible capacity

Options:
  --mode <t2v|i2v|flf2v|r2v>  Workflow to run (default: t2v)
  --model <key>           Model key override (minimax-h3-t2v, minimax-h3-i2v,
                          minimax-h3-flf2v, minimax-h3-r2v)
  --image <path>          First-frame reference image (i2v, flf2v)
  --end-image <path>      Last-frame reference image (flf2v)
  --ref-image <path>      Reference image (r2v, repeatable up to ${MINIMAX_H3_MAX_REFERENCE_IMAGES})
  --ref-video <path>      Reference video (r2v, one upload slot - see below)
  --ref-audio <path>      Reference audio (r2v, one upload slot - see below)
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
  --alignment-line        ADVANCED: prepend MiniMax's reference-alignment line (i2v/flf2v)
  --no-audio              Strip the generated audio track before upload
  --audio                 Include generated audio (default)
  --negative [text]       Unsupported; exits with guidance to use the positive prompt
  --disable-safe-content-filter  Disable NSFW/safety filter
${billingModeHelpText()}
  --no-interactive        Skip interactive prompts
  --help                  Show this help message

Prompt format:
  Natural cinematic prose. No required structure, no field names, no tags.

  - For anything longer than a single beat, use a timed shot list with plain
    bracketed timecodes: "[0-2 seconds] ...", "[2-5 seconds] ...". This is the
    highest-leverage technique for pacing and it prevents slideshow drift.
  - Direct the audio as deliberately as the picture. H3 generates native 32kHz
    stereo audio jointly with the video, so describe ambience, specific SFX,
    and music with instrumentation and timing ("bring in the low beat at 3
    seconds"). Say so explicitly when you want no music.
  - Write dialogue as ordinary quoted prose:
      The pilot says: "AI needs a lot more datacenters."
  - State what you do NOT want directly in the prompt text. There is no
    negative-prompt field, and --negative is accepted only to warn you.
  - Give every reference image an explicit job, and lock identity by naming
    concrete features.

Multi-reference video (--mode r2v):
  Ref2VA conditions on labelled reference material instead of frame anchors.
  The checkpoint accepts up to ${MINIMAX_H3_MAX_REFERENCE_IMAGES} reference images, ${MINIMAX_H3_MAX_REFERENCE_VIDEOS} reference videos (24fps,
  2-15s each), and ${MINIMAX_H3_MAX_REFERENCE_AUDIOS} reference audio clips, at most ${MINIMAX_H3_MAX_REFERENCE_FILES} reference files
  in total.

  r2v runs on a Sogni worker rather than at a vendor, so every reference is
  uploaded through Sogni's asset path before the job is submitted.

  Repeat --ref-image up to ${MINIMAX_H3_MAX_REFERENCE_IMAGES} times; the SDK sends the first as
  referenceImage and the rest as contextImages, which upload to the numbered
  slots the worker feeds into ref_images. At least one is required.

  Repeat --ref-video and --ref-audio up to ${MINIMAX_H3_MAX_REFERENCE_VIDEOS} and ${MINIMAX_H3_MAX_REFERENCE_AUDIOS} times respectively. The SDK uploads each file to a distinct S3
  object. A reference video's own soundtrack is also presented to the model,
  numbered before any standalone reference audio. Reference videos are read as
  24fps; a clip at another frame rate plays back time-distorted.

  References are numbered from 1 per type, in the order images, then videos,
  then standalone audio, and the text encoder labels each one with a literal
  "<Picture i>: " / "<Video k>: " / "<Audio j>: " tag before your prompt text.
  Write the prompt with the SAME tags - <Picture 1>, <Video 1>, <Audio 1>, angle
  brackets included - rather than prose aliases. Give every one of them
  a separate job - separate identity from style, motion from appearance, and
  voice character from the words that are spoken - and say which reference wins
  when two disagree:

    <Picture 1> is the character's face and hairstyle. <Picture 2> is the
    wardrobe only. <Picture 3> is environment and lighting only. Where
    <Picture 1> and <Picture 3> disagree on exposure, <Picture 1> wins on her
    face.

  Reference resolution is a real cost/quality tradeoff. The workflow ships
  ref_image_size="match", which scales references down to the generation pixel
  area. The "max" setting uses a 2048px short edge for the best identity
  fidelity, but its reference tokens ride through every sampling step, making
  the render several times slower. Sogni does not expose "max".

  ADVANCED, optional: MiniMax also defines a speaker-tagged dialogue markup,

    ${ADVANCED_DIALOGUE_MARKUP}

  which can disambiguate many speakers. Sogni A/B testing found no quality
  difference for ordinary dialogue, so it is never required - and a prompt you
  supply with your own markup is sent through unchanged.

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
    console.log('  2. i2v    First-frame image-to-video');
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
    console.error(
      `Error: --ref-image/--ref-video/--ref-audio belong to --mode r2v. In ${OPTIONS.mode}, use --image` +
        `${OPTIONS.mode === 'flf2v' ? ' and --end-image' : ''}.`
    );
    process.exit(1);
  }
  if (OPTIONS.mode === 'r2v' && (OPTIONS.image || OPTIONS.endImage)) {
    console.error(
      'Error: r2v has no frame anchors. Pass its references as --ref-image (repeatable) instead of ' +
        '--image/--end-image.'
    );
    process.exit(1);
  }

  if (OPTIONS.mode !== 't2v' && OPTIONS.mode !== 'r2v' && !OPTIONS.printPrompt) {
    OPTIONS.image = await pickImageFile(OPTIONS.image, 'first-frame image');
  }
  if (OPTIONS.mode === 'flf2v' && !OPTIONS.printPrompt) {
    OPTIONS.endImage = await pickImageFile(OPTIONS.endImage, 'last-frame image');
  }
  if (OPTIONS.mode === 'r2v' && OPTIONS.refImages.length === 0 && !OPTIONS.printPrompt) {
    if (!OPTIONS.interactive || !process.stdin.isTTY) {
      console.error('Error: r2v requires at least one --ref-image.');
      process.exit(1);
    }
    OPTIONS.refImages.push(await pickImageFile(null, 'first reference image'));
  }
  if (OPTIONS.mode === 't2v' && (OPTIONS.image || OPTIONS.endImage)) {
    console.error('Error: t2v does not accept reference images. Use --mode i2v or --mode flf2v.');
    process.exit(1);
  }
  if (OPTIONS.mode === 'i2v' && OPTIONS.endImage) {
    console.error(
      'Error: the H3 i2v workflow takes only a first frame. Use --mode flf2v for two anchors.'
    );
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
  // cost estimate, the flf2v alignment line, and the output filename.
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
  // Effective duration of the rendered video, used by the flf2v alignment line.
  const effectiveDuration = OPTIONS.frames / MINIMAX_H3_FPS;

  // Prompt
  if (OPTIONS.promptFile) {
    OPTIONS.prompt = fs.readFileSync(OPTIONS.promptFile, 'utf8').trim();
  }
  if (!OPTIONS.prompt && OPTIONS.interactive && process.stdin.isTTY) {
    console.log(
      '\nWrite natural cinematic prose - a timed shot list plus audio direction works best.\n' +
        'Press enter to use the example prompt for this mode.\n'
    );
    OPTIONS.prompt = await askMultilinePrompt(
      'Prompt:',
      defaultPromptForMode(OPTIONS.mode, effectiveDuration, OPTIONS.alignmentLine),
      { consecutiveEmptyLinesToEnd: 2 }
    );
  }
  if (!OPTIONS.prompt) {
    OPTIONS.prompt = defaultPromptForMode(OPTIONS.mode, effectiveDuration, OPTIONS.alignmentLine);
  } else if (OPTIONS.alignmentLine && (OPTIONS.mode === 'i2v' || OPTIONS.mode === 'flf2v')) {
    // Prepend to a caller-supplied prompt too, but never rewrite the prompt
    // itself - markup a caller wrote stays exactly as they wrote it. t2v has no
    // references and r2v references are not pinned to a timecode, so neither has
    // an alignment line to prepend.
    const alignmentLine =
      OPTIONS.mode === 'i2v' ? I2V_ALIGNMENT_LINE : flf2vAlignmentLine(effectiveDuration);
    if (!OPTIONS.prompt.startsWith(alignmentLine)) {
      OPTIONS.prompt = `${alignmentLine}\n\n${OPTIONS.prompt}`;
    }
  }

  const promptWarnings = reviewPrompt(OPTIONS.prompt, effectiveDuration, OPTIONS.mode, {
    videos: OPTIONS.refVideos.length,
    audios: OPTIONS.refAudios.length
  });

  if (OPTIONS.printPrompt) {
    console.log(
      `--- ${OPTIONS.mode} prompt (${OPTIONS.frames} frames, ${effectiveDuration.toFixed(2)}s, ${OPTIONS.prompt.length} chars) ---\n`
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
    console.log('\n⚠️  Prompt review (advisory - H3 accepts any prompt):');
    promptWarnings.forEach((warning) => console.log(`   - ${warning}`));
    console.log();
  }

  // Fixed sampling parameters
  OPTIONS.fps = MINIMAX_H3_FPS;
  OPTIONS.steps = modelConfig.defaultSteps;
  OPTIONS.guidance = modelConfig.defaultGuidance;
  OPTIONS.sampler = modelConfig.defaultComfySampler;
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
        log('🔊', `Reference audio ${index + 1} (<Audio ${index + 1}>): ${path}`);
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
      // Ignore logout errors
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
