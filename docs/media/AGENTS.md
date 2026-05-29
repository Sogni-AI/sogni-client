# AGENTS.md

This file provides guidance to AI coding assistants (Claude Code, Codex, etc.) when working with code in this repository.

## LLM Documentation Resources

For AI coding assistants working with this SDK, the following resources are available:

- **`llms.txt`** - Indexed quick reference with code examples
- **`llms-full.txt`** - Comprehensive documentation (~25KB) with complete API reference
- **`dist/index.d.ts`** - TypeScript type definitions (after build)
- **API Docs**: https://sdk-docs.sogni.ai

When helping users with Sogni SDK tasks, consult `llms-full.txt` for complete parameter references, especially for video generation where WAN 2.2 and LTX-2.3 models have different behaviors.

These are public agent-facing docs shipped with the npm package. They are kept aligned with:

- `package.json` for package version, runtime engines, npm scripts, exports, and published files.
- `src/index.ts` for public SDK namespaces and root exports.
- `src/Projects/types/index.ts`, `src/Projects/utils/index.ts`, and `src/Projects/createJobRequestMessage.ts` for media-generation parameters and video frame behavior.
- `src/Chat/types.ts`, `src/Chat/index.ts`, `src/Chat/tools.ts`, and `src/Chat/hostedToolValidation.generated.ts` for chat, hosted tools, structured outputs, and durable runs.
- `src/CreativeWorkflows/` and `src/Replay/` for durable workflow and RunRecord APIs.

Current public API anchors:

- The SDK runtime requirement is **Node.js >=22** (`package.json#engines`).
- Socket-native LLM chat uses `sogni.chat.completions.create()`.
- Durable creative workflows use `sogni.workflows`.
- Project cost helpers are `sogni.projects.estimateCost()`, `estimateVideoCost()`, and `estimateAudioCost()`.
- `checkAuth()` is only for cookie-auth browser flows. API-key auth auto-authenticates during `createInstance()`, and token auth uses `login()` or `setTokens()`.
- `ChatCompletionResult` is SDK-shaped (`content`, `role`, `finishReason`, `tool_calls`, `usage`, `cost`). Streaming chunks expose `chunk.content` and optional `chunk.tool_calls`.

## Sogni Intelligence APIs

The SDK wraps the public Sogni Intelligence endpoints used for text chat, hosted creative tools, durable chat turns, and deterministic multi-step workflows.

- `sogni.chat.completions.create()` maps to socket-native chat completions and supports text, streaming, vision input, custom function tools, Sogni tool injection, structured outputs, and `think` / `taskProfile` controls.
- `sogni.chat.hosted.create()` maps to `POST /v1/chat/completions`, the OpenAI-compatible REST chat endpoint. It can execute Sogni media-generation and composition tools server-side.
- `sogni.chat.runs` maps to `/v1/chat/runs`, a durable hosted-chat turn with persisted state, event replay, cancellation, and recovery across client disconnects.
- `sogni.workflows` maps to `/v1/creative-agent/workflows`, where callers submit exact multi-step creative plans and observe durable execution through snapshots, event logs, or SSE.
- `sogni.workflows.templates` maps to `/v1/creative-agent/workflows/templates`, the CRUD and fork API for saved, parameterized workflow recipes.
- `sogni.replay` maps to `/v1/replay/records`, the RunRecord write/list/get surface for replay viewers and audit tooling.

Public chat and workflow media rules:

- Vision chat accepts inline PNG or JPEG `data:` URIs through OpenAI-style `image_url` content parts.
- Durable chat runs and creative workflows use retrievable HTTP(S) media references, often produced by Sogni upload/download URL helpers.
- Request media references are addressable by media index in hosted tool and workflow calls, so later steps can reuse uploaded or generated images, videos, and audio without copying URLs into prompts.

## Overview

This is the **Sogni SDK for JavaScript/Node.js** - a TypeScript client library for the Sogni Supernet, a DePIN protocol for creative AI inference. The SDK supports image generation (Stable Diffusion, Flux, Z-Image, Qwen image-edit models, GPT Image 2), video generation (WAN 2.2, LTX-2.3, Seedance 2.0), audio generation (ACE-Step 1.5), LLM chat with tool calling, hosted creative tools, durable creative workflows, replay records, and multimodal vision chat (Qwen3.6 35B VLM, default `qwen3.6-35b-a3b-gguf-iq4xs`).

Runtime and packaging:

- Node.js `>=22` is required by `package.json`.
- CommonJS build: `dist/index.js`; ESM build: `dist-esm/index.js`; type declarations: `dist/index.d.ts`.
- Published package files include `README.md`, `AGENTS.md`, `llms.txt`, `llms-full.txt`, `dist/`, `dist-esm/`, and `src/`.

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

# Validate generated hosted-tool validation file is in sync
npm run check:hosted-tool-validation

# Validate generated hosted-tool manifest is in sync
npm run check:hosted-tools-manifest

# Build and run chat model-routing checks
npm run test:chat-routing

