# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## LLM Documentation Resources

For AI coding assistants working with this SDK, the following resources are available:

- **`llms.txt`** - Indexed quick reference with code examples
- **`llms-full.txt`** - Comprehensive documentation (~25KB) with complete API reference
- **`dist/index.d.ts`** - TypeScript type definitions (after build)
- **API Docs**: https://sdk-docs.sogni.ai

When helping users with Sogni SDK tasks, consult `llms-full.txt` for complete parameter references, especially for video generation where WAN 2.2 and LTX-2 models have different behaviors.

## Overview

This is the **Sogni SDK for JavaScript/Node.js** - a TypeScript client library for the Sogni Supernet, a DePIN protocol for creative AI inference. The SDK supports image generation (Stable Diffusion, Flux, etc.), video generation (WAN 2.2 and LTX-2 models), audio generation (ACE-Step 1.5), LLM chat with tool calling, and multimodal vision chat (Qwen3.5 VLM) via WebSocket communication.

## Build & Development Commands

```bash
# Build the project (compiles TypeScript to dist/)
npm run build

# Watch mode for development
npm run watch

# Format code with Prettier
npm run prettier:fix

# Check formatting
npm run prettier

# Generate API documentation
npm run docs
```

## Architecture

### Entry Point & Main Classes

**SogniClient** (`src/index.ts`) - Main entry point, created via `SogniClient.createInstance()`:
- `account: AccountApi` - Authentication, balance, rewards
- `projects: ProjectsApi` - Create/track AI generation jobs
- `stats: StatsApi` - Leaderboard data
- `apiClient: ApiClient` - Internal REST + WebSocket communication

### Core Entity Hierarchy

**DataEntity** (`src/lib/DataEntity.ts`) - Base class for reactive entities with event emission:
- `Project` (`src/Projects/Project.ts`) - Represents an image/video generation request
- `Job` (`src/Projects/Job.ts`) - Individual generation task within a project

### Communication Layer

**ApiClient** (`src/ApiClient/index.ts`) orchestrates:
- `RestClient` (`src/lib/RestClient.ts`) - HTTP requests with auth
- `WebSocketClient` (`src/ApiClient/WebSocketClient/`) - Real-time events
- `AuthManager` (`src/lib/AuthManager/`) - Token or cookie-based authentication

### Module Structure

```
src/
├── index.ts              # SogniClient + public exports
├── ApiClient/            # REST + WebSocket communication
│   └── WebSocketClient/  # Real-time protocol (includes browser multi-tab support)
├── Projects/             # Project/Job management
│   ├── types/            # ProjectParams, RawProject, events
│   └── utils/            # Samplers, schedulers
├── Account/              # User auth & balance (CurrentAccount entity)
├── Stats/                # Leaderboard API
├── lib/                  # Shared utilities
│   ├── AuthManager/      # Token/Cookie auth strategies
│   ├── DataEntity.ts     # Base reactive entity
│   ├── TypedEventEmitter.ts
│   └── RestClient.ts
└── types/                # Global types (ErrorData, token)
```

### Key Patterns

- **Event-driven architecture**: TypedEventEmitter for reactive updates throughout
- **Strategy pattern**: AuthManager with swappable TokenAuthManager/CookieAuthManager
- **Factory pattern**: `SogniClient.createInstance()` for initialization
- **Observer pattern**: Project/Job emit 'updated', 'completed', 'failed' events

### Data Flow

1. User calls `sogni.projects.create()` → Project entity created → 'jobRequest' sent via WebSocket
2. Server sends `jobState`, `jobProgress`, `jobResult` events → Updates Project/Job entities
3. Entities emit events → User code receives 'progress', 'completed', 'failed'

### Network Types

- `fast` - High-end GPUs, faster but more expensive. Required for video generation.
- `relaxed` - Mac devices, cheaper. Image generation only.

## Video Model Architecture

The SDK supports two families of video models with **fundamentally different FPS and frame count behavior**.

### Standard Behavior (LTX-2 and future models)

**LTX-2 Models (`ltx2-*`)** represent the standard behavior going forward:
- **Generate at the actual specified FPS** (1-60 fps range)
- No post-render interpolation - fps directly affects generation
- **Frame calculation**: `duration * fps + 1`
- **Frame step constraint**: Frame count must follow pattern `1 + n*8` (i.e., 1, 9, 17, 25, 33, ...)
- Example: 5 seconds at 24fps = 121 frames (snapped to 1 + 15*8 = 121)

### Legacy Behavior (WAN 2.2 only)

**WAN 2.2 Models (`wan_v2.2-*`)** are the outlier with legacy behavior:
- **Always generate at 16fps internally**, regardless of the user's fps setting
- The `fps` parameter (16 or 32) controls **post-render frame interpolation only**
- `fps=16`: No interpolation, output matches generation (16fps)
- `fps=32`: Frames are doubled via interpolation after generation
- **Frame calculation**: `duration * 16 + 1` (always uses 16, ignores fps)
- Example: 5 seconds at 32fps = 81 frames generated → interpolated to 161 output frames

### Key Files
- `src/Projects/utils/index.ts` - `isWanModel()`, `isLtx2Model()`, `calculateVideoFrames()`
- `src/Projects/createJobRequestMessage.ts` - Uses `calculateVideoFrames()` for duration→frames conversion
- `src/Projects/types/index.ts` - `VideoProjectParams` interface with detailed documentation

## Git Safety Rules

