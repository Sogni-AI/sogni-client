import { ToolDefinition, ToolCall } from './types';

/**
 * Built-in Sogni platform tool definitions for use with LLM tool calling.
 *
 * These tools allow the LLM to generate images, videos, and music
 * through the Sogni Supernet. Include them in your `tools` array when
 * calling `sogni.chat.completions.create()`.
 *
 * @example
 * ```typescript
 * import { SogniTools } from '@sogni-ai/sogni-client';
 *
 * const stream = await sogni.chat.completions.create({
 *   model: 'qwen3.5-35b-a3b-gguf-q4km',
 *   messages: [{ role: 'user', content: 'Generate an image of a sunset' }],
 *   tools: SogniTools.all,
 *   tool_choice: 'auto',
 *   stream: true,
 * });
 * ```
 */

/** Tool definition: Generate an image using the Sogni Supernet */
export const generateImageTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_generate_image',
    description:
      'Generate an image using AI image generation on the Sogni Supernet. Returns a URL to the generated image. Use this tool EVERY TIME the user asks to create, generate, draw, or make an image or picture. Do NOT generate URLs yourself — you MUST call this tool.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Detailed text description of the image to generate. Be specific about style, composition, lighting, colors, and subject matter.'
        },
        negative_prompt: {
          type: 'string',
          description:
            'Things to avoid in the generated image (e.g., "blurry, low quality, distorted").'
        },
        width: {
          type: 'number',
          description: 'Image width in pixels. Must be a multiple of 16. Default: 1024. Max: 2048.'
        },
        height: {
          type: 'number',
          description: 'Image height in pixels. Must be a multiple of 16. Default: 1024. Max: 2048.'
        },
        model: {
          type: 'string',
          description: 'Image generation model to use.',
          enum: [
            'flux1-schnell-fp8',
            'flux2-dev_fp8',
            'chroma-v.46-flash_fp8',
            'z_image_turbo_bf16'
          ]
        },
        steps: {
          type: 'number',
          description:
            'Number of inference steps. Higher = better quality but slower. Default depends on model (4-50).'
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducible generation. Use -1 for random.'
        }
      },
      required: ['prompt']
    }
  }
};

/** Tool definition: Generate a video using the Sogni Supernet */
export const generateVideoTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_generate_video',
    description:
      'Generate a short video using AI video generation on the Sogni Supernet. Returns a URL to the generated video. Use this tool EVERY TIME the user asks to create, generate, or make a video, clip, or animation. Do NOT generate URLs yourself — you MUST call this tool. Write the prompt as a cohesive mini-scene in present tense, describing motion, camera movement, lighting, and atmosphere in flowing prose.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Detailed text description of the video to generate. Write it as a flowing present-tense scene: describe the subject, action, camera movement, lighting, and atmosphere. Clear camera-to-subject relationship improves motion consistency. Be specific and vivid.'
        },
        negative_prompt: {
          type: 'string',
          description:
            'Things to avoid in the generated video (e.g., "blurry, low quality, distorted, watermark").'
        },
        width: {
          type: 'number',
          description:
            'Video width in pixels. Default: 1920. Standard resolutions: 1920x1088 (landscape), 1088x1920 (portrait), 1280x720.'
        },
        height: {
          type: 'number',
          description: 'Video height in pixels. Default: 1088. Must be a multiple of 16.'
        },
        duration: {
          type: 'number',
          description: 'Video duration in seconds. Range: 1-20. Default: 5.'
        },
        fps: {
          type: 'number',
          description: 'Frames per second. Default: 24. Range: 1-60.'
        },
        model: {
          type: 'string',
          description:
            'Video generation model to use. Prefer LTX-2.3 text-to-video (t2v) models for best quality.'
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducible generation. Use -1 for random.'
        }
      },
      required: ['prompt']
    }
  }
};

