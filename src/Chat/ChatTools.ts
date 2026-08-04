import type ProjectsApi from '../Projects/index.js';
import type { AvailableModel } from '../Projects/types/index.js';
import { getMaxContextImages } from '../lib/validation.js';
import { mediaInputToInlineDataUri, parseInlineMediaDataUri } from '../lib/mediaValidation.js';
import type { MediaType } from '../lib/mediaValidation.js';
import {
  assertHostedToolArguments,
  asBooleanValue,
  asFiniteNumber,
  asStringArray,
  calculateVideoFrames,
  getHostedVariationCount,
  getVideoDefaults,
  getVideoWorkflowType,
  isEditImageModel,
  isExternalApiVideoModel,
  isMinimaxH3Model,
  isNonEmptyString,
  normalizeTimeSignature,
  normalizeVideoControlMode,
  PREFERRED_MODEL_IDS,
  resolveHostedToolModelSelector,
  selectBackboneModel,
  serializeUnknownError,
  VideoWorkflow
} from './modelRouting.js';
import { SogniTools, isSogniToolCall, parseToolCallArguments } from './tools.js';
import {
  ToolCall,
  ToolExecutionOptions,
  ToolExecutionProgress,
  ToolExecutionResult
} from './types.js';

const DEFAULT_TIMEOUT = 30 * 60 * 1000;
const MAX_SOGNI_TOOL_CALLS_PER_ROUND = 8;

const DIRECT_PROJECT_DISPATCH_TOOL_NAMES: ReadonlySet<string> = new Set([
  'generate_image',
  'edit_image',
  'generate_video',
  'sound_to_video',
  'video_to_video',
  'generate_music'
]);

function hasDirectProjectDispatch(toolCall: ToolCall): boolean {
  return DIRECT_PROJECT_DISPATCH_TOOL_NAMES.has(toolCall.function.name);
}

const MAX_INPUT_MEDIA_BYTES: Record<MediaType, number> = {
  image: 20 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  video: 100 * 1024 * 1024
};

function getVariationCount(args: Record<string, unknown>, options?: ToolExecutionOptions): number {
  return getHostedVariationCount(args, options?.numberOfMedia);
}

function asIntegerArray(value: unknown, argumentName: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry))) {
    throw new Error(`${argumentName} must contain only integer media indices`);
  }
  return value as number[];
}