**CRITICAL: Before running ANY destructive git command (`git reset --hard`, `git checkout .`, `git clean`, etc.):**

1. **ALWAYS run `git status` first** to check for uncommitted changes
2. **ALWAYS run `git stash` to preserve uncommitted work** before reset operations
3. After the operation, offer to `git stash pop` to restore the changes

Uncommitted working directory changes are NOT recoverable after `git reset --hard`. Never assume the working directory is clean.

## Commit Message Conventions

This repository uses **conventional commits** for semantic versioning of the npm package:

- **`feat:`** - New features. Triggers a **minor** version bump (e.g., 4.0.0 → 4.1.0)
- **`fix:`** - Bug fixes. Triggers a **patch** version bump (e.g., 4.0.0 → 4.0.1)
- **`chore:`** - Maintenance tasks, documentation, examples. **No version bump** - won't publish a new SDK version

**Examples:**
```
feat: Add support for new video model
fix: Correct frame calculation for LTX-2 models
chore: Update example scripts for video generation
```

**Important:** Changes that only affect the `/examples` folder should typically use `chore:` since they don't affect the published SDK package.

## Common Tasks Quick Reference

### Generate an Image
```javascript
const project = await sogni.projects.create({
  type: 'image',
  modelId: 'flux1-schnell-fp8',
  positivePrompt: 'Your prompt here',
  numberOfMedia: 1,
  steps: 4,
  guidance: 1
});
const urls = await project.waitForCompletion();
```

### Generate a Video (WAN 2.2)
```javascript
const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',  // Required for video
  modelId: 'wan_v2.2-14b-fp8_t2v_lightx2v',
  positivePrompt: 'Your prompt here',
  numberOfMedia: 1,
  duration: 5,  // seconds
  fps: 16
});
const urls = await project.waitForCompletion();
```

### Generate Music (ACE-Step 1.5)
```javascript
const project = await sogni.projects.create({
  type: 'audio',
  modelId: 'ace_step_1.5_turbo',  // or 'ace_step_1.5_sft'
  positivePrompt: 'Upbeat electronic dance music with synth leads',
  numberOfMedia: 1,
  duration: 30,       // 10-600 seconds
  bpm: 128,           // 30-300
  keyscale: 'C major',
  timesignature: '4', // 4/4 time
  steps: 8,
  outputFormat: 'mp3'
});
const urls = await project.waitForCompletion();
```

### Audio Model Variants
| Model ID | Name | Description |
|----------|------|-------------|
| `ace_step_1.5_turbo` | Fast & Catchy | Quick generation, best quality sound |
| `ace_step_1.5_sft` | More Control | More accurate lyrics, less stable |

### Video Workflow Asset Requirements
| Workflow | Model Pattern | Required Assets |
|----------|---------------|-----------------|
| Text-to-Video | `*_t2v*` | None |
| Image-to-Video | `*_i2v*` | `referenceImage` (and/or `referenceImageEnd`) |
| Video-to-Video | `*_v2v*` (LTX-2 only) | `referenceVideo` + `controlNet` |
| Sound-to-Video | `*_s2v*` (WAN only) | `referenceImage` + `referenceAudio` |
| Image+Audio-to-Video | `*_ia2v*` (LTX-2 only) | `referenceImage` + `referenceAudio` |
| Audio-to-Video | `*_a2v*` (LTX-2 only) | `referenceAudio` |
| Animate-Move | `*_animate-move*` | `referenceImage` + `referenceVideo` |
| Animate-Replace | `*_animate-replace*` | `referenceImage` + `referenceVideo` |

## LLM Chat — Thinking Models & Tool Calling

### Model Capabilities via `sogni.chat.waitForModels()`

The SDK receives `LLMModelInfo` per model including `maxContextLength`, `maxOutputTokens` (min/max/default), and parameter constraints. Use these to configure `max_tokens` and display limits to users.

**Caution**: `maxContextLength` from the server may not reflect the actual per-request limit on the worker (see sogni-socket and sogni-llm-nvidia CLAUDE.md for the llama-server `--parallel` slot division issue).

### Thinking Models (Qwen3/3.5) — `reasoning_content` Split

Qwen3/3.5 models generate thinking output in a separate `reasoning_content` field (OpenAI-compatible). The LLM worker wraps this in `<think>` tags inside `content` for the SDK, or strips it when `/no_think` is in the messages. **However**, the SDK's `ChatCompletionChunk` type has NO `reasoning_content` field — only `content` and `tool_calls`.

**The problem**: Even with `think: false` (which appends `/no_think`), the model still generates thinking tokens internally, consuming output budget. If the context window is tight, the model exhausts its output tokens on thinking before producing content or tool calls → `finishReason=length` with empty content and no tool calls.

**The solution for structured output**: Use **tool calling** (`tools` + `tool_choice: 'required'`). Tool call arguments are always forwarded by the worker regardless of thinking mode. The `workflow_text_chat_sogni_tools.mjs` example uses this pattern for all composition pipelines (video/image/audio prompt engineering).

### Composition Pipeline Architecture

The example's composition pipelines (composeVideo, composeImage, composeSong) use:
1. **Tool calling as the primary output mechanism** — `tool_choice: 'required'` with a structured tool schema
2. **Trimmed system prompts** — Creative guidance only; structural/format info is in the tool schema (reduces input tokens for tight context windows)
3. **Model info from `waitForModels()`** — `maxOutputTokens.default` for `max_tokens`
