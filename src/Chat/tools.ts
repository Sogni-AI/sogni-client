import { getVideoWorkflowType } from '../Projects/utils';
import { ToolDefinition, ToolCall } from './types';

function cloneTool(tool: ToolDefinition): ToolDefinition {
  return structuredClone(tool);
}

function isEditImageModel(modelId: string): boolean {
  return modelId.startsWith('qwen_image_edit_')
    || modelId.startsWith('flux2_')
    || modelId.includes('kontext');
}

function filterVideoModelsByWorkflow(
  availableModels: Array<{ id: string; media?: string }>,
  workflows: string[]
): string[] {
  return availableModels
    .filter((model) => model.media === 'video')
    .filter((model) => {
      const workflow = getVideoWorkflowType(model.id);
      return workflow !== null && workflows.includes(workflow);
    })
    .map((model) => model.id);
}

function setModelEnum(tool: ToolDefinition, modelIds: string[], description: string): ToolDefinition {
  if (modelIds.length === 0) {
    return tool;
  }
  (tool.function.parameters as any).properties.model = {
    type: 'string',
    description,
    enum: modelIds
  };
  return tool;
}

/**
 * Built-in Sogni platform tool definitions for use with LLM tool calling.
 *
 * These tools allow the LLM to generate images, edit images, generate videos,
 * transform videos, and generate music through the Sogni Supernet.
 */

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

export const editImageTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_edit_image',
    description:
      'Generate an edited or reference-guided image using 1-6 input images on the Sogni Supernet. Returns URLs to the generated images. Use this tool when the user wants to edit an existing image, preserve a person\'s likeness, combine multiple references, or transform a source image while keeping key visual traits.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Describe the desired edit or new image while clearly stating what should be preserved from the provided reference images.'
        },
        source_image_url: {
          type: 'string',
          description:
            'Primary image to edit or use as the main identity/composition reference. Supports inline base64-encoded PNG or JPEG data URIs only; remote http(s) URLs are not allowed.'
        },
        reference_image_urls: {
          type: 'array',
          description:
            'Additional reference images to guide identity, pose, clothing, style, or background. Supports inline base64-encoded PNG or JPEG data URIs only; remote http(s) URLs are not allowed. Combined with source_image_url, up to 6 images total are used.',
          items: {
            type: 'string'
          }
        },
        negative_prompt: {
          type: 'string',
          description:
            'Things to avoid in the edited image (e.g., "blurry, low quality, distorted").'
        },
        width: {
          type: 'number',
          description:
            'Output image width in pixels. Must be a multiple of 16. Default depends on the model.'
        },
        height: {
          type: 'number',
          description:
            'Output image height in pixels. Must be a multiple of 16. Default depends on the model.'
        },
        model: {
          type: 'string',
          description: 'Image editing model to use.',
          enum: [
            'qwen_image_edit_2511_fp8_lightning',
            'qwen_image_edit_2511_fp8',
            'flux2_dev_fp8',
            'flux1-dev-kontext_fp8_scaled'
          ]
        },
        number_of_variations: {
          type: 'number',
          description: 'Number of edited image variations to generate. Range: 1-16. Default: 1.'
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

export const generateVideoTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_generate_video',
    description:
      'Generate a short video using AI video generation on the Sogni Supernet. Returns URLs to the generated videos. Use this tool EVERY TIME the user asks to create, generate, or make a video, clip, or animation. Do NOT generate URLs yourself — you MUST call this tool. Write the prompt as a cohesive mini-scene in present tense, describing motion, camera movement, lighting, and atmosphere in flowing prose.',
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
        reference_image_url: {
          type: 'string',
          description:
            'Optional starting image for image-to-video generation. Supports inline base64-encoded PNG or JPEG data URIs only; remote http(s) URLs are not allowed.'
        },
        reference_image_end_url: {
          type: 'string',
          description:
            'Optional ending image for keyframe interpolation. Supports inline base64-encoded PNG or JPEG data URIs only; remote http(s) URLs are not allowed.'
        },
        reference_audio_identity_url: {
          type: 'string',
          description:
            'Optional voice identity clip for LTX-2.3 text-to-video or image-to-video workflows. Supports inline base64-encoded MP3, M4A, or WAV data URIs only; remote http(s) URLs are not allowed.'
        },
        audio_identity_strength: {
          type: 'number',
          description:
            'How strongly to apply the reference_audio_identity_url voice identity. Range: 0-10. Default depends on the model.'
        },
        first_frame_strength: {
          type: 'number',
          description:
            'How strictly to match the starting frame when using reference_image_end_url. Range: 0-1.'
        },
        last_frame_strength: {
          type: 'number',
          description:
            'How strictly to match the ending frame when using reference_image_end_url. Range: 0-1.'
        },
        width: {
          type: 'number',
          description:
            'Video width in pixels. Default depends on the selected workflow. Standard resolutions include 1920x1088, 1088x1920, and 1280x720.'
        },
        height: {
          type: 'number',
          description:
            'Video height in pixels. Default depends on the selected workflow. Must be a multiple of 16.'
        },
        duration: {
          type: 'number',
          description: 'Video duration in seconds. Range: 1-20. Default: 5.'
        },
        fps: {
          type: 'number',
          description: 'Frames per second. Default depends on the model. Range: 1-60.'
        },
        model: {
          type: 'string',
          description:
            'Video generation model to use. Prefer LTX-2.3 models: use t2v for text-only generation and i2v when reference images are supplied.'
        },
        number_of_variations: {
          type: 'number',
          description: 'Number of video variations to generate. Range: 1-16. Default: 1.'
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

export const soundToVideoTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_sound_to_video',
    description:
      'Generate a short video synchronized to an input audio clip on the Sogni Supernet. Returns URLs to the generated videos. Use this when the user wants a music video, lip-sync style clip, or audio-reactive visuals driven by a specific audio file.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Describe the visuals to generate in present tense while letting the supplied audio drive the timing and rhythm.'
        },
        reference_audio_url: {
          type: 'string',
          description: 'Audio file to drive the video. Supports inline base64-encoded MP3, M4A, or WAV data URIs only; remote http(s) URLs are not allowed.'
        },
        reference_image_url: {
          type: 'string',
          description:
            'Optional image to use as the subject or first frame. Supports inline base64-encoded PNG or JPEG data URIs only; remote http(s) URLs are not allowed.'
        },
        audio_start: {
          type: 'number',
          description: 'Start offset in seconds into the reference audio. Default: 0.'
        },
        duration: {
          type: 'number',
          description: 'Output video duration in seconds. Range: 1-20. Default: 5.'
        },
        width: {
          type: 'number',
          description: 'Video width in pixels. Default depends on the selected workflow.'
        },
        height: {
          type: 'number',
          description: 'Video height in pixels. Default depends on the selected workflow.'
        },
        model: {
          type: 'string',
          description: 'Audio-driven video model to use.',
          enum: [
            'ltx23-22b-fp8_ia2v_distilled',
            'ltx23-22b-fp8_a2v_distilled',
            'wan_v2.2-14b-fp8_s2v_lightx2v'
          ]
        },
        number_of_variations: {
          type: 'number',
          description: 'Number of video variations to generate. Range: 1-16. Default: 1.'
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducible generation. Use -1 for random.'
        }
      },
      required: ['prompt', 'reference_audio_url']
    }
  }
};

