# Switch Default LLM to Qwen3.5 with Doubled Per-Slot Context

**Date:** 2026-03-02
**Status:** Approved

## Goal

Switch the default LLM model from `qwen3-30b-a3b-gptq-int4` (vLLM) to `qwen3.5-35b-a3b-gguf-q4km` (Llama.cpp) and double the per-slot context window from 4096 to 8192 tokens by reducing max concurrency from 4 to 2 parallel slots.

## Changes

### sogni-llm-nvidia (worker)

1. **`worker/src/config.ts`**: Change `MODEL_ID` fallback default from `qwen3-30b-a3b-gptq-int4` to `qwen3.5-35b-a3b-gguf-q4km`. Change `LLAMA_PARALLEL` default from 4 to 2. Change `MAX_NUM_SEQS` default from 4 to 2. Update legacy `config` object's `modelId` default.
2. **`worker/src/sogni/client.ts`**: Change `maxConcurrentPerBackend` from 4 to 2.

### sogni-socket

1. **`data/llmModelTiers.json`**: Update `qwen3.5-35b-a3b-gguf-q4km` entry — `maxContextLength` from 32768 to 8192, `maxOutputTokens.max` from 32768 to 8192, update comments to reflect parallel=2 math.

### sogni-api

No changes needed. Model config already has `backend: 'llamacpp'` for qwen3.5.

### sogni-client (SDK examples)

1. Change `DEFAULT_MODEL` in `workflow_text_chat.mjs`, `workflow_text_chat_streaming.mjs`, `workflow_text_chat_multi_turn.mjs`, `workflow_text_chat_tool_calling.mjs`, `workflow_text_chat_sogni_tools.mjs` from `qwen3-30b-a3b-gptq-int4` to `qwen3.5-35b-a3b-gguf-q4km`.

## Math

- `ctx-size = max(LLAMA_CTX_SIZE=8192, MAX_MODEL_LEN=16384) = 16384`
- `per-slot = 16384 / LLAMA_PARALLEL=2 = 8192`
- Max concurrent users per worker: 2
