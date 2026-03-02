# sogni-web LLM Improvements → sogni-client Examples Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Port sogni-web's video pacing hints, enriched video prompt rules, and thinking tag stripping into `examples/workflow_text_chat_sogni_tools.mjs`.

**Architecture:** All changes are inline in the single example file. A `computePacingHint(duration)` function is added and injected into the user message during video composition. The `VIDEO_SYSTEM_PROMPT` is enriched with audio/dialogue/writing rules. A `stripThinkingTags()` helper cleans LLM output before JSON parsing while keeping thinking visible in streamed output. A `--duration` CLI arg replaces the hardcoded video duration.

**Tech Stack:** Node.js ESM, Sogni SDK (`@sogni-ai/sogni-client`)

---

### Task 1: Add `stripThinkingTags` helper

**Files:**
- Modify: `examples/workflow_text_chat_sogni_tools.mjs:156` (after `detectMediaIntent`, before `openFile`)

**Step 1: Add the helper function**

Insert after the `detectMediaIntent` function (after line 156), before the `openFile` section comment:

```javascript
// ============================================================
// Strip LLM thinking tags before parsing (display is preserved via streaming)
// ============================================================

function stripThinkingTags(content) {
  return content.replace(/^<think>[\s\S]*?<\/think>\s*/i, '');
}
```

**Step 2: Apply in `composeVideo`**

In `composeVideo()` at line 430, change:
```javascript
    const videoParams = parseVideoJSON(raw, userMessage);
```
to:
```javascript
    const videoParams = parseVideoJSON(stripThinkingTags(raw), userMessage);
```

**Step 3: Apply in `composeImage`**

In `composeImage()` at line 540 (approx, after step 1 shifts lines), change:
```javascript
    const imageParams = parseImageJSON(raw, userMessage);
```
to:
```javascript
    const imageParams = parseImageJSON(stripThinkingTags(raw), userMessage);
```

**Step 4: Apply in `composeSong`**

In `composeSong()` at line 651 (approx), change:
```javascript
    const songParams = parseSongJSON(raw, userMessage);
```
to:
```javascript
    const songParams = parseSongJSON(stripThinkingTags(raw), userMessage);
```

**Step 5: Commit**

```bash
git add examples/workflow_text_chat_sogni_tools.mjs
git commit -m "chore: strip LLM thinking tags before JSON parsing in sogni tools example"
```

---

### Task 2: Add `--duration` CLI arg

**Files:**
- Modify: `examples/workflow_text_chat_sogni_tools.mjs` — `parseArgs()`, `showHelp()`, file header comment, and `generateMedia()` video case

**Step 1: Add `duration` to options defaults**

In `parseArgs()` options object (line 56-66), add after `quantity: 1,`:
```javascript
    duration: 10,
```

**Step 2: Add arg parser case**

In the `for` loop in `parseArgs()` (around line 87), add before the `--quantity` case:
```javascript
    } else if (arg === '--duration' && args[i + 1]) {
      options.duration = Math.max(1, Math.min(10, parseFloat(args[++i]) || 10));
```

**Step 3: Update `showHelp()`**

In the help text (around line 117), add after the `--quantity` line:
```
  --duration      Video duration in seconds, 1-10 (default: 10)
```

**Step 4: Update file header doc comment**

In the header comment (around line 31), add after the `--quantity` line:
```
 *   --duration      Video duration in seconds, 1-10 (default: 10)
```

**Step 5: Replace hardcoded duration in `generateMedia` video case**

In the video case of `generateMedia()` (line 923), change:
```javascript
      const videoDuration = 10;
```
to:
```javascript
      const videoDuration = options.duration;
```

This requires passing `options` through. Update the `generateMedia` function signature from:
```javascript
async function generateMedia(sogni, mediaType, promptOrParams, tokenType, quantity = 1) {
```
to:
```javascript
async function generateMedia(sogni, mediaType, promptOrParams, tokenType, quantity = 1, options = {}) {
```

And update the three call sites in `main()` (around lines 1184, 1188, 1192) to pass `options`:
```javascript
result = await generateMedia(sogni, 'audio', songParams, tokenType, options.quantity, options);
result = await generateMedia(sogni, 'image', imageParams, tokenType, options.quantity, options);
result = await generateMedia(sogni, 'video', videoParams, tokenType, options.quantity, options);
```

**Step 6: Display duration in video config output**

In the video generation console log (around line 938), change:
```javascript
      console.log(`\n  Generating ${quantity > 1 ? quantity + ' videos' : 'video'} with ${modelId}...`);
```
to:
```javascript
      console.log(`\n  Generating ${quantity > 1 ? quantity + ' videos' : 'video'} with ${modelId} (${videoDuration}s, ${videoFps}fps)...`);
```

