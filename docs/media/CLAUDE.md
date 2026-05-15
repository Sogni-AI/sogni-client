# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## LLM Documentation Resources

For AI coding assistants working with this SDK, the following resources are available:

- **`llms.txt`** - Indexed quick reference with code examples
- **`llms-full.txt`** - Comprehensive documentation (~25KB) with complete API reference
- **`dist/index.d.ts`** - TypeScript type definitions (after build)
- **API Docs**: https://sdk-docs.sogni.ai

When helping users with Sogni SDK tasks, consult `llms-full.txt` for complete parameter references, especially for video generation where WAN 2.2 and LTX-2.3 models have different behaviors.

## Creative Agent Shared Contracts

Hosted chat tools, creative-agent workflow helpers, generated tool manifests, and SDK-facing workflow docs should stay aligned with `../sogni-creative-agent`. Do not recreate chat-only or SDK-only regex guardrails for tool argument repair, storyboard planning, or workflow routing. Add reusable JSON schemas, typed repair/control semantics, and deterministic validation to the shared package first, then regenerate or copy the public SDK artifacts as appropriate.

Use secondary LLM calls for semantic planning, creative adaptation, and audit/repair workflows, not as a substitute for schema validation of tool arguments or structured workflow control.

When SDK examples or generated helpers expose hosted creative workflows, keep them generated from or aligned with shared `@sogni/creative-agent` contracts such as `compileCreativeWorkflowPlanToHostedSequence()`, `validateAndNormalizeHostedToolArguments()`, `getRepairControlDecision()`, and `summarizeGuardTelemetry()`.

### Shared `@sogni/creative-agent` contracts

`@sogni/creative-agent` ships several surfaces SDK consumers can import directly when implementing creative workflows:

- **Per-turn tool gating**: the chat-side skill loader (`load_skill` / `unload_skill` / `list_active_skills`) was retired on 2026-05-10. Tool-surface composition is now owned by Structured Contracts v1 (see next bullet). SDK consumers building their own agent loop should construct a `ContractRegistry` and call `classifyTurn` / `compileToolsForTurn` / `dispatchToolCall` instead of advertising load/unload tools to the model. (The read-only `*_SKILL` manifest metadata used by the public Anthropic-style skill artifact is **not** a `@sogni/creative-agent` package export — it ships separately via `@sogni-ai/sogni-creative-agent-skill`.)
- **Structured Contracts v1**: `ContractRegistry`, `ToolGatingPolicy`, `RepairRecipe`, `PromptContract`, `classifyTurn`, `compileToolsForTurn`, `dispatchToolCall`, plus the `ContractsTelemetrySink` event types. The chat product seeds a registry once per session and the three evaluators own visible-tool composition, repair-on-error, and prompt-bake.
- **Asset manifest**: `createAssetManifest`, `addAsset`, `mapAssetsForModel`, `validateAssetReferences`, `formatModelRef` — three-layer asset references (`asset_id` / `user_label` / `model_ref`) so SDK consumers don't hand-format Seedance `@Image1` / GPT-Image-2 `[Image 1]` / LTX-2.3 `context_image_0` tokens.
- **Storyboard adapters**: `compileForModel`, `storyboardAdapterRegistry`, `SEEDANCE_ADAPTER`, `GPT_IMAGE_2_ADAPTER`, `LTX23_ADAPTER`, `WAN_ADAPTER`. Resolution is liberal (`seedance2-fast` → seedance via prefix).
- **Tool envelope**: `ToolResult`, `toolOk`, `toolErr`, `isToolResultOk`, `isToolResultErr`, `mapLegacyToolErrorCategory`, plus the canonical `ToolErrorCode` taxonomy.
- **Constrained decoding (`response_format`)**: llama-server natively accepts OpenAI-standard `{ type: "json_schema", json_schema: { strict, schema } }`. Plumbed through `src/Chat/index.ts` and forwarded to the worker via `sogni-socket` (commit `b711a68`); the `ChatResponseFormat` type is re-exported from the SDK root for typed consumer usage.
- **Default contract data**: `populateContractsDefaults(registry)` seeds a `ContractRegistry` with the canonical Phase 3 gating policies (7), Phase 4 repair recipes (157 across 11 `(toolName, ToolErrorCode)` families), and Phase 5 per-tool prompt contracts (12). SDK consumers calling `classifyTurn` / `compileToolsForTurn` / `dispatchToolCall` should seed off this one call instead of registering policies / recipes / contracts manually.
- **Per-tool cost + permission**: `getToolCostMetadata(toolName)` returns `{ costClass, riskLevel, userVisibleCost, description }`; `getToolPermission(toolName)` returns the typed `ToolPermissionDecision` (`allow` / `require_user_approval` / `require_explicit_intent`). SDK consumers can use these for client-side billing UX or for enforcing destructive-tool gates in their own agent loop (chat + hosted both enforce `require_explicit_intent` via shared `EXPLICIT_INTENT_PATTERNS`).
- **Replay record schema**: `RunRecord` (schema v2; `skills_loaded` dropped after the 2026-05-10 skill-loader retirement), `redactRunRecord`, `emptyRunRecord`, plus the canonical `RunRecordToolCall` / `RunRecordToolResult` / `RunRecordRound` / `RunRecordAuditResult` shapes. SDK consumers that emit their own RunRecord (instead of relying on sogni-chat) should call `redactRunRecord` defense-in-depth before persisting / posting. The chat product writes records to sogni-api's `POST /v1/replay/records` ingest endpoint; SDK consumers can POST the same shape to the same endpoint with their api-key auth.

