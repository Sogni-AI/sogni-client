import hostedToolManifest from './sogniHostedTools.generated.json';
import { ToolDefinition, ToolCall } from './types';
import { filterVideoModelsByWorkflow, isEditImageModel, VideoWorkflow } from './modelRouting';

type SogniHostedToolName =
  | 'sogni_generate_image'
  | 'sogni_edit_image'
  | 'sogni_generate_video'
  | 'sogni_sound_to_video'
  | 'sogni_video_to_video'
  | 'sogni_generate_music';

interface SogniHostedToolManifest {
  tools: ToolDefinition[];
}

const hostedTools = (hostedToolManifest as SogniHostedToolManifest).tools;

function getHostedTool(name: SogniHostedToolName): ToolDefinition {
  const tool = hostedTools.find((candidate) => candidate.function.name === name);
  if (!tool) {
    throw new Error(`Missing hosted Sogni tool definition: ${name}`);
  }
  return tool;
}

function cloneTool(tool: ToolDefinition): ToolDefinition {
  return structuredClone(tool);
}

function setModelEnum(
  tool: ToolDefinition,
  modelIds: string[],
  description: string
): ToolDefinition {
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
 * These definitions are generated from the shared
 * `@sogni/creative-agent` hosted tool backbone. The public SDK keeps a local
 * generated copy so consumers do not need access to the private package.
 */

export const generateImageTool: ToolDefinition = getHostedTool('sogni_generate_image');
export const editImageTool: ToolDefinition = getHostedTool('sogni_edit_image');
export const generateVideoTool: ToolDefinition = getHostedTool('sogni_generate_video');
export const soundToVideoTool: ToolDefinition = getHostedTool('sogni_sound_to_video');
export const videoToVideoTool: ToolDefinition = getHostedTool('sogni_video_to_video');
export const generateMusicTool: ToolDefinition = getHostedTool('sogni_generate_music');

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

  const imageModels = availableModels
    .filter((model) => model.media === 'image')
    .map((model) => model.id);
  const editImageModels = availableModels
    .filter((model) => model.media === 'image' && isEditImageModel(model.id))
    .map((model) => model.id);
  const videoModels = filterVideoModelsByWorkflow(availableModels, ['t2v', 'i2v']);
  const soundToVideoModels = filterVideoModelsByWorkflow(availableModels, ['s2v', 'ia2v', 'a2v']);
  const videoToVideoModels = filterVideoModelsByWorkflow(availableModels, [
    'animate-move',
    'animate-replace',
    'v2v'
  ] as VideoWorkflow[]);
  const audioModels = availableModels
    .filter((model) => model.media === 'audio')
    .map((model) => model.id);

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
    setModelEnum(cloneTool(videoToVideoTool), videoToVideoModels, 'Video-to-video model to use.'),
    setModelEnum(cloneTool(generateMusicTool), audioModels, 'Music generation model to use.')
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