**Step 7: Commit**

```bash
git add examples/workflow_text_chat_sogni_tools.mjs
git commit -m "chore: add --duration CLI arg for video generation in sogni tools example"
```

---

### Task 3: Add `computePacingHint` and inject into video composition

**Files:**
- Modify: `examples/workflow_text_chat_sogni_tools.mjs` — new function + modify `composeVideo()`

**Step 1: Add `computePacingHint` function**

Insert before `composeVideo()` (before the `parseVideoJSON` function), after the `stripThinkingTags` section:

```javascript
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
    `Do not write a ${actionCount + 1}th action under any circumstances.`
  );
}
```

**Step 2: Update `composeVideo` to accept duration and inject pacing hint**

Change the function signature from:
```javascript
async function composeVideo(sogni, userMessage, options, tokenType) {
```
to:
```javascript
async function composeVideo(sogni, userMessage, options, tokenType, duration = 10) {
```

Change the user content building (lines 390-394) from:
```javascript
  const userContent = options.think ? userMessage : `${userMessage} /no_think`;
  const messages = [
    { role: 'system', content: VIDEO_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
```
to:
```javascript
  const pacingHint = computePacingHint(duration);
  const userContent = options.think
    ? `${userMessage}\n\n${pacingHint}`
    : `${userMessage}\n\n${pacingHint} /no_think`;
  const messages = [
    { role: 'system', content: VIDEO_SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
```

**Step 3: Update call site to pass duration**

In `main()` (around line 1191), change:
```javascript
        const videoParams = await composeVideo(sogni, userInput, options, tokenType);
```
to:
```javascript
        const videoParams = await composeVideo(sogni, userInput, options, tokenType, options.duration);
```

**Step 4: Commit**

```bash
git add examples/workflow_text_chat_sogni_tools.mjs
git commit -m "chore: add duration-aware pacing hints for video prompt composition"
```

---

### Task 4: Enrich `VIDEO_SYSTEM_PROMPT` with sogni-web rules

**Files:**
- Modify: `examples/workflow_text_chat_sogni_tools.mjs` — `VIDEO_SYSTEM_PROMPT` constant (lines 238-278)

**Step 1: Replace `VIDEO_SYSTEM_PROMPT` with enriched version**

Replace the entire `VIDEO_SYSTEM_PROMPT` constant with:

```javascript
const VIDEO_SYSTEM_PROMPT = `You are an expert cinematographer writing prompts for the LTX-2 AI video generation model. LTX-2 performs best when the prompt reads like a cohesive mini-scene: a complete story beat described in present tense. Clear camera-to-subject relationship improves motion consistency.

Return ONLY a valid JSON object (no markdown fences, no commentary) with these fields:
{"prompt":"...","camera_movement":"slow push-in","shot_scale":"medium","style_anchor":"cinematic nocturne","stability_anchor":"smooth and stabilised"}

PROMPT CONSTRUCTION — Write a single flowing paragraph of 4-8 sentences in present tense. A single continuous shot (no hard cuts, no "cut to", no montage). Follow this mandatory order:

1. ESTABLISH THE SHOT: Shot scale (wide, medium, close-up) + genre/visual language. Match detail level to shot scale: close-ups need more physical detail, wide shots need more environmental detail. Example: "A medium close-up cinematic shot..."

2. SET THE SCENE: Environment + time of day + atmosphere/weather + surface textures + one or two grounding details. Name light sources and their quality: "warm tungsten practical lights", "golden hour sun through dusty windows", "neon reflections shimmering across wet pavement".

3. DEFINE CHARACTER(S): Age range, hair, clothing, notable features. Keep identity stable and coherent throughout.

4. DESCRIBE ACTION AS A NATURAL SEQUENCE: One main action thread that evolves beginning to end. Use temporal connectors ("as", "then", "while"). Prefer physically filmable behavior: a steady walk, a slow turn, a hand reaching forward, eyes shifting.

5. DIALOGUE (when applicable): If the user's request involves a character speaking, pitching, narrating, or delivering lines, write the EXACT quoted dialogue the character says. Write dialogue as inline prose woven into the action, attributed with delivery and physical action — exactly like a novel. The spoken words sit inside the sentence, not in a separate block. Examples of correct format:
   'He leans back, satisfied, "I think I'll have to go back tomorrow for more," he chuckles, his eyes crinkling at the corners.'
   '"Don't stop," she breathes, gripping the sheets, her voice barely above a whisper.'
   'She turns to face him, "I've been waiting all day for this," her tone quiet and certain.'
   NEVER use [DIALOGUE: ...] tags. NEVER write dialogue as a separate bracketed block. Dialogue flows inside the prose as part of the action.