/** Tool definition: Generate music using the Sogni Supernet */
export const generateMusicTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_generate_music',
    description:
      'Generate a music track using AI music generation on the Sogni Supernet. Returns a URL to the generated audio file. Use this tool EVERY TIME the user asks to create, generate, compose, or make music, a song, a beat, or audio. Do NOT generate URLs yourself — you MUST call this tool.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Description of the music to generate. Include genre, mood, tempo, instruments, and style. Can also include lyrics wrapped in [verse], [chorus], etc. tags.'
        },
        duration: {
          type: 'number',
          description: 'Duration of the generated music in seconds. Range: 10-600. Default: 30.'
        },
        bpm: {
          type: 'number',
          description: 'Beats per minute. Range: 30-300. Default: 120.'
        },
        keyscale: {
          type: 'string',
          description:
            'Musical key and scale (e.g., "C major", "A minor", "F# minor", "Bb major"). Default: "C major".'
        },
        timesignature: {
          type: 'string',
          description: 'Time signature. "4" for 4/4, "3" for 3/4, "2" for 2/4. Default: "4".',
          enum: ['4', '3', '2']
        },
        model: {
          type: 'string',
          description:
            'Music generation model. "ace_step_1.5_turbo" for fast/catchy, "ace_step_1.5_sft" for more control over lyrics.',
          enum: ['ace_step_1.5_turbo', 'ace_step_1.5_sft']
        },
        output_format: {
          type: 'string',
          description: 'Audio output format. Default: "mp3".',
          enum: ['mp3', 'flac', 'wav']
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducible generation. Use -1 for random.'
        }
      },
      required: ['prompt']
    }
  }
};

/**
 * Collection of all Sogni platform tool definitions.
 */
export const SogniTools = {
  /** Generate an image */
  generateImage: generateImageTool,
  /** Generate a video */
  generateVideo: generateVideoTool,
  /** Generate music */
  generateMusic: generateMusicTool,
  /** All Sogni tools combined — convenience array for `tools` param */
  get all(): ToolDefinition[] {
    return [generateImageTool, generateVideoTool, generateMusicTool];
  }
};

/**
 * Build Sogni tool definitions with dynamically populated model enums
 * based on currently available models on the network.
 *
 * @param availableModels - Result of `sogni.projects.waitForModels()`. If omitted, returns
 *   the default tool definitions with static model lists.
 *
 * @example
 * ```typescript
 * import { buildSogniTools } from '@sogni-ai/sogni-client';
 *
 * const models = await sogni.projects.waitForModels();
 * const tools = buildSogniTools(models);
 *
 * const stream = await sogni.chat.completions.create({
 *   model: 'qwen3.5-35b-a3b-gguf-q4km',
 *   messages,
 *   tools,
 *   stream: true,
 * });
 * ```
 */
export function buildSogniTools(
  availableModels?: Array<{ id: string; media?: string }>
): ToolDefinition[] {
  if (!availableModels || availableModels.length === 0) {
    return SogniTools.all;
  }

  const imageModels = availableModels.filter((m) => m.media === 'image').map((m) => m.id);
  const videoModels = availableModels.filter((m) => m.media === 'video').map((m) => m.id);
  const audioModels = availableModels.filter((m) => m.media === 'audio').map((m) => m.id);

  const tools: ToolDefinition[] = [];

  // Image tool — override model enum if image models are available
  const imageTool = structuredClone(generateImageTool);
  if (imageModels.length > 0) {
    (imageTool.function.parameters as any).properties.model.enum = imageModels;
  }
  tools.push(imageTool);

  // Video tool — override model enum if video models are available
  const videoTool = structuredClone(generateVideoTool);
  if (videoModels.length > 0) {
    (videoTool.function.parameters as any).properties.model = {
      type: 'string',
      description: 'Video generation model to use. Choose a text-to-video (t2v) model.',
      enum: videoModels
    };
  }
  tools.push(videoTool);

  // Music tool — override model enum if audio models are available
  const musicTool = structuredClone(generateMusicTool);
  if (audioModels.length > 0) {
    (musicTool.function.parameters as any).properties.model = {
      type: 'string',
      description:
        'Music generation model. "ace_step_1.5_turbo" for fast/catchy, "ace_step_1.5_sft" for more control over lyrics.',
      enum: audioModels
    };
  }
  tools.push(musicTool);

  return tools;
}

/**
 * Check if a tool call is a Sogni platform tool.
 */
export function isSogniToolCall(toolCall: ToolCall): boolean {
  return toolCall.function.name.startsWith('sogni_');
}

/**
 * Parse arguments from a tool call's JSON string.
 * Returns the parsed object or an empty object if parsing fails.
 */
export function parseToolCallArguments(toolCall: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return {};
  }
}