export const videoToVideoTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_video_to_video',
    description:
      'Transform an existing video using AI video-to-video workflows on the Sogni Supernet. Returns URLs to the generated videos. Use this when the user wants to restyle a video, preserve motion while changing the look, or animate/replace a subject using a reference image.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Describe the target appearance or transformation in present tense. For detail enhancement, describe the existing scene and the desired quality improvement rather than inventing new content.'
        },
        reference_video_url: {
          type: 'string',
          description: 'Source video to transform. Supports inline base64-encoded MP4 or MOV/QuickTime data URIs only; remote http(s) URLs are not allowed.'
        },
        negative_prompt: {
          type: 'string',
          description:
            'Things to avoid in the generated video (e.g., "blurry, low quality, distorted, watermark").'
        },
        control_mode: {
          type: 'string',
          description:
            'How to use the source video. animate-move and animate-replace use WAN animate workflows. canny, pose, depth, and detailer use LTX-2.3 v2v ControlNet.',
          enum: ['animate-move', 'animate-replace', 'canny', 'pose', 'depth', 'detailer']
        },
        reference_image_url: {
          type: 'string',
          description:
            'Optional reference image for animate workflows or pose-guided appearance control. Supports inline base64-encoded PNG or JPEG data URIs only; remote http(s) URLs are not allowed.'
        },
        reference_audio_identity_url: {
          type: 'string',
          description:
            'Optional voice identity clip for LTX-2.3 v2v workflows. Supports inline base64-encoded MP3, M4A, or WAV data URIs only; remote http(s) URLs are not allowed.'
        },
        audio_identity_strength: {
          type: 'number',
          description:
            'How strongly to apply the reference_audio_identity_url voice identity. Range: 0-10. Default depends on the model.'
        },
        video_start: {
          type: 'number',
          description: 'Start offset in seconds into the source video.'
        },
        duration: {
          type: 'number',
          description: 'Output video duration in seconds. Range: 1-20. Default: 5.'
        },
        width: {
          type: 'number',
          description: 'Output video width in pixels. Default depends on the selected workflow.'
        },
        height: {
          type: 'number',
          description: 'Output video height in pixels. Default depends on the selected workflow.'
        },
        detailer_strength: {
          type: 'number',
          description:
            'Optional detailer LoRA strength for LTX-2.3 v2v control workflows. Range: 0-1.'
        },
        model: {
          type: 'string',
          description: 'Video-to-video model to use.',
          enum: [
            'ltx23-22b-fp8_v2v_distilled',
            'wan_v2.2-14b-fp8_animate-move_lightx2v',
            'wan_v2.2-14b-fp8_animate-replace_lightx2v'
          ]
        },
        number_of_variations: {
          type: 'number',
          description: 'Number of video variations to generate. Range: 1-16. Default: 1.'
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducible generation. Use -1 for random.'
        }
      },
      required: ['prompt', 'reference_video_url']
    }
  }
};