function resolveMediaIndices(
  indices: number[],
  mediaType: MediaType,
  options?: ToolExecutionOptions
): string[] {
  if (indices.length === 0) return [];

  const context = options?.mediaContext;
  if (!context) {
    throw new Error(
      `Indexed ${mediaType} arguments require ToolExecutionOptions.mediaContext when using chat.tools.execute()`
    );
  }

  const generated =
    mediaType === 'image' ? context.images : mediaType === 'video' ? context.videos : context.audio;
  const uploaded =
    mediaType === 'image'
      ? context.uploadedImages
      : mediaType === 'video'
        ? context.uploadedVideos
        : context.uploadedAudio;

  return indices.map((index) => {
    const source = index >= 0 ? generated : uploaded;
    const sourceIndex = index >= 0 ? index : Math.abs(index) - 1;
    const resolved = source?.[sourceIndex];
    if (!isNonEmptyString(resolved)) {
      throw new Error(
        `${mediaType} media index ${index} is unavailable in ToolExecutionOptions.mediaContext`
      );
    }
    return resolved;
  });
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function mediaInputToBlob(input: string, mediaType: MediaType): Promise<Blob> {
  const dataUri = await mediaInputToInlineDataUri(input, mediaType, {
    maxBytes: MAX_INPUT_MEDIA_BYTES[mediaType]
  });
  return parseInlineMediaDataUri(dataUri, mediaType, {
    maxBytes: MAX_INPUT_MEDIA_BYTES[mediaType]
  }).blob;
}

function getStringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeImageOutputFormat(value: unknown): string | undefined {
  const outputFormat = getStringArg(value)?.toLowerCase();
  if (!outputFormat) return undefined;
  if (outputFormat === 'jpeg') return 'jpg';
  return outputFormat === 'png' || outputFormat === 'jpg' || outputFormat === 'webp'
    ? outputFormat
    : undefined;
}

function applyHostedImageOptions(
  projectParams: Record<string, unknown>,
  args: Record<string, unknown>
) {
  const gptImageQuality = getStringArg(args.gpt_image_quality ?? args.gptImageQuality);
  if (gptImageQuality) projectParams.gptImageQuality = gptImageQuality.toLowerCase();

  const outputFormat = normalizeImageOutputFormat(args.output_format ?? args.outputFormat);
  if (outputFormat) projectParams.outputFormat = outputFormat;
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

    if (!hasDirectProjectDispatch(toolCall)) {
      return this.makeErrorResult(
        toolCall,
        `Tool '${name}' must be executed via chat.hosted.create() or chat.runs.create().`
      );
    }

    try {
      assertHostedToolArguments(SogniTools.all, name, args);

      switch (name) {
        case 'generate_image':
          return await this.executeImageGeneration(toolCall, args, options);
        case 'edit_image':
          return await this.executeImageEdit(toolCall, args, options);
        case 'generate_video':
          return await this.executeVideoGeneration(toolCall, args, options);
        case 'sound_to_video':
          return await this.executeSoundToVideo(toolCall, args, options);
        case 'video_to_video':
          return await this.executeVideoToVideo(toolCall, args, options);
        case 'generate_music':
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
    const sogniToolCallCount = toolCalls.filter(hasDirectProjectDispatch).length;
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
          attribution: options?.attribution,
          mediaContext: options?.mediaContext,
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

    const project = await this.projects.create({
      ...projectParams,
      ...(options?.attribution ? { attribution: options.attribution } : {})
    } as any);
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
      requestedModel: resolveHostedToolModelSelector('generate_image', args)
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
    applyHostedImageOptions(projectParams, args);
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
      throw new Error('edit_image requires source_image_url or reference_image_urls');
    }

    const modelId = await this.selectModel({
      mediaType: 'image',
      requestedModel: resolveHostedToolModelSelector('edit_image', args),
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
    applyHostedImageOptions(projectParams, args);
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
    const referenceImageIndices = asIntegerArray(
      args.referenceImageIndices,
      'referenceImageIndices'
    );
    const referenceVideoIndices = asIntegerArray(
      args.referenceVideoIndices,
      'referenceVideoIndices'
    );
    const referenceAudioIndices = asIntegerArray(
      args.referenceAudioIndices,
      'referenceAudioIndices'
    );
    const indexedReferenceImages = resolveMediaIndices(referenceImageIndices, 'image', options);
    const indexedReferenceVideos = resolveMediaIndices(referenceVideoIndices, 'video', options);
    const indexedReferenceAudio = resolveMediaIndices(referenceAudioIndices, 'audio', options);
    const legacyReferenceImage = isNonEmptyString(args.reference_image_url)
      ? args.reference_image_url
      : undefined;
    const legacyReferenceImageEnd = isNonEmptyString(args.reference_image_end_url)
      ? args.reference_image_end_url
      : undefined;
    if (indexedReferenceImages.length > 0 && (legacyReferenceImage || legacyReferenceImageEnd)) {
      throw new Error(
        'Use either referenceImageIndices with mediaContext or legacy inline reference_image_url arguments, not both'
      );
    }

    const hasReferenceImages =
      indexedReferenceImages.length > 0 || !!legacyReferenceImage || !!legacyReferenceImageEnd;
    if (
      hasReferenceImages &&
      typeof args.videoModel === 'string' &&
      args.videoModel.trim().toLowerCase() === 'minimax-h3-t2v'
    ) {
      throw new Error(
        'minimax-h3-t2v does not accept reference images; use the MiniMax H3 i2v or flf2v project workflow'
      );
    }
    const routingArgs =
      hasReferenceImages && referenceImageIndices.length === 0
        ? { ...args, referenceImageIndices: [0] }
        : args;
    // MiniMax H3 r2v is schema-valid but has no direct-execution route yet: no
    // selector maps the alias, so it used to fall through model selection as a
    // soft preference and silently render on LTX i2v — the user paid for the
    // wrong model. Until reference-index mapping to the H3 upload slots is
    // implemented here, fail loudly like the hosted-only tools do.
    if ((args.videoModel as string | undefined) === 'minimax-h3-r2v') {
      return this.makeErrorResult(
        toolCall,
        "generate_video with videoModel 'minimax-h3-r2v' is not supported by direct SDK tool execution. " +
          'Execute it via chat.hosted.create() / chat.runs.create(), or submit the render directly with ' +
          "projects.create({ type: 'video', modelId: 'minimax-h3-ref2va-fp8_r2v', referenceImage, contextImages, ... })."
      );
    }
    const requestedModel = resolveHostedToolModelSelector('generate_video', routingArgs);
    const requestedWorkflow = requestedModel ? getVideoWorkflowType(requestedModel) : null;
    const workflowPreference: VideoWorkflow[] =
      requestedWorkflow === 'flf2v' || requestedWorkflow === 'r2v'
        ? [requestedWorkflow]
        : hasReferenceImages
          ? ['i2v']
          : ['t2v'];
    const preferredModelIds =
      requestedWorkflow === 'flf2v'
        ? [PREFERRED_MODEL_IDS.video.minimaxH3Flf2v]
        : requestedWorkflow === 'r2v'
          ? [PREFERRED_MODEL_IDS.video.happyhorseR2v]
          : hasReferenceImages
            ? [PREFERRED_MODEL_IDS.video.i2v]
            : [PREFERRED_MODEL_IDS.video.t2v];

    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel,
      workflows: workflowPreference,
      preferredModelIds
    });
    const defaults = getVideoDefaults(modelId);
    const isExternalApiModel = isExternalApiVideoModel(modelId);

    const projectParams: Record<string, unknown> = {
      type: 'video' as const,
      modelId,
      positivePrompt: args.prompt as string,
      numberOfMedia: getVariationCount(args, options),
      width: (args.width as number) || defaults.width,
      height: (args.height as number) || defaults.height,
      fps: (args.fps as number) || defaults.fps
    };

    if (args.negativePrompt && isMinimaxH3Model(modelId)) {
      throw new Error('MiniMax H3 has no negative-prompt input; put exclusions in prompt');
    }
    if (args.negativePrompt && !isExternalApiModel) {
      projectParams.negativePrompt = args.negativePrompt;
    }
    const requestedDuration = asFiniteNumber(args.duration);
    if (requestedDuration !== undefined) {
      if (isMinimaxH3Model(modelId)) {
        projectParams.frames = calculateVideoFrames(modelId, requestedDuration, 24);
      } else {
        projectParams.duration = requestedDuration;
      }
    }
    if (args.seed !== undefined) projectParams.seed = args.seed;
    if (legacyReferenceImage) {
      projectParams.referenceImage = parseInlineMediaDataUri(legacyReferenceImage, 'image', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.image
      }).blob;
    }
    if (legacyReferenceImageEnd) {
      projectParams.referenceImageEnd = parseInlineMediaDataUri(legacyReferenceImageEnd, 'image', {
        maxBytes: MAX_INPUT_MEDIA_BYTES.image
      }).blob;
    }
    if (indexedReferenceImages.length > 0) {
      if (isExternalApiModel) {
        const remoteUrls = indexedReferenceImages.filter(isHttpsUrl);
        const localInputs = indexedReferenceImages.filter((input) => !isHttpsUrl(input));
        if (localInputs.length > 1) {
          throw new Error(
            'Direct external-API video execution supports at most one inline image; use HTTPS references for additional images'
          );
        }
        if (localInputs[0]) {
          projectParams.referenceImage = await mediaInputToBlob(localInputs[0], 'image');
        }
        if (remoteUrls.length > 0) projectParams.referenceImageUrls = remoteUrls;
      } else {
        const maxImages = requestedWorkflow === 'flf2v' ? 2 : 1;
        if (indexedReferenceImages.length > maxImages) {
          throw new Error(
            `${requestedWorkflow ?? 'video'} accepts at most ${maxImages} image input(s)`
          );
        }
        projectParams.referenceImage = await mediaInputToBlob(indexedReferenceImages[0], 'image');
        if (indexedReferenceImages[1]) {
          projectParams.referenceImageEnd = await mediaInputToBlob(
            indexedReferenceImages[1],
            'image'
          );
        }
      }
    }
    if (indexedReferenceVideos.length > 0 || indexedReferenceAudio.length > 0) {
      if (!isExternalApiModel) {
        throw new Error(
          'Loose referenceVideoIndices/referenceAudioIndices require an external video model'
        );
      }
      const applyExternalReferences = async (
        inputs: string[],
        mediaType: 'video' | 'audio',
        localKey: 'referenceVideo' | 'referenceAudio',
        urlsKey: 'referenceVideoUrls' | 'referenceAudioUrls'
      ) => {
        const remoteUrls = inputs.filter(isHttpsUrl);
        const localInputs = inputs.filter((input) => !isHttpsUrl(input));
        if (localInputs.length > 1) {
          throw new Error(
            `Direct external-API video execution supports at most one inline ${mediaType}; use HTTPS references for additional ${mediaType} inputs`
          );
        }
        if (localInputs[0])
          projectParams[localKey] = await mediaInputToBlob(localInputs[0], mediaType);
        if (remoteUrls.length > 0) projectParams[urlsKey] = remoteUrls;
      };
      await applyExternalReferences(
        indexedReferenceVideos,
        'video',
        'referenceVideo',
        'referenceVideoUrls'
      );
      await applyExternalReferences(
        indexedReferenceAudio,
        'audio',
        'referenceAudio',
        'referenceAudioUrls'
      );
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
    const generateAudio = asBooleanValue(args.generateAudio);
    if (generateAudio !== undefined) {
      projectParams.generateAudio = generateAudio;
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
      throw new Error('sound_to_video requires reference_audio_url');
    }

    const hasReferenceImage = isNonEmptyString(args.reference_image_url);
    const workflows: VideoWorkflow[] = hasReferenceImage ? ['ia2v', 's2v'] : ['a2v'];
    const preferredModelIds = hasReferenceImage
      ? [PREFERRED_MODEL_IDS.video.ia2v, PREFERRED_MODEL_IDS.video.s2v]
      : [PREFERRED_MODEL_IDS.video.a2v];
    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: resolveHostedToolModelSelector('sound_to_video', args),
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
    const generateAudio = asBooleanValue(args.generateAudio);
    if (generateAudio !== undefined) {
      projectParams.generateAudio = generateAudio;
    }
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
      throw new Error('video_to_video requires reference_video_url');
    }

    const controlMode = normalizeVideoControlMode(args.control_mode);
    const isAnimateMode = controlMode === 'animate-move' || controlMode === 'animate-replace';
    const isSeedanceMode = controlMode === 'seedance-v2v';
    const workflows: VideoWorkflow[] = isAnimateMode ? [controlMode] : ['v2v'];
    const preferredModelIds = isAnimateMode
      ? [
          controlMode === 'animate-move'
            ? PREFERRED_MODEL_IDS.video.animateMove
            : PREFERRED_MODEL_IDS.video.animateReplace
        ]
      : isSeedanceMode
        ? [PREFERRED_MODEL_IDS.video.seedanceV2v, PREFERRED_MODEL_IDS.video.v2v]
        : [PREFERRED_MODEL_IDS.video.v2v];
    const modelId = await this.selectModel({
      mediaType: 'video',
      requestedModel: resolveHostedToolModelSelector('video_to_video', args),
      workflows,
      preferredModelIds
    });
    const defaults = getVideoDefaults(modelId);
    const isExternalApiModel = isExternalApiVideoModel(modelId);

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

    if (args.negativePrompt && !isExternalApiModel) {
      projectParams.negativePrompt = args.negativePrompt;
    }
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
    const generateAudio = asBooleanValue(args.generateAudio);
    if (generateAudio !== undefined) {
      projectParams.generateAudio = generateAudio;
    }
    if (!isAnimateMode && !isExternalApiModel) {
      projectParams.controlNet = {
        name: controlMode,
        strength: controlMode === 'detailer' ? 1 : 0.85
      };
    }
    if (!isExternalApiModel && args.detailer_strength !== undefined) {
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
      requestedModel: resolveHostedToolModelSelector('generate_music', args),
      preferredModelIds: Object.values(PREFERRED_MODEL_IDS.audio)
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
