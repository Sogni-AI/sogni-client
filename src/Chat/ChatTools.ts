import type ProjectsApi from '../Projects';
import type { AvailableModel } from '../Projects/types';
import { getVideoWorkflowType } from '../Projects/utils';
import { getMaxContextImages } from '../lib/validation';
import { isSogniToolCall, parseToolCallArguments } from './tools';
import {
  ToolCall,
  ToolExecutionOptions,
  ToolExecutionProgress,
  ToolExecutionResult
} from './types';

const DEFAULT_TIMEOUT = 10 * 60 * 1000;

type MediaType = 'image' | 'video' | 'audio';
type VideoWorkflow =
  | 't2v'
  | 'i2v'
  | 's2v'
  | 'ia2v'
  | 'a2v'
  | 'v2v'
  | 'animate-move'
  | 'animate-replace';
type VideoControlMode = 'animate-move' | 'animate-replace' | 'canny' | 'pose' | 'depth' | 'detailer';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNonEmptyString);
}

function clampVariationCount(value: unknown, fallback = 1): number {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(16, Math.round(count)));
}

function normalizeTimeSignature(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.round(value));
  }
  return undefined;
}

function normalizeVideoControlMode(value: unknown): VideoControlMode {
  switch (value) {
    case 'animate-replace':
    case 'canny':
    case 'pose':
    case 'depth':
    case 'detailer':
      return value;
    default:
      return 'animate-move';
  }
}

function isEditImageModel(modelId: string): boolean {
  return modelId.startsWith('qwen_image_edit_')
    || modelId.startsWith('flux2_')
    || modelId.includes('kontext');
}

function getVideoDefaults(modelId: string): { width: number; height: number; fps: number } {
  const workflow = getVideoWorkflowType(modelId);
  const isLtx2 = modelId.startsWith('ltx2-') || modelId.startsWith('ltx23-');

  if (workflow === 's2v' || workflow === 'animate-move' || workflow === 'animate-replace') {
    return { width: 832, height: 480, fps: 16 };
  }
  if (isLtx2) {
    return { width: 1920, height: 1088, fps: 24 };
  }
  return { width: 848, height: 480, fps: 16 };
}

function getVariationCount(
  args: Record<string, unknown>,
  options?: ToolExecutionOptions
): number {
  if (args.number_of_variations !== undefined) {
    return clampVariationCount(args.number_of_variations);
  }
  return clampVariationCount(options?.numberOfMedia, 1);
}

