# Sogni Client SDK Examples

Welcome to the Sogni Client SDK examples! This directory contains working examples that demonstrate how to use the Sogni SDK to generate images and videos using various AI models and workflows.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running Examples](#running-examples)
- [Available Examples](#available-examples)
  - [Image Generation Examples](#image-generation-examples)
  - [Video Generation Examples](#video-generation-examples)
  - [Web Application Example](#web-application-example)
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

**Option 1: Interactive Prompt (Easiest for Beginners)**

Simply run any example script, and it will prompt you to enter your credentials:
```bash
node video_text_to_video.mjs
```

You'll be asked:
- Username
- Password
- Whether to save credentials (recommended for convenience)

**Option 2: Manual .env File Setup**

Create a file named `.env` in the `examples` directory:

```bash
# In the examples directory
touch .env
```

Edit the `.env` file and add your credentials:

```env
# Sogni Account Credentials
SOGNI_USERNAME=your_username
SOGNI_PASSWORD=your_password

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

**Generate a video from text:**
```bash
node video_text_to_video.mjs "A serene ocean wave"
```

**Animate an image into a video:**
```bash
node video_image_to_video.mjs --image test-assets/salute.png
```

**Generate images (promise-based):**
```bash
node promise_based.mjs
```

**Generate images (event-driven):**
```bash
node event_driven.js
```

---

## Available Examples

### Image Generation Examples

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

### Video Generation Examples

All video examples support the **Wan 2.2 14B FP8** model family with two variants:
- **Speed** (with `_lightx2v` suffix) - Faster, 4-8 steps, good quality
- **Quality** (without suffix) - Slower, 20-40 steps, best quality

**Using Your Own Media Files:**

Most video examples can interactively select files from the `test-assets` folder. To use your own images, videos, or audio files:

1. Navigate to the `test-assets` directory: `cd test-assets`
2. Add your media files (images: `.jpg`, `.png`, `.webp`; videos: `.mp4`; audio: `.mp3`, `.m4a`, `.wav`)
3. Run the example script without file arguments, and it will prompt you to select from available files

Example:
```bash
# Add your own files
cp ~/my-photo.jpg test-assets/
cp ~/my-audio.mp3 test-assets/

# Run the script - it will show your files in the selection menu
node video_sound_to_video.mjs
```

#### `video_text_to_video.mjs`
Generate videos from text prompts.

**Usage:**
```bash
node video_text_to_video.mjs "A cat playing piano"
node video_text_to_video.mjs "Sunset over mountains" --width 768 --height 512
node video_text_to_video.mjs "Ocean waves" --fps 32 --frames 161
```

**Options:**
- `--width <n>` - Video width in pixels (default: 512)
- `--height <n>` - Video height in pixels (default: 512)
- `--fps <n>` - Frames per second: 16 or 32 (default: 16)
- `--frames <n>` - Number of frames: 17-161 (default: 81)
- `--steps <n>` - Inference steps (Speed: 4-8, Quality: 20-40)
- `--model <id>` - Model ID (will prompt if not specified)
- `--output <dir>` - Output directory (default: ./videos)
- `--seed <n>` - Random seed for reproducibility
- `--help` - Show help message

**Interactive Features:**
- Prompts for speed/quality mode if not specified
- Shows cost estimate before generation
- Asks for confirmation before spending tokens
- Displays real-time progress with ETA
- Auto-opens video when complete

**Example Sessions:**
```bash
# Basic usage - will prompt for all options
node video_text_to_video.mjs

# Full command with all options
node video_text_to_video.mjs "A robot walking" --width 1024 --height 576 --fps 16 --frames 81 --seed 42

# Longer video at higher frame rate
node video_text_to_video.mjs "Fireworks display" --fps 32 --frames 161
```

#### `video_image_to_video.mjs`
Animate a static image into a video with optional motion prompts.

**Usage:**
```bash
node video_image_to_video.mjs --image test-assets/salute.png
node video_image_to_video.mjs --image photo.jpg "camera pans left"
node video_image_to_video.mjs --image landscape.png "zoom in" --width 768 --height 512
```

**Options:**
- `--image <path>` - Input image path (required, or will prompt)
- `--width <n>` - Video width (default: auto-detect from image)
- `--height <n>` - Video height (default: auto-detect from image)
- `--fps <n>` - Frames per second: 16 or 32 (default: 16)
- `--frames <n>` - Number of frames: 17-161 (default: 81)
- `--steps <n>` - Inference steps
- `--model <id>` - Model ID (will prompt if not specified)
- `--output <dir>` - Output directory (default: ./videos)
- `--seed <n>` - Random seed
- `--help` - Show help message

**Features:**
- Auto-detects image dimensions
- Optional motion prompt (e.g., "camera pans left", "zoom in")
- Interactive image selection from `test-assets` folder
- Preserves subject while adding motion
- You can add your own images to the `test-assets` folder

**Motion Prompt Examples:**
- "camera pans left"
- "camera pans right"
- "zoom in slowly"
- "zoom out"
- "camera rotates"
- Or leave blank for automatic animation

#### `video_sound_to_video.mjs`
Generate videos synchronized with audio, including lip-syncing for characters.

**Usage:**
```bash
node video_sound_to_video.mjs
node video_sound_to_video.mjs --model wan_v2.2-14b-fp8_s2v_lightx2v
node video_sound_to_video.mjs --width 640 --height 480
```

**Options:**
- `--model <id>` - Model ID (will prompt if not specified)
- `--steps <n>` - Inference steps (Speed: 4-8, default 4; Quality: 20-40, default 25)
- `--width <n>` - Video width (default: auto-detect from reference image)
- `--height <n>` - Video height (default: auto-detect from reference image)

**Features:**
- Interactive file selection from `test-assets` folder
- Lip-sync animation for speaking characters
- Emotion matching from audio
- Automatic audio length detection
- Calculates required frame count from audio duration
- You can add your own image and audio files to the `test-assets` folder

**Supported Audio Formats:**
- `.mp3` (recommended)
- `.m4a`
- `.wav`

**Note:** The script will interactively prompt you to select image and audio files from the `test-assets` directory if you don't specify them via command line.

#### `video_animate_move.mjs`
Transfer motion and emotion from a reference video to a subject in an image.

**Usage:**
```bash
node video_animate_move.mjs
node video_animate_move.mjs --model wan_v2.2-14b-fp8_animate-move_lightx2v
node video_animate_move.mjs --steps 6
node video_animate_move.mjs --width 640 --height 480
```

**Options:**
- `--model <id>` - Model ID (will prompt if not specified)
- `--steps <n>` - Inference steps (Speed: 4-8, default 4; Quality: 20-40, default 25)
- `--width <n>` - Video width (default: auto-detect from reference video)
- `--height <n>` - Video height (default: auto-detect from reference video)

**Features:**
- Interactive file selection from `test-assets` folder for both image and video
- Auto-detects video dimensions and frame count
- You can add your own image and video files to the `test-assets` folder

**Use Cases:**
- Apply dance moves from one person to another
- Transfer facial expressions
- Animate cartoon/illustration characters with real motion
- Create puppeteer effects

**Note:** The script will interactively prompt you to select image and video files from the `test-assets` directory.

#### `video_animate_replace.mjs`
Replace a subject in a video while preserving the original motion and background.

**Usage:**
```bash
node video_animate_replace.mjs
node video_animate_replace.mjs --model wan_v2.2-14b-fp8_animate-replace_lightx2v
node video_animate_replace.mjs --steps 6
node video_animate_replace.mjs --width 640 --height 480
```

**Options:**
- `--model <id>` - Model ID (will prompt if not specified)
- `--steps <n>` - Inference steps (Speed: 4-8, default 4; Quality: 20-40, default 25)
- `--width <n>` - Video width (default: auto-detect from reference video)
- `--height <n>` - Video height (default: auto-detect from reference video)

**Features:**
- Interactive file selection from `test-assets` folder for both image and video
- Auto-detects video dimensions and frame count
- You can add your own image and video files to the `test-assets` folder

**Use Cases:**
- Replace actors in scenes
- Swap characters while maintaining action
- Create alternative versions of existing videos
- Visual effects and compositing

**Note:** The script will interactively prompt you to select image and video files from the `test-assets` directory.

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

### Common Options Across Video Examples

The following options are available across most video examples. Note that some scripts may not support all options - check the individual script documentation above for specifics.

| Option | Description | Default | Valid Values | Availability |
|--------|-------------|---------|--------------|--------------|
| `--model` | Model ID | Interactive prompt | See models section | All video scripts |
| `--steps` | Inference steps | Auto (4 or 25) | Speed: 4-8, Quality: 20-40 | All video scripts |
| `--width` | Video width in pixels | 512 or auto-detect | 256-2048 | All video scripts |
| `--height` | Video height in pixels | 512 or auto-detect | 256-2048 | All video scripts |
| `--fps` | Frames per second | 16 | 16, 32 | text_to_video only |
| `--frames` | Total number of frames | 81 (~5s at 16fps) | 17-161 | text_to_video only |
| `--output` | Output directory | ./videos | Any valid path | text_to_video, image_to_video |
| `--seed` | Random seed | Random | 0-2147483647 | text_to_video, image_to_video |
| `--image` | Input image path | Interactive prompt | Any image file | image_to_video only |

**Note:** The `sound_to_video`, `animate_move`, and `animate_replace` scripts use interactive file selection and automatically detect dimensions and frame counts from the reference media. They don't support `--fps`, `--frames`, `--output`, `--seed`, or `--image` flags.

### Frame and Duration Guide

At **16 FPS** (frames per second):
- 17 frames = ~1 second
- 81 frames = ~5 seconds (default)
- 161 frames = ~10 seconds

At **32 FPS**:
- 33 frames = ~1 second
- 161 frames = ~5 seconds
- 321 frames would be ~10 seconds (but max is 161)

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

When you run an example, you'll see output like:

```
╔══════════════════════════════════════════════════════════╗
║        Sogni Text-to-Video (via Wan 2.2 14B)            ║
╚══════════════════════════════════════════════════════════╝

✓ Credentials loaded from .env file

⚡ Select generation mode:

  1. Speed   - Faster generation, good quality (LightX2V)
  2. Quality - Slower generation, best quality - 2.5x cost

Enter choice [1/2] (default: 1): 1
  → Using Speed mode

🔎 Using appId: john-t2v-1702345678-a1b2c3

💳 Using saved payment preference: Spark tokens

💵 Fetching cost estimate...

📊 Cost Estimate:
   Spark: 0.45 (Balance remaining: 9.55)
   USD: $0.0023

Proceed with generation? [Y/n]: y

┌─────────────────────────────────────────────────────────┐
│ Video Configuration                                     │
├─────────────────────────────────────────────────────────┤
│ Model:        wan_v2.2-14b-fp8_t2v_lightx2v             │
│ Resolution:   512x512                                   │
│ Frames:       81                                        │
│ Duration:     5s at 16fps                               │
│ Steps:        4                                         │
│ Seed:         1234567                                   │
│ Prompt:       A serene ocean wave                       │
└─────────────────────────────────────────────────────────┘

🔄 Loading available models...
✓ Model ready: Wan 2.2 14B FP8 T2V (Speed)

📤 Submitting video generation job...
⏳ (This may take several minutes)

📋 Job queued at position: 1
⚙️ Model initiating on worker: gpu-worker-42
🚀 Job started on worker: gpu-worker-42
  Generating... ETA: 2:30 (0:15 elapsed)
✅ Job completed!
✅ Project completed!

📥 Downloading video...

✅ Video generation complete!
📁 Saved to: ./videos/video_proj123_1.mp4
⏱️  Total time: 2:45
🎬 Opening video...
```

### Output Files

Generated videos are saved to the output directory (default: `./videos/`):

```
videos/
├── video_proj123_1.mp4
├── video_proj124_1.mp4
└── ...
```

**Important:** Videos are also stored on Sogni servers for 24 hours, after which they are automatically deleted. Make sure to download any videos you want to keep!

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
2. Add your credentials:
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

1. **Start Simple:** Run `promise_based.mjs` to understand basic image generation
2. **Learn Events:** Try `event_driven.js` to see real-time updates
3. **Try Video:** Start with `video_text_to_video.mjs` for simple video generation
4. **Advanced Workflows:** Explore image-to-video, sound-to-video, and animation examples
5. **Build Something:** Use the Express example as a template for your own app

### Tips for Success

- **Start with Speed models** - They're faster and cheaper while you're learning
- **Use smaller resolutions** - 512x512 is a good starting point
- **Keep frame counts low initially** - 81 frames (default) is perfect for testing
- **Save your credentials** - Makes running examples much faster
- **Watch your token balance** - Monitor costs before confirming generations
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

