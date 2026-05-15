import hostedToolManifest from './sogniHostedTools.generated.json';
import { ToolDefinition, ToolCall } from './types';

/**
 * Canonical hosted creative-tool names mirrored from
 * `@sogni/creative-agent/src/backbone/openai-tools/{generation,composition}-tools.json`.
 * The legacy `sogni_*` prefixed names were retired; tool names are now flat.
 */
export type SogniHostedToolName =
  | 'generate_image'
  | 'generate_video'
  | 'generate_music'
  | 'edit_image'
  | 'apply_style'
  | 'restore_photo'
  | 'refine_result'
  | 'animate_photo'
  | 'change_angle'
  | 'video_to_video'
  | 'stitch_video'
  | 'orbit_video'
  | 'dance_montage'
  | 'sound_to_video'
  | 'extend_video'
  | 'replace_video_segment'
  | 'overlay_video'
  | 'add_subtitles'
  | 'enhance_prompt'
  | 'compose_lyrics'
  | 'compose_instrumental'
  | 'compose_script'
  | 'compose_workflow'
  | 'compose_workflow_template';

interface SogniHostedToolManifest {
  tools: ToolDefinition[];
}

const hostedTools = (hostedToolManifest as SogniHostedToolManifest).tools;
const HOSTED_TOOL_NAMES = new Set<string>(hostedTools.map((tool) => tool.function.name));

function getHostedTool(name: SogniHostedToolName): ToolDefinition {
  const tool = hostedTools.find((candidate) => candidate.function.name === name);
  if (!tool) {
    throw new Error(`Missing hosted Sogni tool definition: ${name}`);
  }
  return tool;
}

/**
 * Built-in Sogni platform tool definitions for use with LLM tool calling.
 *
 * Generated from the shared `@sogni/creative-agent` hosted tool backbone via
 * `npm run sync:hosted-tools-manifest`. The public SDK keeps a local copy so
 * consumers do not need the private creative-agent package at runtime.
 */

// Generation tools (image / video / audio).
export const generateImageTool: ToolDefinition = getHostedTool('generate_image');
export const editImageTool: ToolDefinition = getHostedTool('edit_image');
export const generateVideoTool: ToolDefinition = getHostedTool('generate_video');
export const soundToVideoTool: ToolDefinition = getHostedTool('sound_to_video');
export const videoToVideoTool: ToolDefinition = getHostedTool('video_to_video');
export const generateMusicTool: ToolDefinition = getHostedTool('generate_music');

// Image adapters (style / restore / refine / re-angle / animate).
export const applyStyleTool: ToolDefinition = getHostedTool('apply_style');
export const restorePhotoTool: ToolDefinition = getHostedTool('restore_photo');
export const refineResultTool: ToolDefinition = getHostedTool('refine_result');
export const changeAngleTool: ToolDefinition = getHostedTool('change_angle');
export const animatePhotoTool: ToolDefinition = getHostedTool('animate_photo');

// Video composition / post-production tools.
export const stitchVideoTool: ToolDefinition = getHostedTool('stitch_video');
export const orbitVideoTool: ToolDefinition = getHostedTool('orbit_video');
export const danceMontageTool: ToolDefinition = getHostedTool('dance_montage');
export const extendVideoTool: ToolDefinition = getHostedTool('extend_video');
export const replaceVideoSegmentTool: ToolDefinition = getHostedTool('replace_video_segment');
export const overlayVideoTool: ToolDefinition = getHostedTool('overlay_video');
export const addSubtitlesTool: ToolDefinition = getHostedTool('add_subtitles');

// Synchronous composition tools (text-only outputs).
export const enhancePromptTool: ToolDefinition = getHostedTool('enhance_prompt');
export const composeLyricsTool: ToolDefinition = getHostedTool('compose_lyrics');
export const composeInstrumentalTool: ToolDefinition = getHostedTool('compose_instrumental');
export const composeScriptTool: ToolDefinition = getHostedTool('compose_script');
export const composeWorkflowTool: ToolDefinition = getHostedTool('compose_workflow');
export const composeWorkflowTemplateTool: ToolDefinition = getHostedTool('compose_workflow_template');

export const SogniTools = {
  generateImage: generateImageTool,
  editImage: editImageTool,
  generateVideo: generateVideoTool,
  soundToVideo: soundToVideoTool,
  videoToVideo: videoToVideoTool,
  generateMusic: generateMusicTool,
  applyStyle: applyStyleTool,
  restorePhoto: restorePhotoTool,
  refineResult: refineResultTool,
  changeAngle: changeAngleTool,
  animatePhoto: animatePhotoTool,
  stitchVideo: stitchVideoTool,
  orbitVideo: orbitVideoTool,
  danceMontage: danceMontageTool,
  extendVideo: extendVideoTool,
  replaceVideoSegment: replaceVideoSegmentTool,
  overlayVideo: overlayVideoTool,
  addSubtitles: addSubtitlesTool,
  enhancePrompt: enhancePromptTool,
  composeLyrics: composeLyricsTool,
  composeInstrumental: composeInstrumentalTool,
  composeScript: composeScriptTool,
  composeWorkflow: composeWorkflowTool,
  composeWorkflowTemplate: composeWorkflowTemplateTool,
  /**
   * Full canonical hosted creative-tools surface (24 tools) — generation tools,
   * image adapters, video composition / post-production, and synchronous
   * composition tools. Mirrored from `@sogni/creative-agent`. Route tool calls
   * through `chat.hosted.create()` or `chat.runs.create()` for server-side
   * execution. Server-side enforcement validates per-account model access, so
   * the manifest's model enums are advisory hints to the LLM, not access control.
   */
  get all(): ToolDefinition[] {
    return [...hostedTools];
  }
};

/**
 * True if the tool call targets a canonical Sogni hosted creative tool.
 * Replaces the legacy `sogni_` prefix check; tool names are now flat and
 * verified against the manifest mirrored from `@sogni/creative-agent`.
 */
export function isSogniToolCall(toolCall: ToolCall): boolean {
  return HOSTED_TOOL_NAMES.has(toolCall.function.name);
}

export function parseToolCallArguments(toolCall: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    return {};
  }
}