export const generateMusicTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sogni_generate_music',
    description:
      'Generate a music track using AI music generation on the Sogni Supernet. Returns URLs to the generated audio files. Use this tool EVERY TIME the user asks to create, generate, compose, or make music, a song, a beat, or audio. Do NOT generate URLs yourself — you MUST call this tool.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description:
            'Description of the music to generate. Include genre, mood, tempo, instruments, and style.'
        },
        lyrics: {
          type: 'string',
          description: 'Song lyrics to sing. Omit for instrumental music.'
        },
        language: {
          type: 'string',
          description: 'Lyrics language code, such as "en" or "es".'
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
          description: 'Time signature. Common values: "4", "3", "2", or "6". Default: "4".',
          enum: ['4', '3', '2', '6']
        },
        composer_mode: {
          type: 'boolean',
          description: 'Enable AI composer mode for richer arrangements. Default depends on the model.'
        },
        prompt_strength: {
          type: 'number',
          description: 'How closely the model should follow the prompt. Higher values increase prompt adherence.'
        },
        creativity: {
          type: 'number',
          description: 'Composition variation / temperature. Higher values are more creative.'
        },
        model: {
          type: 'string',
          description:
            'Music generation model. "ace_step_1.5_turbo" is the default and preferred model — highest quality output. "ace_step_1.5_sft" is an experimental model with lower fidelity but best lyric handling support.',
          enum: ['ace_step_1.5_turbo', 'ace_step_1.5_sft']
        },
        output_format: {
          type: 'string',
          description: 'Audio output format. Default: "mp3".',
          enum: ['mp3', 'flac', 'wav']
        },
        number_of_variations: {
          type: 'number',
          description: 'Number of audio variations to generate. Range: 1-16. Default: 1.'
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

export const SogniTools = {
  generateImage: generateImageTool,
  editImage: editImageTool,
  generateVideo: generateVideoTool,
  soundToVideo: soundToVideoTool,
  videoToVideo: videoToVideoTool,
  generateMusic: generateMusicTool,
  get all(): ToolDefinition[] {
    return [
      generateImageTool,
      editImageTool,
      generateVideoTool,
      soundToVideoTool,
      videoToVideoTool,
      generateMusicTool
    ];
  }
};

export function buildSogniTools(
  availableModels?: Array<{ id: string; media?: string }>
): ToolDefinition[] {
  if (!availableModels || availableModels.length === 0) {
    return SogniTools.all;
  }

  const imageModels = availableModels.filter((model) => model.media === 'image').map((model) => model.id);
  const editImageModels = availableModels
    .filter((model) => model.media === 'image' && isEditImageModel(model.id))
    .map((model) => model.id);
  const videoModels = filterVideoModelsByWorkflow(availableModels, ['t2v', 'i2v']);
  const soundToVideoModels = filterVideoModelsByWorkflow(availableModels, ['s2v', 'ia2v', 'a2v']);
  const videoToVideoModels = filterVideoModelsByWorkflow(
    availableModels,
    ['animate-move', 'animate-replace', 'v2v']
  );
  const audioModels = availableModels.filter((model) => model.media === 'audio').map((model) => model.id);

  return [
    setModelEnum(cloneTool(generateImageTool), imageModels, 'Image generation model to use.'),
    setModelEnum(
      cloneTool(editImageTool),
      editImageModels,
      'Image editing model to use. These models support reference-guided editing.'
    ),
    setModelEnum(
      cloneTool(generateVideoTool),
      videoModels,
      'Video generation model to use. Prefer t2v models for text-only generation and i2v models when reference images are supplied.'
    ),
    setModelEnum(
      cloneTool(soundToVideoTool),
      soundToVideoModels,
      'Audio-driven video model to use.'
    ),
    setModelEnum(
      cloneTool(videoToVideoTool),
      videoToVideoModels,
      'Video-to-video model to use.'
    ),
    setModelEnum(
      cloneTool(generateMusicTool),
      audioModels,
      'Music generation model to use.'
    )
  ];
}

export function isSogniToolCall(toolCall: ToolCall): boolean {
  return toolCall.function.name.startsWith('sogni_');
}

export function parseToolCallArguments(toolCall: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return {};
  }
}
