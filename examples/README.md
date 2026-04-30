# Sogni Client SDK Examples

Welcome to the Sogni Client SDK examples! This directory contains working examples that demonstrate how to use the Sogni SDK to generate images and videos using various AI models and workflows.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Examples](#running-examples)
- [Available Examples](#available-examples)
  - [Image Generation Workflow Examples](#image-generation-workflow-examples)
  - [Video Generation Workflow Examples](#video-generation-workflow-examples)
  - [LLM Text Chat, Vision & Tool Calling Examples](#llm-text-chat-vision--tool-calling-examples)
  - [Basic Examples](#basic-examples)
  - [Web Application Example](#web-application-example)
- [Featured Models](#featured-models)
- [Command-Line Options](#command-line-options)
- [Token Types and Costs](#token-types-and-costs)
- [Understanding the Output](#understanding-the-output)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before running these examples, you'll need:

### 1. Node.js Installation

**Check if Node.js is already installed:**

```bash
node --version
```

If you see a version number (e.g., `v18.0.0` or higher), you're good to go! If not, follow the installation instructions below.

**Installing Node.js:**

- **macOS:**

  - Using Homebrew: `brew install node`
  - Or download from [nodejs.org](https://nodejs.org/)

- **Windows:**

  - Download the installer from [nodejs.org](https://nodejs.org/)
  - Run the installer and follow the prompts

- **Linux:**

  ```bash
  # Ubuntu/Debian
  curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
  sudo apt-get install -y nodejs

  # Or use your distribution's package manager
  ```

**Verify installation:**

```bash
node --version
npm --version
```

You should see version numbers for both commands. The examples require Node.js version **18.0.0 or higher**.

### 2. Sogni Account

You need an active Sogni account with a positive token balance (SOGNI or Spark tokens).

- **Create a free account:** Visit [app.sogni.ai](https://app.sogni.ai) or download the [Mac App](https://www.sogni.ai/studio)
- **Get free tokens:** Confirm your email and claim daily bonus tokens under the Rewards section
- **Purchase more tokens:** Spark tokens can be purchased with a credit card in the Mac or Web app

---

## Installation

### Step 1: Navigate to the Examples Directory

Open your terminal/command prompt and navigate to the examples folder:

```bash
cd /path/to/sogni-client/examples
```

Or if you're already in the project root:

```bash
cd examples
```

### Step 2: Install Dependencies

Run the following command to install all required packages:

```bash
npm install
```

This will install:

- `dotenv` - For managing environment variables
- `image-size` - For detecting image dimensions
- And other required dependencies

**Important:** You must run this command before running any examples!

### Step 3: Build the SDK (If Using Local Version)

If you're working with a local version of the SDK (not installed from npm), you'll need to build it first:

```bash
cd ..
npm install
npm run build
cd examples
```

---

## Configuration

### Setting Up Credentials

The examples need your Sogni account credentials to authenticate with the API.

**Option 1: API Key (Recommended)**

To get your API key, log in to [dashboard.sogni.ai](https://dashboard.sogni.ai) and click your **Username** dropdown in the top-right corner.

Set your API key in a `.env` file in the `examples` directory:

```env
SOGNI_API_KEY=your_api_key_here
```

With an API key, the examples authenticate automatically — no username/password needed.

**Option 2: Username & Password**

```env
SOGNI_USERNAME=your_username
SOGNI_PASSWORD=your_password
```

**Option 3: Interactive Prompt (Easiest for Beginners)**

Simply run any example script, and it will prompt you to enter your credentials:

```bash
node workflow_text_to_image.mjs
```

You'll be asked for username and password, with an option to save them.

**Setting Up the .env File**

Create a file named `.env` in the `examples` directory:

```bash
# In the examples directory
touch .env
```

Edit the `.env` file and add your credentials (choose one method):

```env
# Option 1: API Key (recommended)
SOGNI_API_KEY=your_api_key_here

# Option 2: Username/Password
# SOGNI_USERNAME=your_username
# SOGNI_PASSWORD=your_password

# Optional: Payment Token Type (sogni or spark)
SOGNI_TOKEN_TYPE=spark
```

**Security Note:** The `.env` file contains sensitive information. It's automatically ignored by git and should never be shared or committed to version control.

### Optional Advanced Configuration

For advanced users or testing against custom endpoints:

```env
# Optional: Use testnet (for development/testing)
SOGNI_TESTNET=false

# Optional: Custom endpoints (usually not needed)
# SOGNI_SOCKET_ENDPOINT=wss://socket.sogni.ai
# SOGNI_REST_ENDPOINT=https://api.sogni.ai
```

---

## Running Examples

All examples are Node.js scripts that can be run directly from the command line.

### Basic Syntax

```bash
node <script-name> [arguments] [options]
```

### Quick Start Examples

**Generate images from text (try the new Z-Turbo model!):**

```bash
node workflow_text_to_image.mjs "A serene mountain landscape"
```

**Generate images using reference images (Qwen Image Edit):**

```bash
node workflow_image_edit.mjs "portrait in this style" --context test-assets/placeholder.jpg
```

**Generate a video from text:**

```bash
node workflow_text_to_video.mjs "A serene ocean wave"
```

**Animate an image into a video:**

```bash
node workflow_image_to_video.mjs --image test-assets/placeholder.jpg
```

**Transfer motion or replace characters in video:**

```bash
node workflow_video_to_video.mjs  # Animate-Move / Animate-Replace
node workflow_video_to_video.mjs "restyle this as watercolor" --video source.mp4 --model ltx23-v2v-distilled
```

**Chat with an LLM (streaming):**

```bash
node workflow_text_chat_streaming.mjs "Tell me a story about a cat"
```

**Vision chat — analyze images with AI:**

```bash
node workflow_text_chat_vision.mjs --image photo.jpg
```

**Generate images, videos, or music via natural language chat:**

```bash
node workflow_text_chat_sogni_tools.mjs "Create an image of a cyberpunk city"
node workflow_text_chat_sogni_tools.mjs "Generate a video of ocean waves at sunset"
node workflow_text_chat_sogni_tools.mjs "Compose a jazz song about the rain"
node workflow_creative_agent_tools.mjs "Create an orbit video plan for a crystal perfume bottle"
node workflow_creative_agent_workflows.mjs "A chrome monorail over neon gardens" --video-model ltx23 --watch
node workflow_partner_seedance_video.mjs "A glass whale swimming through a neon city" --fast --duration 4
```

**LLM tool calling (weather, time, math):**

```bash
node workflow_text_chat_tool_calling.mjs "What's the weather in Austin, TX?"
```

**Generate images (promise-based basic example):**

```bash
node promise_based.mjs
```

---

## Available Examples

### Featured Models

The workflow examples showcase these powerful new models:

| Model ID                             | Name              | Type         | Description                                                                        |
| ------------------------------------ | ----------------- | ------------ | ---------------------------------------------------------------------------------- |
| `z_image_turbo_bf16`                 | Z-Image Turbo     | Image        | Fast 8-step turbo generation - great for quick iterations                          |
| `z_image_bf16`                       | Z-Image           | Image        | High quality 20-step generation with detailed output                               |
| `qwen_image_edit_2511_fp8_lightning` | Qwen Lightning    | Image Edit   | Fast 4-step reference-based generation                                             |
| `qwen_image_edit_2511_fp8`           | Qwen Image Edit   | Image Edit   | High-quality 20-step image editing with context                                    |
| `flux2_dev_fp8`                      | Flux.2 Dev        | Image        | Professional quality with context image support                                    |
| `seedance-2-0_t2v`                   | Seedance 2.0      | Video        | External API text-to-video at 24fps                                                |
| `seedance-2-0-fast_t2v`              | Seedance 2.0 Fast | Video        | 720p-capped external API text-to-video at 24fps                                    |
| `qwen3.6-35b-a3b-gguf-iq4xs`         | Qwen3.6 35B       | LLM + Vision | Text generation, chat, reasoning, tool calling, and multimodal image understanding |

**Try them out:**

```bash
# Z-Image Turbo - fast and efficient
node workflow_text_to_image.mjs "A cyberpunk city" --model z-turbo

# Z-Image - high quality output
node workflow_text_to_image.mjs "A cyberpunk city" --model z-image

# Qwen Image Edit Lightning - quick reference-based generation
node workflow_image_edit.mjs "portrait" --context test-assets/placeholder.jpg --model qwen-lightning

# Flux.2 Dev - highest quality
node workflow_text_to_image.mjs "Professional portrait" --model flux2
```

---

### Image Generation Workflow Examples

#### `workflow_text_to_image.mjs`

Generate images from text prompts with support for multiple cutting-edge models.

**Available Models:**
| Model | Description | Best For |
|-------|-------------|----------|
| `z-turbo` | Z-Image Turbo (8-step, fast) | Quick prototyping, iterations |
| `z-image` | Z-Image (20-step, high quality) | Detailed, high quality output |
| `flux1-schnell` | Flux.1 Schnell (1-5 steps) | Ultra-fast generation |
| `flux2` | Flux.2 Dev (20-step, high quality) | Professional quality output |

**Usage:**

```bash
node workflow_text_to_image.mjs                           # Interactive mode
node workflow_text_to_image.mjs "A beautiful sunset"      # With prompt
node workflow_text_to_image.mjs "Portrait" --model z-turbo --seed 12345
node workflow_text_to_image.mjs "Portrait" --model z-image --seed 12345
```

**Options:**

- `--model` - Model: z-turbo, z-image, flux1-schnell, or flux2
- `--width` / `--height` - Output dimensions
- `--batch` - Number of images (1-10)
- `--steps` - Inference steps
- `--guidance` - Guidance scale
- `--seed` - Random seed for reproducibility
- `--negative` - Negative prompt
- `--style` - Style prompt
- `--sampler` / `--scheduler` - Sampler and scheduler
- `--output` - Output directory (default: ./output)
- `--disable-safe-content-filter` - Disable NSFW filter

#### `workflow_image_edit.mjs`

Generate new images using reference/context images to guide style and content. Works with the powerful **Qwen Image Edit** models and **Flux.2 Dev**.

**Available Models:**
| Model | Description | Best For |
|-------|-------------|----------|
| `qwen-lightning` | Qwen Image Edit Lightning (4-step) | Fast reference-based generation |
| `qwen` | Qwen Image Edit (20-step) | High-quality image editing |
| `flux2` | Flux.2 Dev (20-step) | Professional quality with context |

**Usage:**

```bash
node workflow_image_edit.mjs                                    # Interactive mode
node workflow_image_edit.mjs "portrait in this style" --context ref.jpg
node workflow_image_edit.mjs "modern artwork" --context ref1.jpg --context2 ref2.jpg
```

**Options:**

- `--context` - Reference image 1 (required)
- `--context2` / `--context3` - Additional reference images (optional)
- `--model` - Model: qwen-lightning, qwen, or flux2
- `--width` / `--height` - Output dimensions
- `--batch` - Number of images
- `--steps` - Inference steps
- `--guidance` - Guidance scale
- `--seed` - Random seed
- `--negative` - Negative prompt
- `--style` - Style prompt
- `--output` - Output directory (default: ./output)

**How It Works:**
Provide 1-3 reference images that represent the style or content you want. The model uses these to guide generation of new images matching your prompt.

---

### Video Generation Workflow Examples

All video workflows support the **Wan 2.2 14B FP8** model family with two variants:

- **Speed/LightX2V** - Faster, 4-8 steps, good quality (recommended for testing)
- **Quality** - Slower, 20-40 steps, best quality

**Using Your Own Media Files:**

All video examples can interactively select files from the `test-assets` folder. To use your own images, videos, or audio files:

```bash
# Add your own files
cp ~/my-photo.jpg test-assets/
cp ~/my-video.mp4 test-assets/
cp ~/my-audio.mp3 test-assets/

# Run the script - it will show your files in the selection menu
node workflow_image_to_video.mjs
```

#### `workflow_text_to_video.mjs`

Generate videos from text prompts.

**Usage:**

```bash
node workflow_text_to_video.mjs                           # Interactive mode
node workflow_text_to_video.mjs "A futuristic city"       # With prompt
node workflow_text_to_video.mjs "Dancing robots" --fps 32 # With options
```

**Options:**

- `--model` - Model: lightx2v (fast) or quality (best)
- `--width` / `--height` - Video dimensions (default: 832x480)
- `--duration` - Duration in seconds (default: 5)
- `--fps` - Frames per second: 16 or 32 (default: 16)
- `--batch` - Number of videos (1-5)
- `--guidance` - Guidance scale
- `--shift` - Motion intensity 1.0-8.0
- `--seed` - Random seed
- `--negative` - Negative prompt
- `--style` - Style prompt
- `--comfy-sampler` / `--comfy-scheduler` - ComfyUI sampler/scheduler
- `--output` - Output directory (default: ./output)

#### `workflow_image_to_video.mjs`

Animate a static image into a video with motion prompts.

**Usage:**

```bash
node workflow_image_to_video.mjs                          # Interactive mode
node workflow_image_to_video.mjs --image photo.jpg
node workflow_image_to_video.mjs --image photo.jpg "camera pans left"
```

**Features:**

- Auto-detects image dimensions
- Optional motion prompt (e.g., "zoom in", "camera pans left")
- Interactive image selection from `test-assets`
- First/Last frame support

**Motion Prompt Examples:**

- "camera pans left" / "camera pans right"
- "zoom in slowly" / "zoom out"
- "camera rotates"
- Or leave blank for automatic animation

#### `workflow_sound_to_video.mjs`

Generate videos synchronized with audio, including lip-sync for characters.

**Usage:**

```bash
node workflow_sound_to_video.mjs                          # Interactive mode
node workflow_sound_to_video.mjs --model lightx2v
```

**Features:**

- Interactive file selection for image and audio
- Lip-sync animation for speaking characters
- Emotion matching from audio
- Automatic audio length detection
- Frame count calculated from audio duration

**Supported Audio Formats:** `.mp3`, `.m4a`, `.wav`

#### `workflow_video_to_video.mjs`

Transform existing videos with **Animate-Move** (motion transfer), **Animate-Replace** (character replacement), and **LTX-2.3 V2V ControlNet** capabilities.

**Usage:**

```bash
node workflow_video_to_video.mjs                          # Interactive mode
node workflow_video_to_video.mjs --video source.mp4
node workflow_video_to_video.mjs "restyle as watercolor" --video source.mp4 --model ltx23-v2v-distilled
```

**Available Modes:**

- **Animate-Move** - Transfer motion and emotion from reference video to your subject image
- **Animate-Replace** - Replace characters in video while preserving original motion
- **LTX-2.3 V2V ControlNet** - Canny, pose, depth, and detailer control

**Features:**

- Interactive video and image selection
- Auto-detects video dimensions and frame count
- Seamless motion transfer or character replacement

**Use Cases:**

- Apply dance moves from one person to another (Animate-Move)
- Transfer facial expressions and emotions (Animate-Move)
- Replace actors while maintaining action (Animate-Replace)
- Swap video subjects while preserving motion (Animate-Replace)
- Animate illustrations with real human motion (Animate-Move)
- Create puppeteer and motion-capture effects

### LLM Text Chat, Vision & Tool Calling Examples

The Sogni SDK provides LLM text generation through the Supernet, with streaming, multi-turn conversations, thinking/reasoning mode, tool calling (function calling), and multimodal vision understanding.

#### `workflow_text_chat.mjs`

Single-turn chat completion (non-streaming). Sends a prompt and receives the full response at once.

**Usage:**

```bash
node workflow_text_chat.mjs "What is the meaning of life?"
node workflow_text_chat.mjs "Explain quantum computing" --model qwen3.6-35b-a3b-gguf-iq4xs
node workflow_text_chat.mjs "Write a haiku" --max-tokens 100 --temperature 0.9
```

#### `workflow_text_chat_streaming.mjs`

Streaming chat with token-by-token real-time output. Shows response speed (tokens/sec) after completion.

**Usage:**

```bash
node workflow_text_chat_streaming.mjs "Tell me a story about a cat"
node workflow_text_chat_streaming.mjs "Write a poem" --max-tokens 500 --temperature 1.0
```

#### `workflow_text_chat_multi_turn.mjs`

Interactive multi-turn conversation with persistent history and in-chat commands.

**Usage:**

```bash
node workflow_text_chat_multi_turn.mjs
node workflow_text_chat_multi_turn.mjs --system "You are a pirate. Respond in pirate speak."
```

**In-Chat Commands:**
| Command | Description |
|---------|-------------|
| `/clear` | Clear conversation history |
| `/history` | Show message history |
| `/system <msg>` | Change system prompt |
| `/think` | Toggle thinking/reasoning mode |
| `/stats` | Show session statistics (tokens, time, throughput) |
| `exit` / `quit` | End the conversation |

#### `workflow_text_chat_vision.mjs`

Multimodal vision chat powered by Qwen3.6 VLM (Vision-Language Model). Load local images and ask questions about them — supports scene description, OCR/text extraction, object detection, structured visual analysis, and multi-image comparison.

**Usage:**

```bash
node workflow_text_chat_vision.mjs                           # Interactive mode
node workflow_text_chat_vision.mjs --image photo.jpg         # Pre-load an image
node workflow_text_chat_vision.mjs --image photo.jpg --max-tokens 8192
```

**In-Chat Commands:**
| Command | Description |
|---------|-------------|
| `/image <path>` | Load a local image (JPEG, PNG, WebP, GIF; max 20MB) |
| `/describe` | Rich detailed description of current image |
| `/ocr` | Extract all visible text with layout preservation |
| `/objects` | Detect and locate objects with spatial relationships |
| `/analyze` | Deep structured analysis (subject, composition, lighting, etc.) |
| `/compare <path>` | Load a second image and compare both in detail |
| `/clear-image` | Remove image from context (text-only mode) |
| `/clear` | Clear conversation history |
| `/history` | Show message history |
| `/system <msg>` | Change system prompt |
| `/stats` | Show session statistics |
| `exit` / `quit` | End the conversation |

**Supported Image Formats:** JPEG, PNG, WebP, GIF (max 20MB)

#### `workflow_text_chat_tool_calling.mjs`

LLM tool calling (function calling) with built-in external tools. The LLM decides when to use a tool, you execute it locally, and feed results back.

**Built-in Tools:**

- **get_weather** - Live weather for any city (via wttr.in, no API key needed)
- **get_time** - Current time in any timezone or city
- **convert_units** - Temperature, distance, weight, and speed conversions
- **calculate** - Math expression evaluator

**Usage:**

```bash
node workflow_text_chat_tool_calling.mjs "What's the weather in Austin, TX?"
node workflow_text_chat_tool_calling.mjs "What time is it in Tokyo and London?"
node workflow_text_chat_tool_calling.mjs "Convert 72°F to celsius"
node workflow_text_chat_tool_calling.mjs "What's 15% of 249.99?"
```

#### `workflow_text_chat_sogni_tools.mjs`

Generate the core text-to-image, text-to-video, and text-to-music flows through natural language via LLM tool calling. The LLM detects media generation intent, enhances prompts, and calls Sogni's generation APIs directly.

**Sogni Platform Tools:**

- **Image Generation** - Detects image intent, enhances prompt, generates via `z_image_turbo_bf16`
- **Video Generation** - Detects video intent, generates via `ltx23-22b-fp8_t2v_distilled` (LTX-2.3)
- **Music Generation** - Detects music intent, composes via `ace_step_1.5_turbo` (ACE-Step 1.5)

**SDK built-ins beyond this example:**

- `sogni_edit_image` - Reference-guided image editing
- `sogni_sound_to_video` - Audio-driven video generation
- `sogni_video_to_video` - Video transformation and motion transfer

**Rich Creative-Agent Tool Family:**
The Sogni API also exposes a richer 14-tool family for agentic chat experiences. Pass `sogni_tools: "creative-agent"` (or `"rich"`) in the request body to swap the 6 hosted `sogni_*` tools for `generate_image`, `edit_image`, `restore_photo`, `apply_style`, `refine_result`, `animate_photo` (with multi-source fan-out), `change_angle`, `generate_video`, `sound_to_video`, `video_to_video`, `generate_music`, plus three composition tools that return a single stitched MP4: `stitch_video`, `orbit_video`, and `dance_montage`. See the [LLM API reference](https://github.com/Sogni-AI/sogni-api/blob/main/docs/llm-api.md#rich-creative-agent-tools) for the full schema list.

Run the server-side API-key example:

```bash
node workflow_creative_agent_tools.mjs "Create an orbit video plan for a crystal perfume bottle"
node workflow_creative_agent_tools.mjs "Plan a Seedance cyberpunk skyline video" --tools creative-agent --no-execute
```

Run the focused partner Seedance video example. It uses `/v1/chat/completions` for text-to-video tool selection and `/v1/creative-agent/workflows` for exact media-bearing hosted tool sequences. Both paths let `sogni-api` apply the shared Seedance prompt expansion before job submission:

```bash
node workflow_partner_seedance_video.mjs "A glass whale swimming through a neon city" --duration 4
node workflow_partner_seedance_video.mjs "A glass whale swimming through a neon city" --fast --duration 4
node workflow_partner_seedance_video.mjs "slow cinematic reveal" --mode i2v
node workflow_partner_seedance_video.mjs "slow cinematic reveal" --mode i2v --fast
node workflow_partner_seedance_video.mjs "the portrait sings with stage lighting" --mode ia2v
node workflow_partner_seedance_video.mjs "turn the clip into a polished perfume commercial" --mode v2v
```

T2V defaults to `/v1/chat/completions`. Media modes default to `/v1/creative-agent/workflows` with `kind: "hosted_tool_sequence"` and upload local media from `test-assets` automatically. Pass `--image`, `--audio`, or `--video` to use your own local files, or pass HTTPS media URLs. `--no-execute` prints the workflow request without submitting it; local media is still uploaded first so the printed request contains real HTTPS media URLs.

**Durable Creative Workflows:**
For multi-step workflows that need to survive client disconnect, persist state, or be observed from a second client, use the SDK `sogni.creativeWorkflows` wrapper:

- `startImageToVideo(input, { tokenType })`
- `startHostedToolSequence(input, { tokenType })`
- `list()`, `get(workflowId)`, `events(workflowId)`
- `streamEvents(workflowId, { after, lastEventId })`
- `cancel(workflowId)`

Run the durable workflow example:

```bash
node workflow_creative_agent_workflows.mjs "A chrome monorail over neon gardens" --watch
node workflow_creative_agent_workflows.mjs "A cinematic robot portrait" --video-model ltx23 --duration 5 --watch
node workflow_creative_agent_workflows.mjs "A kinetic product teaser" --video-model wan22 --duration 5 --watch
node workflow_creative_agent_workflows.mjs --list
node workflow_creative_agent_workflows.mjs --stream <workflowId>
```

See the [durable workflows reference](https://github.com/Sogni-AI/sogni-api/blob/main/docs/llm-api.md#durable-creative-agent-workflows) for full details.

**Usage:**

```bash
node workflow_text_chat_sogni_tools.mjs "Create an image of a cyberpunk city at night"
node workflow_text_chat_sogni_tools.mjs "Generate a video of ocean waves at sunset"
node workflow_text_chat_sogni_tools.mjs "Compose a jazz song about the rain"
node workflow_text_chat_sogni_tools.mjs -n 4 "Create images of fantasy landscapes"
```

**Options (available in `-n` / `--quantity`):**

- `--quantity` / `-n` - Number of media items to generate per request (1-512, default: 1)

#### Common LLM Chat Options

All LLM chat scripts share these options:

| Option          | Description                     | Default                      |
| --------------- | ------------------------------- | ---------------------------- |
| `--model`       | LLM model ID                    | `qwen3.6-35b-a3b-gguf-iq4xs` |
| `--max-tokens`  | Maximum tokens to generate      | from model, or 8192          |
| `--temperature` | Sampling temperature (0-2)      | 0.7                          |
| `--top-p`       | Top-p nucleus sampling (0-1)    | 0.9                          |
| `--system`      | Custom system prompt            | Varies by script             |
| `--think`       | Enable model thinking/reasoning | Off by default               |
| `--no-think`    | Disable model thinking          | Default                      |

---

### Basic Examples

These simpler examples demonstrate core SDK patterns without the full interactive workflow features.

#### `promise_based.mjs`

Demonstrates image generation using promises and async/await syntax.

**Features:**

- Automatic model selection (finds most popular model)
- Promise-based API usage
- Downloads generated images to `./images` directory

**Usage:**

```bash
node promise_based.mjs
```

**What it does:**

1. Connects to Sogni and authenticates
2. Finds the most popular image model
3. Generates 4 images based on the prompt "A cat wearing a hat"
4. Downloads images to the `./images` folder

#### `event_driven.js`

Demonstrates image generation using event listeners for real-time updates.

**Features:**

- Event-driven architecture
- Real-time progress tracking
- Listen to individual project and job events

**Usage:**

```bash
node event_driven.js
```

**What it does:**

1. Connects and authenticates
2. Creates an image generation project
3. Listens for events: `queued`, `progress`, `completed`, `failed`
4. Displays event payloads in real-time

---

### Web Application Example

#### `express/`

A simple Express.js web server demonstrating browser-based usage.

**Setup and Run:**

```bash
cd express
npm install
node index.js
```

Then open your browser to `http://localhost:3000`

**Features:**

- Browser-based client usage
- Simple web interface
- Example of integrating Sogni SDK in a web application

---

## Command-Line Options

### Common Options Across Workflow Examples

The following options are available across most workflow examples. Check the individual script documentation above for specifics.

**Image Workflow Options:**

| Option                 | Description       | Default            | Availability            |
| ---------------------- | ----------------- | ------------------ | ----------------------- |
| `--model`              | Model ID          | Interactive prompt | All image scripts       |
| `--width` / `--height` | Output dimensions | Model-specific     | All image scripts       |
| `--batch`              | Number of outputs | 1                  | All image scripts       |
| `--steps`              | Inference steps   | Model-specific     | All image scripts       |
| `--guidance`           | Guidance scale    | Model-specific     | All image scripts       |
| `--seed`               | Random seed       | -1 (random)        | All image scripts       |
| `--negative`           | Negative prompt   | None               | All image scripts       |
| `--style`              | Style prompt      | None               | All image scripts       |
| `--output`             | Output directory  | ./output           | All image scripts       |
| `--context`            | Reference image   | Interactive prompt | workflow_image_edit.mjs |

**Video Workflow Options:**

| Option                 | Description         | Default            | Availability               |
| ---------------------- | ------------------- | ------------------ | -------------------------- |
| `--model`              | Model ID            | Interactive prompt | All video scripts          |
| `--width` / `--height` | Video dimensions    | 640 or auto-detect | All video scripts          |
| `--duration`           | Duration in seconds | 5                  | workflow_text_to_video.mjs |
| `--fps`                | Frames per second   | 16                 | workflow_text_to_video.mjs |
| `--batch`              | Number of videos    | 1                  | All video scripts          |
| `--guidance`           | Guidance scale      | Model-specific     | All video scripts          |
| `--shift`              | Motion intensity    | Model-specific     | All video scripts          |
| `--seed`               | Random seed         | -1 (random)        | All video scripts          |
| `--output`             | Output directory    | ./output           | All video scripts          |

**Note:** The `workflow_sound_to_video.mjs` and `workflow_video_to_video.mjs` scripts use interactive file selection and automatically detect dimensions and frame counts from reference media.

### Frame and Duration Guide

At **16 FPS** (frames per second):

- 17 frames = ~1 second
- 81 frames = ~5 seconds (default)
- 161 frames = ~10 seconds

At **32 FPS**:

- 33 frames = ~1 second
- 161 frames = ~5 seconds
- 321 frames would be ~10 seconds (but max is 161)

For LTX-2.3 examples, prefer `--duration`; the scripts calculate model-correct frame counts. The partner Seedance video example also uses `--duration` and covers Seedance's fixed 24fps paths.

**Cost Note:** Longer videos (more frames) cost more tokens. A 161-frame video costs roughly 2x as much as an 81-frame video.

---

## Token Types and Costs

### Available Token Types

1. **Spark Tokens**

   - Purchased with credit card
   - More widely available
   - Recommended for most users

2. **SOGNI Tokens**
   - Blockchain-based tokens
   - Can be earned through the network
   - Advanced users

### Cost Factors

Video generation costs depend on:

- **Resolution** (width × height): Higher resolution = more expensive
- **Frame count**: More frames = more expensive
- **Model variant**: Quality models cost ~2.5x more than Speed models
- **Network type**: Fast network required for video (more expensive than relaxed)

### Viewing Costs

All video examples show cost estimates before generation:

```
📊 Cost Estimate:
   Spark: 0.45 (Balance remaining: 9.55)
   USD: $0.0023
```

You must confirm before the job runs, so you're always in control of spending.

### Getting More Tokens

- **Free daily tokens**: Claim in the app every 24 hours
- **Purchase Spark tokens**: Available in Mac/Web app with credit card
- **Refer friends**: Earn bonus tokens through referral program

---

## Understanding the Output

### Console Output

When you run a workflow example, you'll see output like:

```
╔══════════════════════════════════════════════════════════╗
║               Text-to-Image Workflow                     ║
╚══════════════════════════════════════════════════════════╝

✓ Credentials loaded from .env file

⚡ Select a model:

  1. Z-Image Turbo       - Fast generation with good quality
  2. Z-Image             - High quality generation (20-50 steps)
  3. Flux.1 Schnell      - Very fast generation (1-5 steps)
  4. Flux.2 Dev          - Highest quality, supports context images.

Enter choice [1-4] (default: 1): 1
🎨 Selected model: Z-Image Turbo

💳 Using saved payment preference: Spark tokens

💵 Fetching cost estimate...

📊 Cost Estimate:
   Spark: 0.15 (Balance remaining: 9.85)
   USD: $0.0008

Proceed with generation? [Y/n]: y

┌─────────────────────────────────────────────────────────┐
│ Image Generation Configuration                          │
├─────────────────────────────────────────────────────────┤
│ Model:        Z-Image Turbo                             │
│ Resolution:   1024x1024                                 │
│ Batch:        1                                         │
│ Steps:        4                                         │
│ Guidance:     1.0                                       │
│ Seed:         -1                                        │
│ Sampler:      res_multistep                             │
│ Scheduler:    simple                                    │
│ Prompt:       A serene mountain landscape               │
└─────────────────────────────────────────────────────────┘

🔄 Loading available models...
✓ Model ready: Z-Image Turbo

📤 Submitting text-to-image job...
🎨 Generating images...

⏳ Step 3/4 (75%) ETA: 5s
✅ Job completed!

✅ Image generation complete!
💾 Saved: ./output/z_turbo_1024x1024_steps4_1.jpg
🖼️ Opened image in viewer
🎉 Image generated successfully!
```

### Output Files

Generated media are saved to the output directory (default: `./output/`):

```
output/
├── z_turbo_1024x1024_steps4_1.jpg      # Image from workflow_text_to_image.mjs
├── job_abc123_edited.jpg                # Image from workflow_image_edit.mjs
├── video_proj123_1.mp4                  # Video from workflow_text_to_video.mjs
└── ...
```

**Important:** Media are also stored on Sogni servers for 24 hours, after which they are automatically deleted. The examples automatically download your generated media!

### Auto-Opening Files

On macOS, Windows, and Linux, the examples will automatically open generated videos in your default video player. If this fails, you can manually open the file from the output directory.

---

## Troubleshooting

### Common Issues and Solutions

#### "Required dependencies not installed"

**Problem:** You see an error about missing dependencies.

**Solution:**

```bash
cd examples
npm install
```

#### "No credentials found in .env file"

**Problem:** The script can't find your credentials.

**Solution:**

1. Create a `.env` file in the `examples` directory
2. Add your API key or credentials:
   ```env
   SOGNI_API_KEY=your_api_key
   ```
   or:
   ```env
   SOGNI_USERNAME=your_username
   SOGNI_PASSWORD=your_password
   ```
3. Or just run the script and it will prompt you interactively

#### "Insufficient balance"

**Problem:** You don't have enough tokens to run the generation.

**Solution:**

- Claim your daily free tokens in the app (under Rewards)
- Purchase more Spark tokens with a credit card
- Try a cheaper configuration (fewer frames, speed model, lower resolution)

### Getting Help

If you encounter issues not covered here:

1. Check the main [Sogni SDK Documentation](https://sdk-docs.sogni.ai)
2. Review the [Sogni Documentation](https://docs.sogni.ai)
3. Check for existing issues on [GitHub](https://github.com/Sogni-AI/sogni-client)
4. Join the Sogni community Discord (link in main README)

---

## Additional Resources

### Documentation Links

- **SDK API Docs:** [sdk-docs.sogni.ai](https://sdk-docs.sogni.ai)
- **Sogni Documentation:** [docs.sogni.ai](https://docs.sogni.ai)
- **Main SDK README:** [Parent directory README.md](../README.md)
- **Sogni Website:** [sogni.ai](https://www.sogni.ai)
- **Sogni Web App:** [app.sogni.ai](https://app.sogni.ai)

### Learning Path for Beginners

1. **Start Simple:** Run `workflow_text_to_image.mjs` with Z-Turbo for fast image generation
2. **Try Reference-Based:** Explore `workflow_image_edit.mjs` with Qwen models
3. **Learn Events:** Try `event_driven.js` to understand real-time SDK events
4. **Try Video:** Start with `workflow_text_to_video.mjs` for video generation
5. **Advanced Workflows:** Explore image-to-video, sound-to-video (lip-sync), and video-to-video (motion transfer/character replacement)
6. **Chat with LLMs:** Try `workflow_text_chat_streaming.mjs` for real-time text generation
7. **Vision Chat:** Explore `workflow_text_chat_vision.mjs` for multimodal image understanding
8. **Tool Calling:** Explore `workflow_text_chat_tool_calling.mjs` for LLM function calling with external tools
9. **AI-Powered Media:** Use `workflow_text_chat_sogni_tools.mjs` for core image/video/music generation through natural language
10. **Build Something:** Use the Express example as a template for your own app

### Tips for Success

- **Try Z-Turbo for images** - Fast 8-step generation is perfect for experimentation
- **Use Qwen Lightning for edits** - Quick reference-based generation with great results
- **Start with Speed/LightX2V models for video** - Faster and cheaper while learning
- **Use smaller resolutions** - 512x512 or 1024x1024 are good starting points
- **Keep video frame counts low initially** - 81 frames (default) is perfect for testing
- **Save your credentials** - Makes running examples much faster
- **Watch your token balance** - All examples show cost estimates before generation
- **Experiment with prompts** - Small changes can make big differences in output

---

## Contributing

Found a bug in an example or want to add a new one? Contributions are welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Happy Creating! 🎨🎬**

For questions or support, visit [docs.sogni.ai](https://docs.sogni.ai) or the Sogni community channels.
