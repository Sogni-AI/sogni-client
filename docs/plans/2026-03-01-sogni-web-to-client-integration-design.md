# Design: Integrate sogni-web LLM Improvements into sogni-client Examples

**Date:** 2026-03-01
**File:** `examples/workflow_text_chat_sogni_tools.mjs`
**Source:** sogni-web branches `feature/Music-generation-support` and `feature/LTX-2-ScriptCreator`

## Summary

Port three categories of improvements from sogni-web's AI Screenwriter/Songwriter features into the sogni-client SDK example `workflow_text_chat_sogni_tools.mjs`:

1. Duration-aware video pacing hints
2. Enriched video system prompt (audio, dialogue, writing rules)
3. Thinking tag stripping before JSON parsing (display preserved)

Plus a supporting change: `--duration` CLI arg for video.

## Change 1: `--duration` CLI Arg

Add `--duration` option to `parseArgs()`. Default: 10. Range: 1-10 (LTX-2 constraint). Replaces the hardcoded `const videoDuration = 10` in `generateMedia()`. Passed through to `composeVideo()` for pacing hint computation.

## Change 2: `computePacingHint(duration)`

New function ported from sogni-web's `src/App/redux/ltx2video/utils.ts`.

Calculates action beat count: `Math.max(1, Math.min(10, Math.round(duration / 4)))` — roughly 1 action per 4 seconds of video, capped at 1-10.

Returns a strict instruction string appended to the user message in `composeVideo()`:
- For 1 action: "Write EXACTLY 1 action. One single moment. HARD STOP after the 1st action."
- For N actions: "Write EXACTLY N distinct actions. Each action takes roughly M seconds. HARD STOP after the Nth action."

## Change 3: Enrich `VIDEO_SYSTEM_PROMPT`

Keep existing JSON response format and 8-step construction order. Add these rules from sogni-web:

### New rules to add:

- **Audio description** (new guidance after step 5 DIALOGUE): For each action beat, weave ambient sound naturally into the prose as descriptive clauses — max 2 sounds active at any one time. The soundscape evolves with the scene. Never write `[AMBIENT: ...]` tags. Sound is part of the prose.

- **Dialogue formatting** (enhance existing step 5): Write dialogue as inline prose woven into the action, attributed with delivery and physical action — like a novel. Never use `[DIALOGUE: ...]` tags. Examples from sogni-web's prompt.

- **Shot-scale detail matching** (add to step 1): "Match detail level to shot scale: close-ups need more physical detail, wide shots need more environmental detail."

- **Anti-vague-words** (add to HARD CONSTRAINTS): "Do not use vague words like 'beautiful', 'nice', or 'amazing' — describe exactly what makes it visually striking."

- **Full-length instruction** (add to HARD CONSTRAINTS): "Fill the full available prompt length — do not stop early. Write dense, flowing prose — not a bullet list."

### Unchanged:

- JSON response structure (`prompt`, `camera_movement`, `shot_scale`, `style_anchor`, `stability_anchor`)
- Camera movement enum and validation
- Metadata safety net (appending fields to prompt if LLM forgot to embed them)
- Reference example (update to include audio/dialogue elements)

## Change 4: Strip Thinking Tags Before Parsing

New helper: `stripThinkingTags(content)` — removes `<think>...</think>` blocks via regex.

Applied in `composeVideo()`, `composeImage()`, and `composeSong()` on the accumulated `raw` string **before** passing to the JSON parser.

The streaming display to the user is unaffected — thinking output remains visible during streaming. Only the parsing input is cleaned.

## What Doesn't Change

- `AUDIO_SYSTEM_PROMPT` — already superior in sogni-client
- `IMAGE_SYSTEM_PROMPT` — no sogni-web equivalent exists
- `src/Chat/tools.ts` — no changes
- JSON parsers (`parseVideoJSON`, `parseImageJSON`, `parseSongJSON`) — logic unchanged
- Other example files — not modified
