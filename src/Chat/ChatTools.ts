import type ProjectsApi from '../Projects';
import type { AvailableModel } from '../Projects/types';
import { getMaxContextImages } from '../lib/validation';
import { parseInlineMediaDataUri } from '../lib/mediaValidation';
import type { MediaType } from '../lib/mediaValidation';
import {
  assertHostedToolArguments,
  asBooleanValue,
  asFiniteNumber,
  asStringArray,
  getHostedVariationCount,
  getVideoDefaults,
  isEditImageModel,
  isNonEmptyString,
  normalizeTimeSignature,
  normalizeVideoControlMode,
  PREFERRED_MODEL_IDS,
  resolveHostedToolModelSelector,
  selectBackboneModel,
  serializeUnknownError,
  VideoWorkflow
} from './modelRouting';
import { SogniTools, isSogniToolCall, parseToolCallArguments } from './tools';
import {
  ToolCall,
  ToolExecutionOptions,
  ToolExecutionProgress,
  ToolExecutionResult
} from './types';

const DEFAULT_TIMEOUT = 10 * 60 * 1000;
const MAX_SOGNI_TOOL_CALLS_PER_ROUND = 8;

const MAX_INPUT_MEDIA_BYTES: Record<MediaType, number> = {
  image: 20 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024
};

function getVariationCount(args: Record<string, unknown>, options?: ToolExecutionOptions): number {
  return getHostedVariationCount(args, options?.numberOfMedia);
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
      assertHostedToolArguments(SogniTools.all, name, args);

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
      const error = serializeUnknownError(err);
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
    const sogniToolCallCount = toolCalls.filter((toolCall) => isSogniToolCall(toolCall)).length;
    if (sogniToolCallCount > MAX_SOGNI_TOOL_CALLS_PER_ROUND) {
      throw new Error(
        `Too many Sogni tool calls in a single round (${sogniToolCallCount}); maximum is ${MAX_SOGNI_TOOL_CALLS_PER_ROUND}`
      );
    }

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
          const error = serializeUnknownError(err);
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
    return selectBackboneModel(models, options).modelId;
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
      requestedModel: resolveHostedToolModelSelector('sogni_generate_image', args)
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
      requestedModel: resolveHostedToolModelSelector('sogni_edit_image', args),
      filter: isEditImageModel
    });
    const maxContextImages = getMaxContextImages(modelId);
    const contextImages = await Promise.all(
      inputUrls.slice(0, maxContextImages).map(
        (url) =>
          parseInlineMediaDataUri(url, 'image', {
            maxBytes: MAX_INPUT_MEDIA_BYTES.image
          }).blob
      )
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
    const hasReferenceImages =
      isNonEmptyString(args.reference_image_url) || isNonEmptyString(args.reference_image_end_url);
    const workflowPreference: VideoWorkflow[] = hasReferenceImages ? ['i2v'] : ['t2v'];
    const preferredModelIds = hasReferenceImages
      ? [PREFERRED_MODEL_IDS.video.i2v]
      : [PREFERRED_MODEL_IDS.video.t2v];

    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: resolveHostedToolModelSelector('sogni_generate_video', args),
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
      projectParams.referenceImage = parseInlineMediaDataUri(args.reference_image_url, 'image', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.image
      }).blob;
    }
    if (isNonEmptyString(args.reference_image_end_url)) {
      projectParams.referenceImageEnd = parseInlineMediaDataUri(
        args.reference_image_end_url,
        'image',
        {
          maxBytes: MAX_INPUT_MEDIA_BYTES.image
        }
      ).blob;
    }
    if (isNonEmptyString(args.reference_audio_identity_url)) {
      projectParams.referenceAudioIdentity = parseInlineMediaDataUri(
        args.reference_audio_identity_url,
        'audio',
        {
          maxBytes: MAX_INPUT_MEDIA_BYTES.audio
        }
      ).blob;
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
      ? [PREFERRED_MODEL_IDS.video.ia2v, PREFERRED_MODEL_IDS.video.s2v]
      : [PREFERRED_MODEL_IDS.video.a2v];
    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: resolveHostedToolModelSelector('sogni_sound_to_video', args),
      workflows,
      preferredModelIds
    });
    const defaults = getVideoDefaults(modelId);
    const duration = asFiniteNumber(args.duration) ?? 5;

    const projectParams: Record<string, unknown> = {
      type: 'video' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options),
      referenceAudio: parseInlineMediaDataUri(args.reference_audio_url, 'audio', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.audio
      }).blob,
      width: (args.width as number) || defaults.width,
      height: (args.height as number) || defaults.height,
      fps: defaults.fps,
      duration,
      audioDuration: duration
    };

    if (isNonEmptyString(args.reference_image_url)) {
      projectParams.referenceImage = parseInlineMediaDataUri(args.reference_image_url, 'image', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.image
      }).blob;
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
            ? PREFERRED_MODEL_IDS.video.animateMove
            : PREFERRED_MODEL_IDS.video.animateReplace
        ]
      : [PREFERRED_MODEL_IDS.video.v2v];
    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: resolveHostedToolModelSelector('sogni_video_to_video', args),
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
      referenceVideo: parseInlineMediaDataUri(args.reference_video_url, 'video', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.video
      }).blob,
      width: (args.width as number) || defaults.width,
      height: (args.height as number) || defaults.height,
      fps: defaults.fps,
      duration: asFiniteNumber(args.duration) ?? 5
    };

    if (args.negative_prompt) projectParams.negativePrompt = args.negative_prompt;
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (isNonEmptyString(args.reference_image_url)) {
      projectParams.referenceImage = parseInlineMediaDataUri(args.reference_image_url, 'image', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.image
      }).blob;
    }
    if (isNonEmptyString(args.reference_audio_identity_url)) {
      projectParams.referenceAudioIdentity = parseInlineMediaDataUri(
        args.reference_audio_identity_url,
        'audio',
        {
          maxBytes: MAX_INPUT_MEDIA_BYTES.audio
        }
      ).blob;
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
      requestedModel: resolveHostedToolModelSelector('sogni_generate_music', args),
      preferredModelIds: [
        PREFERRED_MODEL_IDS.audio.aceStepTurbo,
        PREFERRED_MODEL_IDS.audio.aceStepSft
      ]
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

    const composerMode = asBooleanValue(args.composer_mode);
    if (composerMode !== undefined) projectParams.composerMode = composerMode;

    const promptStrength = asFiniteNumber(args.prompt_strength);
    if (promptStrength !== undefined) projectParams.promptStrength = promptStrength;

    const creativity = asFiniteNumber(args.creativity);
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