# Generate API documentation
npm run docs
```

Generated artifacts:

- `src/Chat/sogniHostedTools.generated.json` is regenerated with `npm run sync:hosted-tools-manifest`.
- `src/Chat/hostedToolValidation.generated.ts` is regenerated with `npm run sync:hosted-tool-validation`.
- `docs/` is generated by TypeDoc via `npm run docs`.
- `dist/` and `dist-esm/` are generated by `npm run build`.

## Architecture

### Entry Point & Main Classes

**SogniClient** (`src/index.ts`) - Main entry point, created via `SogniClient.createInstance()`:
- `account: AccountApi` - Authentication, balance, rewards
- `projects: ProjectsApi` - Create/track AI generation jobs
- `stats: StatsApi` - Leaderboard data
- `chat: ChatApi` - Unified chat namespace:
  - `chat.completions.create` - Socket-native synchronous chat
  - `chat.hosted.create` - Hosted synchronous chat via `/v1/chat/completions`
  - `chat.runs.{create, get, cancel, streamEvents}` - Durable hosted chat runs via `/v1/chat/runs` with SSE replay
  - `chat.tools` - Tool helpers (build, parse, validate)
- `workflows: CreativeWorkflowsApi` - Durable explicit creative workflows via `/v1/creative-agent/workflows`
  - `workflows.{start, list, get, events, streamEvents, resume, reseed, cancel}`
  - `workflows.templates.{list, get, create, update, delete, fork}`
- `replay: ReplayApi` - RunRecord write/list/get via `/v1/replay/records`
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
├── Chat/                 # Socket chat, hosted REST chat, durable runs, hosted tools
├── CreativeWorkflows/    # Durable explicit workflow API + template CRUD
├── Replay/               # RunRecord ingest/list/get API
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

LLM chat flow:

1. User calls `sogni.chat.completions.create()` → SDK sends `llmJobRequest` via WebSocket.
2. Server streams `jobTokens` and terminal `llmJobResult` / `llmJobError` events.
3. Streaming callers iterate `ChatStream`; non-streaming callers receive `ChatCompletionResult`.
4. Hosted REST chat uses `sogni.chat.hosted.create()`; durable chat runs use `sogni.chat.runs`.

Durable workflow flow:

1. User calls `sogni.workflows.start()` with either an inline `input` plan or `workflowId` + `inputs`.
2. REST API persists the workflow and returns a `CreativeWorkflowRecord`.
3. Callers inspect `get()` / `events()` or consume `streamEvents()` with SSE resume support.

### Network Types

- `fast` - High-end GPUs, faster but more expensive. Required for video generation.
- `relaxed` - Mac devices, cheaper. Image generation only.

## Video Model Architecture

The SDK supports two families of video models with **fundamentally different FPS and frame count behavior**.

### Standard Behavior (LTX-2.3 and future models)

**LTX-2.3 Models (`ltx2-*`, `ltx23-*`)** represent the standard behavior going forward. **LTX-2.3 (22B)** is the recommended video model family:
- **Generate at the actual specified FPS** (1-60 fps range)
- No post-render interpolation - fps directly affects generation
- **Frame calculation**: `duration * fps + 1`
- **Frame step constraint**: Frame count must follow pattern `1 + n*8` (i.e., 1, 9, 17, 25, 33, ...)
- Example: 5 seconds at 24fps = 121 frames (snapped to 1 + 15*8 = 121)

### WAN 2.2 Behavior

**WAN 2.2 Models (`wan_v2.2-*`)** use a fixed internal generation rate:
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
fix: Correct frame calculation for LTX-2.3 models
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

### Generate a Video (LTX-2.3)
```javascript
const project = await sogni.projects.create({
  type: 'video',
  network: 'fast',  // Required for video
  modelId: 'ltx23-22b-fp8_t2v_distilled',
  positivePrompt: 'Your prompt here',
  numberOfMedia: 1,
  duration: 5,  // seconds
  fps: 24
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
| Video-to-Video | `*_v2v*` (LTX-2.3) | `referenceVideo` + `controlNet` |
| Sound-to-Video | `*_s2v*` (WAN only) | `referenceImage` + `referenceAudio` |
| Image+Audio-to-Video | `*_ia2v*` (LTX-2.3) | `referenceImage` + `referenceAudio` |
| Audio-to-Video | `*_a2v*` (LTX-2.3) | `referenceAudio` |
| Animate-Move | `*_animate-move*` | `referenceImage` + `referenceVideo` |
| Animate-Replace | `*_animate-replace*` | `referenceImage` + `referenceVideo` |

## LLM Chat — Thinking Models & Tool Calling

### Model Capabilities via `sogni.chat.waitForModels()`

The SDK receives `LLMModelInfo` per model including `maxContextLength`, `maxOutputTokens` (min/max/default), and parameter constraints. Use these to configure `max_tokens` and display limits to users.

Use the returned model constraints as request guidance, and prefer each model's advertised `maxOutputTokens.default` when a caller has not chosen `max_tokens`.

### Thinking Models (Qwen3.x) — `chat_template_kwargs`

Thinking mode is controlled via llama.cpp's `chat_template_kwargs: { enable_thinking }` per-request parameter. The SDK's `think` param maps to this:
- `think: false` → `chat_template_kwargs: { enable_thinking: false }` (no thinking)
- `think: true` → `chat_template_kwargs: { enable_thinking: true }` (explicit thinking)
- `think: undefined` → omitted (server defaults apply)

The llama-server should run with default `--reasoning-budget -1` (unrestricted) so per-request control works.

`ChatCompletionChunk` exposes generated text through `content` and tool invocations through optional `tool_calls`.

**The solution for structured output**: Use **tool calling** (`tools` + `tool_choice: 'required'`). Tool call arguments are always forwarded by the worker regardless of thinking mode. The `workflow_text_chat_sogni_tools.mjs` example uses this pattern for all composition pipelines (video/image/audio prompt engineering).

### Composition Pipeline Architecture

The example's composition pipelines (composeVideo, composeImage, composeSong) use:
1. **Tool calling as the primary output mechanism** — `tool_choice: 'required'` with a structured tool schema
2. **Trimmed system prompts** — Creative guidance only; structural/format info is in the tool schema (reduces input tokens for tight context windows)
3. **Model info from `waitForModels()`** — `maxOutputTokens.default` for `max_tokens`