## Overview

This is the **Sogni SDK for JavaScript/Node.js** - a TypeScript client library for the Sogni Supernet, a DePIN protocol for creative AI inference. The SDK supports image generation (Stable Diffusion, Flux, etc.), video generation (WAN 2.2 and LTX-2.3 models), audio generation (ACE-Step 1.5), LLM chat with tool calling, and multimodal vision chat (Qwen3.6 35B VLM, default `qwen3.6-35b-a3b-gguf-iq4xs`) via WebSocket communication.

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
- `chat: ChatApi` - Unified chat namespace:
  - `chat.completions.create` - Socket-native synchronous chat
  - `chat.hosted.create` - Hosted synchronous chat via `/v1/chat/completions`
  - `chat.runs.{create, get, cancel, streamEvents}` - Durable hosted chat runs via `/v1/chat/runs` with SSE replay
  - `chat.tools` - Tool helpers (build, parse, validate)
- `creativeWorkflows: CreativeWorkflowsApi` - Durable explicit creative workflows via `/v1/creative-agent/workflows`
- `workflows: CreativeWorkflowsApi` - Flat alias of `creativeWorkflows` for shorter call sites
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

### Standard Behavior (LTX-2.3 and future models)

**LTX-2.3 Models (`ltx2-*`, `ltx23-*`)** represent the standard behavior going forward. **LTX-2.3 (22B)** is the recommended video model family:
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

**Caution**: `maxContextLength` from the server may not reflect the actual per-request limit on the worker (see sogni-socket and sogni-llm-nvidia CLAUDE.md for the llama-server `--parallel` slot division issue).

### Thinking Models (Qwen3.x) — `chat_template_kwargs`

Thinking mode is controlled via llama.cpp's `chat_template_kwargs: { enable_thinking }` per-request parameter. The SDK's `think` param maps to this:
- `think: false` → `chat_template_kwargs: { enable_thinking: false }` (no thinking)
- `think: true` → `chat_template_kwargs: { enable_thinking: true }` (explicit thinking)
- `think: undefined` → omitted (server defaults apply)

The llama-server should run with default `--reasoning-budget -1` (unrestricted) so per-request control works.

Qwen3.x models generate thinking output in a separate `reasoning_content` field (OpenAI-compatible). The LLM worker wraps this in `<think>` tags inside `content` for the SDK. The SDK's `ChatCompletionChunk` type has NO `reasoning_content` field — only `content` and `tool_calls`.

**The solution for structured output**: Use **tool calling** (`tools` + `tool_choice: 'required'`). Tool call arguments are always forwarded by the worker regardless of thinking mode. The `workflow_text_chat_sogni_tools.mjs` example uses this pattern for all composition pipelines (video/image/audio prompt engineering).

### Composition Pipeline Architecture

The example's composition pipelines (composeVideo, composeImage, composeSong) use:
1. **Tool calling as the primary output mechanism** — `tool_choice: 'required'` with a structured tool schema
2. **Trimmed system prompts** — Creative guidance only; structural/format info is in the tool schema (reduces input tokens for tight context windows)
3. **Model info from `waitForModels()`** — `maxOutputTokens.default` for `max_tokens`