async function fetchInputMedia(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch input media: ${response.status} ${response.statusText}`);
  }
  return response.blob();
}

class ChatToolsApi {
  private projects: ProjectsApi;

  constructor(projects: ProjectsApi) {
    this.projects = projects;
  }

  async execute(toolCall: ToolCall, options?: ToolExecutionOptions): Promise<ToolExecutionResult> {
    if (!this.projects) {
      throw new Error(
        'ChatToolsApi requires ProjectsApi. Ensure SogniClient was properly initialized via SogniClient.createInstance().'
      );
    }
    if (!isSogniToolCall(toolCall)) {
      throw new Error(
        `Not a Sogni tool call: ${toolCall.function.name}. Use isSogniToolCall() to check first.`
      );
    }

    const args = parseToolCallArguments(toolCall);
    const name = toolCall.function.name;

    try {
      switch (name) {
        case 'sogni_generate_image':
          return await this.executeImageGeneration(toolCall, args, options);
        case 'sogni_edit_image':
          return await this.executeImageEdit(toolCall, args, options);
        case 'sogni_generate_video':
          return await this.executeVideoGeneration(toolCall, args, options);
        case 'sogni_sound_to_video':
          return await this.executeSoundToVideo(toolCall, args, options);
        case 'sogni_video_to_video':
          return await this.executeVideoToVideo(toolCall, args, options);
        case 'sogni_generate_music':
          return await this.executeMusicGeneration(toolCall, args, options);
        default:
          return this.makeErrorResult(toolCall, `Unknown Sogni tool: ${name}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return this.makeErrorResult(toolCall, error);
    }
  }

  async executeAll(
    toolCalls: ToolCall[],
    options?: ToolExecutionOptions & {
      onToolCall?: (toolCall: ToolCall) => Promise<string>;
      onToolProgress?: (toolCall: ToolCall, progress: ToolExecutionProgress) => void;
    }
  ): Promise<ToolExecutionResult[]> {
    const results: ToolExecutionResult[] = [];

    for (const toolCall of toolCalls) {
      if (isSogniToolCall(toolCall)) {
        const execOptions: ToolExecutionOptions = {
          tokenType: options?.tokenType,
          network: options?.network,
          numberOfMedia: options?.numberOfMedia,
          timeout: options?.timeout,
          onProgress: options?.onToolProgress
            ? (progress: ToolExecutionProgress) => options.onToolProgress!(toolCall, progress)
            : options?.onProgress
        };
        results.push(await this.execute(toolCall, execOptions));
      } else if (options?.onToolCall) {
        try {
          const content = await options.onToolCall(toolCall);
          results.push({
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            resultUrls: [],
            content
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          results.push(this.makeErrorResult(toolCall, error));
        }
      } else {
        results.push(
          this.makeErrorResult(
            toolCall,
            `No handler for non-Sogni tool: ${toolCall.function.name}. Provide an onToolCall callback.`
          )
        );
      }
    }

    return results;
  }

  private async getAvailableModels(): Promise<AvailableModel[]> {
    return this.projects.waitForModels(10000);
  }

  private async selectModel(options: {
    mediaType: MediaType;
    requestedModel?: string;
    workflows?: VideoWorkflow[];
    filter?: (modelId: string) => boolean;
    preferredModelIds?: string[];
  }): Promise<string> {
    const models = await this.getAvailableModels();
    const byMedia = models.filter((model) => model.media === options.mediaType);

    if (byMedia.length === 0) {
      throw new Error(`No ${options.mediaType} models currently available on the network`);
    }

    const compatible = byMedia.filter((model) => {
      if (options.filter && !options.filter(model.id)) {
        return false;
      }
      if (options.workflows) {
        const workflow = getVideoWorkflowType(model.id);
        return workflow !== null && options.workflows.includes(workflow as VideoWorkflow);
      }
      return true;
    });

    if (options.requestedModel) {
      const requested = compatible.find((model) => model.id === options.requestedModel);
      if (requested) {
        return requested.id;
      }
    }

    if (compatible.length === 0) {
      if (options.workflows) {
        throw new Error(
          `No compatible ${options.mediaType} models available for workflows: ${options.workflows.join(', ')}`
        );
      }
      throw new Error(`No compatible ${options.mediaType} models currently available on the network`);
    }

    if (options.preferredModelIds) {
      for (const preferredId of options.preferredModelIds) {
        const preferred = compatible
          .filter((model) => model.id === preferredId)
          .sort((a, b) => b.workerCount - a.workerCount)[0];
        if (preferred) {
          return preferred.id;
        }
      }
    }

    compatible.sort((a, b) => b.workerCount - a.workerCount);
    return compatible[0].id;
  }

  private async executeProject(
    toolCall: ToolCall,
    mediaType: MediaType,
    modelId: string,
    projectParams: Record<string, unknown>,
    prompt: string,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    options?.onProgress?.({ status: 'creating', percent: 0 });

    const project = await this.projects.create(projectParams as any);
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let jobsCompleted = 0;
    let jobsFailed = 0;
    const totalJobs = (projectParams.numberOfMedia as number) || 1;

    const onJobCompleted = () => {
      jobsCompleted++;
      const percent = Math.round((jobsCompleted / totalJobs) * 100);
      options?.onProgress?.({ status: 'processing', percent });
    };
    const onJobFailed = () => {
      jobsFailed++;
    };

    const onProgress = (percent: number) => {
      options?.onProgress?.({
        status: 'processing',
        percent: Number.isFinite(percent) ? percent : 0
      });
    };

    project.on('progress', onProgress);
    project.on('jobCompleted', onJobCompleted);
    project.on('jobFailed', onJobFailed);

    options?.onProgress?.({ status: 'queued', percent: 0 });

    try {
      const resultUrls = await Promise.race<string[]>([
        project.waitForCompletion(),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(
              new Error(
                `${mediaType} generation timed out after ${Math.round(timeout / 1000)}s ` +
                  `(project: ${project.id}, jobs: ${jobsCompleted}/${totalJobs} completed, ${jobsFailed} failed). ` +
                  `Increase the timeout option or check network worker availability.`
              )
            );
          }, timeout);
        })
      ]);

      options?.onProgress?.({ status: 'completed', percent: 100, resultUrls });

      return {
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        success: true,
        resultUrls,
        content: JSON.stringify({
          success: true,
          media_type: mediaType,
          urls: resultUrls,
          model: modelId,
          prompt
        })
      };
    } catch (err) {
      try {
        await project.cancel();
      } catch {
        // best-effort cleanup
      }

      options?.onProgress?.({ status: 'failed', percent: 0 });
      throw err;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      project.off('progress', onProgress);
      project.off('jobCompleted', onJobCompleted);
      project.off('jobFailed', onJobFailed);
    }
  }

  private async executeImageGeneration(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const modelId = await this.selectModel({
      mediaType: 'image',
      requestedModel: args.model as string | undefined
    });

    const projectParams: Record<string, unknown> = {
      type: 'image' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options)
    };

    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.width && args.height) {
      projectParams.width = args.width;
      projectParams.height = args.height;
      projectParams.sizePreset = 'custom';
    }
    if (args.steps !== undefined) projectParams.steps = args.steps;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'image',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeImageEdit(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const sourceImageUrl = isNonEmptyString(args.source_image_url) ? args.source_image_url : null;
    const referenceImageUrls = asStringArray(args.reference_image_urls);
    const inputUrls = [...(sourceImageUrl ? [sourceImageUrl] : []), ...referenceImageUrls];

    if (inputUrls.length === 0) {
      throw new Error('sogni_edit_image requires source_image_url or reference_image_urls');
    }

    const modelId = await this.selectModel({
      mediaType: 'image',
      requestedModel: args.model as string | undefined,
      filter: isEditImageModel
    });
    const maxContextImages = getMaxContextImages(modelId);
    const contextImages = await Promise.all(
      inputUrls.slice(0, maxContextImages).map((url) => fetchInputMedia(url))
    );

    const projectParams: Record<string, unknown> = {
      type: 'image' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options),
      contextImages
    };

    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.width && args.height) {
      projectParams.width = args.width;
      projectParams.height = args.height;
      projectParams.sizePreset = 'custom';
    }
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'image',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeVideoGeneration(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const hasReferenceImages = isNonEmptyString(args.reference_image_url)
      || isNonEmptyString(args.reference_image_end_url);
    const workflowPreference: VideoWorkflow[] = hasReferenceImages ? ['i2v'] : ['t2v'];
    const preferredModelIds = hasReferenceImages
      ? ['ltx23-22b-fp8_i2v_distilled']
      : ['ltx23-22b-fp8_t2v_distilled'];

    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: args.model as string | undefined,
      workflows: workflowPreference,
      preferredModelIds
    });
    const defaults = getVideoDefaults(modelId);

    const projectParams: Record<string, unknown> = {
      type: 'video' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options),
      width: (args.width as number) || defaults.width,
      height: (args.height as number) || defaults.height,
      fps: (args.fps as number) || defaults.fps
    };

    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.duration !== undefined) projectParams.duration = args.duration;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (isNonEmptyString(args.reference_image_url)) {
      projectParams.referenceImage = await fetchInputMedia(args.reference_image_url);
    }
    if (isNonEmptyString(args.reference_image_end_url)) {
      projectParams.referenceImageEnd = await fetchInputMedia(args.reference_image_end_url);
    }
    if (isNonEmptyString(args.reference_audio_identity_url)) {
      projectParams.referenceAudioIdentity = await fetchInputMedia(args.reference_audio_identity_url);
    }
    if (args.audio_identity_strength !== undefined) {
      projectParams.audioIdentityStrength = args.audio_identity_strength;
    }
    if (args.first_frame_strength !== undefined) {
      projectParams.firstFrameStrength = args.first_frame_strength;
    }
    if (args.last_frame_strength !== undefined) {
      projectParams.lastFrameStrength = args.last_frame_strength;
    }
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'video',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeSoundToVideo(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    if (!isNonEmptyString(args.reference_audio_url)) {
      throw new Error('sogni_sound_to_video requires reference_audio_url');
    }

    const hasReferenceImage = isNonEmptyString(args.reference_image_url);
    const workflows: VideoWorkflow[] = hasReferenceImage ? ['ia2v', 's2v'] : ['a2v'];
    const preferredModelIds = hasReferenceImage
      ? ['ltx23-22b-fp8_ia2v_distilled', 'wan_v2.2-14b-fp8_s2v_lightx2v']
      : ['ltx23-22b-fp8_a2v_distilled'];
    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: args.model as string | undefined,
      workflows,
      preferredModelIds
    });
    const defaults = getVideoDefaults(modelId);
    const duration = asNumber(args.duration) ?? 5;

    const projectParams: Record<string, unknown> = {
      type: 'video' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options),
      referenceAudio: await fetchInputMedia(args.reference_audio_url),
      width: (args.width as number) || defaults.width,
      height: (args.height as number) || defaults.height,
      fps: defaults.fps,
      duration,
      audioDuration: duration
    };

    if (isNonEmptyString(args.reference_image_url)) {
      projectParams.referenceImage = await fetchInputMedia(args.reference_image_url);
    }
    if (args.audio_start !== undefined) projectParams.audioStart = args.audio_start;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'video',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeVideoToVideo(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    if (!isNonEmptyString(args.reference_video_url)) {
      throw new Error('sogni_video_to_video requires reference_video_url');
    }

    const controlMode = normalizeVideoControlMode(args.control_mode);
    const isAnimateMode = controlMode === 'animate-move' || controlMode === 'animate-replace';
    const workflows: VideoWorkflow[] = isAnimateMode ? [controlMode] : ['v2v'];
    const preferredModelIds = isAnimateMode
      ? [
        controlMode === 'animate-move'
          ? 'wan_v2.2-14b-fp8_animate-move_lightx2v'
          : 'wan_v2.2-14b-fp8_animate-replace_lightx2v'
      ]
      : ['ltx23-22b-fp8_v2v_distilled'];
    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: args.model as string | undefined,
      workflows,
      preferredModelIds
    });
    const defaults = getVideoDefaults(modelId);

    if (isAnimateMode && !isNonEmptyString(args.reference_image_url)) {
      throw new Error(`${controlMode} requires reference_image_url`);
    }

    const projectParams: Record<string, unknown> = {
      type: 'video' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options),
      referenceVideo: await fetchInputMedia(args.reference_video_url),
      width: (args.width as number) || defaults.width,
      height: (args.height as number) || defaults.height,
      fps: defaults.fps,
      duration: asNumber(args.duration) ?? 5
    };

    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (isNonEmptyString(args.reference_image_url)) {
      projectParams.referenceImage = await fetchInputMedia(args.reference_image_url);
    }
    if (isNonEmptyString(args.reference_audio_identity_url)) {
      projectParams.referenceAudioIdentity = await fetchInputMedia(args.reference_audio_identity_url);
    }
    if (args.audio_identity_strength !== undefined) {
      projectParams.audioIdentityStrength = args.audio_identity_strength;
    }
    if (args.video_start !== undefined) {
      projectParams.videoStart = args.video_start;
    }
    if (!isAnimateMode) {
      projectParams.controlNet = {
        name: controlMode,
        strength: controlMode === 'detailer' ? 1 : 0.85
      };
    }
    if (args.detailer_strength !== undefined) {
      projectParams.detailerStrength = args.detailer_strength;
    }
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'video',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private async executeMusicGeneration(
    toolCall: ToolCall,
    args: Record<string, unknown>,
    options?: ToolExecutionOptions
  ): Promise<ToolExecutionResult> {
    const modelId = await this.selectModel({
      mediaType: 'audio',
      requestedModel: args.model as string | undefined,
      preferredModelIds: ['ace_step_1.5_turbo', 'ace_step_1.5_sft']
    });

    const projectParams: Record<string, unknown> = {
      type: 'audio' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options)
    };

    if (args.duration !== undefined) projectParams.duration = args.duration;
    if (args.bpm !== undefined) projectParams.bpm = args.bpm;
    if (args.keyscale) projectParams.keyscale = args.keyscale;
    if (args.lyrics) projectParams.lyrics = args.lyrics;
    if (args.language) projectParams.language = args.language;
    if (args.output_format) projectParams.outputFormat = args.output_format;

    const timeSignature = normalizeTimeSignature(args.timesignature);
    if (timeSignature) projectParams.timesignature = timeSignature;

    const composerMode = asBoolean(args.composer_mode);
    if (composerMode !== undefined) projectParams.composerMode = composerMode;

    const promptStrength = asNumber(args.prompt_strength);
    if (promptStrength !== undefined) projectParams.promptStrength = promptStrength;

    const creativity = asNumber(args.creativity);
    if (creativity !== undefined) projectParams.creativity = creativity;

    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (options?.tokenType) projectParams.tokenType = options.tokenType;
    if (options?.network) projectParams.network = options.network;

    return this.executeProject(
      toolCall,
      'audio',
      modelId,
      projectParams,
      args.prompt as string,
      options
    );
  }

  private makeErrorResult(toolCall: ToolCall, error: string): ToolExecutionResult {
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.function.name,
      success: false,
      resultUrls: [],
      content: JSON.stringify({ success: false, error }),
      error
    };
  }
}

export default ChatToolsApi;
