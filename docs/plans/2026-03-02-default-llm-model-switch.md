# Switch Default LLM to Qwen3.5 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch default LLM model from `qwen3-30b-a3b-gptq-int4` (vLLM) to `qwen3.5-35b-a3b-gguf-q4km` (Llama.cpp) and double per-slot context from 4096 to 8192 tokens by reducing concurrency from 4 to 2.

**Architecture:** Change defaults in the worker (sogni-llm-nvidia), update advertised limits in the socket server (sogni-socket), and update example defaults in the SDK (sogni-client). The API (sogni-api) needs no changes since the qwen3.5 model config already exists with `backend: 'llamacpp'`.

**Tech Stack:** TypeScript (worker), JSON configs (socket/api), JavaScript ESM examples (client)

---

### Task 1: Update sogni-llm-nvidia worker config defaults

**Files:**
- Modify: `../../sogni-llm-nvidia/worker/src/config.ts:47` (MODEL_ID default)
- Modify: `../../sogni-llm-nvidia/worker/src/config.ts:64` (MAX_NUM_SEQS default)
- Modify: `../../sogni-llm-nvidia/worker/src/config.ts:75` (LLAMA_PARALLEL default)
- Modify: `../../sogni-llm-nvidia/worker/src/config.ts:120` (legacy config modelId)

**Step 1: Change MODEL_ID default**

In `worker/src/config.ts` line 47, change:
```typescript
const modelId = process.env.MODEL_ID || 'qwen3-30b-a3b-gptq-int4';
```
to:
```typescript
const modelId = process.env.MODEL_ID || 'qwen3.5-35b-a3b-gguf-q4km';
```

**Step 2: Change MAX_NUM_SEQS default from 4 to 2**

In `worker/src/config.ts` line 64, change:
```typescript
maxNumSeqs: numeric(process.env.MAX_NUM_SEQS, 4),
```
to:
```typescript
maxNumSeqs: numeric(process.env.MAX_NUM_SEQS, 2),
```

**Step 3: Change LLAMA_PARALLEL default from 4 to 2**

In `worker/src/config.ts` line 75, change:
```typescript
parallel: numeric(process.env.LLAMA_PARALLEL, 4),
```
to:
```typescript
parallel: numeric(process.env.LLAMA_PARALLEL, 2),
```

**Step 4: Update legacy config object modelId default**

In `worker/src/config.ts` line 120, change:
```typescript
modelId: process.env.MODEL_ID || 'qwen3-30b-a3b-gptq-int4',
```
to:
```typescript
modelId: process.env.MODEL_ID || 'qwen3.5-35b-a3b-gguf-q4km',
```

---

### Task 2: Update sogni-llm-nvidia maxConcurrentPerBackend

**Files:**
- Modify: `../../sogni-llm-nvidia/worker/src/sogni/client.ts:340`

**Step 1: Change maxConcurrentPerBackend from 4 to 2**

In `worker/src/sogni/client.ts` line 340, change:
```typescript
const maxConcurrentPerBackend = 4;
```
to:
```typescript
const maxConcurrentPerBackend = 2;
```

---

### Task 3: Update sogni-socket llmModelTiers.json

**Files:**
- Modify: `../../sogni-socket/data/llmModelTiers.json`

**Step 1: Update qwen3.5 context comment**

Change the `_comment_context` for qwen3.5 from:
```json
"_comment_context": "llama-server backend: actual per-request context = ctx-size / parallel. With defaults (MAX_MODEL_LEN=16384, LLAMA_PARALLEL=4) this is 4096 per slot. The values below should match the real per-slot limit, NOT the model's theoretical 32K. UPDATE THESE when worker config changes.",
```
to:
```json
"_comment_context": "llama-server backend: actual per-request context = ctx-size / parallel. With defaults (MAX_MODEL_LEN=16384, LLAMA_PARALLEL=2) this is 8192 per slot. The values below match the real per-slot limit, NOT the model's theoretical 32K. UPDATE THESE when worker config changes.",
```

**Step 2: Update qwen3.5 maxContextLength**

Change from:
```json
"maxContextLength": 32768,
```
to:
```json
"maxContextLength": 8192,
```

**Step 3: Update qwen3.5 maxOutputTokens.max**

Change from:
```json
"max": 32768,
```
to:
```json
"max": 8192,
```

---

### Task 4: Update sogni-client example defaults

**Files:**
- Modify: `examples/workflow_text_chat.mjs:34`
- Modify: `examples/workflow_text_chat_streaming.mjs:34`
- Modify: `examples/workflow_text_chat_multi_turn.mjs:46`
- Modify: `examples/workflow_text_chat_tool_calling.mjs:41`
- Modify: `examples/workflow_text_chat_sogni_tools.mjs:57`

**Step 1: Update DEFAULT_MODEL in workflow_text_chat.mjs**

Line 34, change:
```javascript
const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
```
to:
```javascript
const DEFAULT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
```

**Step 2: Update DEFAULT_MODEL in workflow_text_chat_streaming.mjs**

Line 34, change:
```javascript
const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
```
to:
```javascript
const DEFAULT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
```

**Step 3: Update DEFAULT_MODEL in workflow_text_chat_multi_turn.mjs**

Line 46, change:
```javascript
const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
```
to:
```javascript
const DEFAULT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
```

**Step 4: Update DEFAULT_MODEL in workflow_text_chat_tool_calling.mjs**

Line 41, change:
```javascript
const DEFAULT_MODEL = 'qwen3-30b-a3b-gptq-int4';
```
to:
```javascript
const DEFAULT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
```

**Step 5: Update DEFAULT_LLM_MODEL in workflow_text_chat_sogni_tools.mjs**

Line 57, change:
```javascript
const DEFAULT_LLM_MODEL = 'qwen3-30b-a3b-gptq-int4';
```
to:
```javascript
const DEFAULT_LLM_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';
```

---

### Task 5: Update documentation comments in examples

**Files:**
- Modify: `examples/workflow_text_chat.mjs` (lines 15, 19)
- Modify: `examples/workflow_text_chat_streaming.mjs` (line 18)
- Modify: `examples/workflow_text_chat_multi_turn.mjs` (lines 18, 23)
- Modify: `examples/workflow_text_chat_tool_calling.mjs` (line 27)
- Modify: `examples/workflow_text_chat_sogni_tools.mjs` (line 37)

For each file, update any JSDoc comment referencing the old default model from `qwen3-30b-a3b-gptq-int4` to `qwen3.5-35b-a3b-gguf-q4km`.

---

### Task 6: Verify no remaining references to old default

**Step 1: Search all repos for stale references**

Run:
```bash
grep -r "qwen3-30b-a3b-gptq-int4" ../../sogni-llm-nvidia/worker/src/ ../../sogni-socket/data/ examples/
```
Expected: No matches (the model should still exist as a secondary option in sogni-api config and sogni-socket tiers, but not as a _default_ anywhere).

Note: It's expected that `qwen3-30b-a3b-gptq-int4` still appears in `sogni-api/src/data/llm-worker-config.json` and `sogni-socket/data/llmModelTiers.json` as a supported (non-default) model. Only _default_ references should be gone.

---

### Task 7: Update CLAUDE.md files

Update the CLAUDE.md in sogni-llm-nvidia to reflect the new defaults (MODEL_ID, LLAMA_PARALLEL, MAX_NUM_SEQS). Update sogni-socket CLAUDE.md if it references the old per-slot math. Update sogni-client CLAUDE.md if it references the old default model in quick-reference examples.