6. AMBIENT SOUND: For each action beat, weave ambient sound naturally into the prose as a descriptive sentence or clause — never as a tag or label. Maximum 2 sounds active at any one time. The soundscape should evolve with the scene — each beat has its own sonic texture that matches its mood and energy. Examples of correct format: "the refrigerator hums steadily in the background as she moves", "rain begins to tap softly against the window", "birdsong drifts through the gap in the curtains, barely audible over her breathing". Never write [AMBIENT: ...] tags. Sound is part of the prose, always.

7. SPECIFY ONE COMMITTED CAMERA MOVEMENT: Pick exactly one from: "static tripod", "slow push-in", "slow pull-back", "smooth pan left", "smooth pan right", "slow tilt up", "slow tilt down", "slow arc left", "slow arc right", "tracking follow", "handheld subtle drift". Describe the camera's relationship to the subject and what is revealed by the move.

8. EMOTIONAL SPECIFICITY VIA PHYSICAL CUES: Jaw tension, grip pressure, breathing pace, glance direction, weight shift, posture changes — express all emotion through visible physical behavior.

9. STABILITY + MOTION ANCHORS: Include at least one: "smooth and stabilised", "tripod-locked", "cinematic motion consistency", "natural motion blur", "steady pace".

HARD CONSTRAINTS:
- Exactly one camera movement per prompt
- Present tense verbs throughout
- All phrasing must be positive (express what IS present, visible, happening)
- No on-screen text, logos, or signage directives (quoted dialogue is fine)
- Do not use vague words like "beautiful", "nice", or "amazing" — describe exactly what makes it visually striking
- Fill the full available prompt length — do not stop early
- Write dense, flowing prose — not a bullet list

camera_movement — Choose exactly one: "static tripod", "slow push-in", "slow pull-back", "smooth pan left", "smooth pan right", "slow tilt up", "slow tilt down", "slow arc left", "slow arc right", "tracking follow", "handheld subtle drift"

shot_scale — "wide", "medium", or "close-up"

style_anchor — 0-2 short phrases (e.g., "cinematic nocturne", "documentary handheld feel")

stability_anchor — One stabiliser phrase (e.g., "smooth and stabilised", "tripod-locked", "cinematic motion consistency")

REFERENCE (study the style and structure):
{"prompt":"A medium close-up cinematic shot in a quiet, rain-soaked alley at night, neon reflections shimmering across wet pavement and brick. A man in his 30s with short dark hair and a worn leather jacket stands under a flickering sign, water beading on his collar and eyelashes. He exhales slowly, shoulders tightening as his fingers clamp around a small metal lighter, then he steadies his hand and clicks it once, watching the flame struggle against the damp air, rain tapping softly against the awning above while a distant car horn echoes off the wet walls. The camera performs a slow push-in toward his face, keeping the lighter flame in the foreground as his eyes track a faint movement deeper in the alley. His jaw sets, the tendons in his neck rising as he shifts his weight forward by half a step, breathing measured and controlled. Smooth and stabilised with cinematic motion consistency and natural motion blur, lit by diffused neon glow and soft practical highlights.","camera_movement":"slow push-in","shot_scale":"medium","style_anchor":"cinematic nocturne","stability_anchor":"smooth and stabilised"}

Return ONLY the JSON object.`;
```

Key changes from the original:
- Step 1: Added shot-scale detail matching rule
- Step 5: Expanded with sogni-web's inline prose dialogue rules and examples
- Step 6: NEW — ambient sound rules from sogni-web (max 2 sounds, evolve with scene, prose not tags)
- Steps 7-9: Renumbered (were 6-8)
- HARD CONSTRAINTS: Added anti-vague-words rule, full-length instruction, dense-prose instruction
- REFERENCE: Updated to include ambient sound woven into prose

**Step 2: Commit**

```bash
git add examples/workflow_text_chat_sogni_tools.mjs
git commit -m "chore: enrich video system prompt with audio, dialogue, and writing rules from sogni-web"
```

---

### Task 5: Verify and final commit

**Step 1: Check syntax**

```bash
node --check examples/workflow_text_chat_sogni_tools.mjs
```
Expected: no output (success)

**Step 2: Quick visual review**

Scan the file for:
- `stripThinkingTags` used in all three compose functions
- `computePacingHint` called in `composeVideo`
- `options.duration` used instead of hardcoded `10`
- Enriched `VIDEO_SYSTEM_PROMPT` has 9 steps + HARD CONSTRAINTS
- `--duration` in help text and header comment

**Step 3: Final commit if any fixups needed**

```bash
git add examples/workflow_text_chat_sogni_tools.mjs
git commit -m "chore: integrate sogni-web LLM improvements into sogni tools example"
```
