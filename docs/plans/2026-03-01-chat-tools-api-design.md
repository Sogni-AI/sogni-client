# Chat Tools API Design

**Date**: 2026-03-01
**Status**: Implementing

## Overview

Add `chat.tools` API to the Sogni Client SDK enabling automatic execution of Sogni platform tool calls (image/video/music generation). Rewrite `workflow_text_chat_sogni_tools.mjs` to use proper structured tool calling instead of keyword detection + JSON parsing.

## API Surface

### `chat.tools.execute(toolCall, options?)` — Execute a single Sogni tool call
Maps tool call arguments to `sogni.projects.create()`, waits for completion, returns result URLs.

### `chat.tools.executeAll(toolCalls, options?)` — Execute multiple tool calls
Handles Sogni tools automatically. Non-Sogni tools delegated to `onToolCall` callback.

### `think` param — Convenience for thinking mode
`think: false` auto-appends `/no_think` to system message. Default: undefined (no change).

### `autoExecuteTools` — Non-streaming auto-execution
When `stream: false` and `autoExecuteTools: true`, the SDK handles the full multi-round tool calling loop internally and returns the final `ChatCompletionResult` with `toolHistory`.

Streaming + autoExecuteTools is not supported in v1 — use the manual loop with `chat.tools.executeAll()` for streaming.

## Tool-to-Project Mapping

| Tool | Media | Key Params |
|------|-------|-----------|
| `sogni_generate_image` | image | prompt, negative_prompt, width, height, model, steps, seed |
| `sogni_generate_video` | video | prompt, negative_prompt, width, height, duration, fps, model, seed |
| `sogni_generate_music` | audio | prompt, duration, bpm, keyscale, timesignature, model, output_format, seed |

Default model: first available model with most workers for the media type.

## File Changes

- `src/Chat/types.ts` — New types + param additions
- `src/Chat/ChatTools.ts` — New ChatToolsApi class
- `src/Chat/index.ts` — `tools` property, `think` param, `autoExecuteTools` loop
- `src/Chat/ChatStream.ts` — `toolHistory` on finalResult
- `src/index.ts` — New exports
- `examples/workflow_text_chat_sogni_tools.mjs` — Complete rewrite

## Key Decisions

- `reasoningParser` is NOT exposed to SDK — stays in worker config
- `think` param handles `/no_think` convention transparently
- Auto-execute only for non-streaming (streaming uses manual loop + chat.tools)
- Tool execution is sequential (one tool at a time) to avoid overwhelming the network
