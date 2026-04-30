import {
  AudioProjectParams,
  ImageProjectParams,
  isAudioParams,
  isImageParams,
  isVideoParams,
  ProjectParams,
  VideoProjectParams
} from './types';
import {
  ControlNetParams,
  ControlNetParamsRaw,
  VideoControlNetParams,
  VideoControlNetParamsRaw
} from './types/ControlNetParams';
import {
  validateNumber,
  validateCustomImageSize,
  validateVideoSize,
  validateTeacacheThreshold,
  isComfyModel,
  validateVideoDuration,
  validateSampler,
  validateScheduler
} from '../lib/validation';
import {
  getVideoWorkflowType,
  isVideoModel,
  VIDEO_WORKFLOW_ASSETS,
  calculateVideoFrames,
  isLtx2Model,
  isWanAnimateModel,
  isSeedanceModel
} from './utils';
import { ApiError } from '../ApiClient';
import {
  AudioModelOptions,
  ImageModelOptions,
  ModelOptions,
  VideoModelOptions
} from './types/ModelOptions';

/**
 * Validate that the provided assets match the workflow requirements.
 * Throws an error if required assets are missing or forbidden assets are provided.
 */
function validateVideoWorkflowAssets(params: VideoProjectParams): void {
  if (isSeedanceModel(params.modelId)) {
    validateSeedanceReferenceAssets(params);
    return;
  }
  if (params.referenceImageUrls || params.referenceVideoUrls || params.referenceAudioUrls) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message:
        'referenceImageUrls, referenceVideoUrls, and referenceAudioUrls are supported only by Seedance models.'
    });
  }

  const workflowType = getVideoWorkflowType(params.modelId);
  if (!workflowType) return;

  const requirements = VIDEO_WORKFLOW_ASSETS[workflowType];
  if (!requirements) return;

  // Special case for i2v: at least ONE of referenceImage or referenceImageEnd required
  if (workflowType === 'i2v') {
    if (!params.referenceImage && !params.referenceImageEnd) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message:
          'i2v workflow requires at least one of referenceImage or referenceImageEnd. Please provide this asset.'
      });
    }
  }

  // sam2Coordinates is only valid for animate-replace workflows
  if (params.sam2Coordinates && workflowType !== 'animate-replace') {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'sam2Coordinates is only supported for animate-replace workflows.'
    });
  }

  // Check for missing required assets and forbidden assets
  for (const [asset, requirement] of Object.entries(requirements)) {
    const assetKey = asset as keyof VideoProjectParams;
    const hasAsset = !!params[assetKey];

    if (requirement === 'required' && !hasAsset) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${workflowType} workflow requires ${assetKey}. Please provide this asset.`
      });
    }

    if (requirement === 'forbidden' && hasAsset) {
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: `${workflowType} workflow does not support ${assetKey}. Please remove this asset.`
      });
    }
  }
}

function asReferenceUrlArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
}

function validateReferenceUrlArray(value: unknown, propertyName: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${propertyName} must be an array of URL strings.`
    });
  }
  if (value.some((url) => typeof url !== 'string' || url.trim().length === 0)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: `${propertyName} must contain only non-empty URL strings.`
    });
  }
}

function validateSeedanceReferenceAssets(params: VideoProjectParams): void {
  validateReferenceUrlArray(params.referenceImageUrls, 'referenceImageUrls');
  validateReferenceUrlArray(params.referenceVideoUrls, 'referenceVideoUrls');
  validateReferenceUrlArray(params.referenceAudioUrls, 'referenceAudioUrls');

  const imageCount =
    (params.referenceImage ? 1 : 0) +
    (params.referenceImageEnd ? 1 : 0) +
    asReferenceUrlArray(params.referenceImageUrls).length;
  const videoCount =
    (params.referenceVideo ? 1 : 0) + asReferenceUrlArray(params.referenceVideoUrls).length;
  const audioCount =
    (params.referenceAudio || params.referenceAudioIdentity ? 1 : 0) +
    asReferenceUrlArray(params.referenceAudioUrls).length;
  const totalAssetCount = imageCount + videoCount + audioCount;

  if (imageCount > 9) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance supports at most 9 image assets.'
    });
  }
  if (videoCount > 3) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance supports at most 3 video assets.'
    });
  }
  if (audioCount > 3) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance supports at most 3 audio assets.'
    });
  }
  if (totalAssetCount > 12) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance supports at most 12 total asset files.'
    });
  }
  if (audioCount > 0 && imageCount === 0 && videoCount === 0) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Seedance audio references require at least one image or video reference.'
    });
  }
}

function getMaxVideoDuration(modelId: string): number {
  if (isSeedanceModel(modelId)) {
    return 15;
  }
  if (isLtx2Model(modelId) || isWanAnimateModel(modelId)) {
    return 20;
  }
  return 10;
}

// Mac worker can't process the data if some of the fields are missing, so we need to provide a default template
function getTemplate() {
  return {
    selectedUpscalingModel: 'OFF',
    cnVideoFramesSketch: [],
    cnVideoFramesSegmentedSubject: [],
    cnVideoFramesFace: [],
    doCanvasBlending: false,
    animationIsOn: false,
    cnVideoFramesBoth: [],
    cnVideoFramesDepth: [],
    keyFrames: [
      {
        stepsIsEnabled: true,
        siRotation: 0,
        siDragOffsetIsEnabled: true,
        strength: 0.5,
        siZoomScaleIsEnabled: true,
        isEnabled: true,
        processing: 'CPU, GPU',
        useLastImageAsGuideImageInAnimation: true,
        guidanceScaleIsEnabled: true,
        siImageBackgroundColor: 'black',
        cnDragOffset: [0, 0],
        scheduler: null,
        timeStepSpacing: null,
        steps: 20,
        cnRotation: 0,
        guidanceScale: 7.5,
        siZoomScale: 1,
        modelID: '',
        cnRotationIsEnabled: true,
        negativePrompt: '',
        startingImageZoomPanIsOn: false,
        seed: undefined,
        siRotationIsEnabled: true,
        cnImageBackgroundColor: 'clear',
        strengthIsEnabled: true,
        siDragOffset: [0, 0],
        useLastImageAsCNImageInAnimation: false,
        positivePrompt: '',
        controlNetZoomPanIsOn: false,
        cnZoomScaleIsEnabled: true,
        currentControlNets: null,
        stylePrompt: '',
        cnDragOffsetIsEnabled: true,
        frameIndex: 0,
        startingImage: null,
        cnZoomScale: 1
      }
    ],
    previews: 5,
    frameRate: 24,
    generatedVideoSeconds: 10,
    canvasIsOn: false,
    cnVideoFrames: [],
    disableSafety: false,
    cnVideoFramesSegmentedBackground: [],
    cnVideoFramesSegmented: [],
    numberOfImages: 1,
    cnVideoFramesPose: [],
    jobID: '',
    siVideoFrames: []
  };
}

function getControlNet(params: ControlNetParams): ControlNetParamsRaw[] {
  const cn: ControlNetParamsRaw = {
    name: params.name,
    cnImageState: 'original',
    hasImage: !!params.image
  };
  if (params.strength !== undefined) {
    cn.controlStrength = validateNumber(params.strength, {
      min: 0,
      max: 1,
      propertyName: 'strength'
    });
  }
  if (params.mode) {
    switch (params.mode) {
      case 'balanced':
        cn.controlMode = 0;
        break;
      case 'prompt_priority':
        cn.controlMode = 1;
        break;
      case 'cn_priority':
        cn.controlMode = 2;
        break;
      default:
        throw new Error(`Invalid control mode ${params.mode}`);
    }
  }
  if (params.guidanceStart !== undefined) {
    cn.controlGuidanceStart = validateNumber(params.guidanceStart, {
      min: 0,
      max: 1,
      propertyName: 'guidanceStart'
    });
  }
  if (params.guidanceEnd !== undefined) {
    cn.controlGuidanceEnd = validateNumber(params.guidanceEnd, {
      min: 0,
      max: 1,
      propertyName: 'guidanceEnd'
    });
  }
  return [cn];
}

function getVideoControlNet(params: VideoControlNetParams): VideoControlNetParamsRaw[] {
  const cn: VideoControlNetParamsRaw = {
    name: params.name
  };
  if (params.strength !== undefined) {
    cn.controlStrength = validateNumber(params.strength, {
      min: 0,
      max: 1,
      propertyName: 'strength'
    });
  }
  return [cn];
}

function applyImageParams(
  inputKeyframe: Record<string, any>,
  params: ImageProjectParams,
  options: ImageModelOptions
) {
  const keyFrame: Record<string, any> = {
    ...inputKeyframe,
    sizePreset: params.sizePreset,
    hasContextImage1: !!params.contextImages?.[0],
    hasContextImage2: !!params.contextImages?.[1],
    hasContextImage3: !!params.contextImages?.[2],
    hasContextImage4: !!params.contextImages?.[3],
    hasContextImage5: !!params.contextImages?.[4],
    hasContextImage6: !!params.contextImages?.[5]
  };
  // Sampler/scheduler handling: SDK validates and passes through as-is.
  // sogni-socket normalizes values for both ComfyUI and Forge workers.
  if (isComfyModel(params.modelId)) {
    // ComfyUI models use comfySampler/comfyScheduler fields
    keyFrame.comfySampler = validateSampler(params.sampler, options);
    keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);
  } else {
    // Legacy Forge models use scheduler/timeStepSpacing fields
    keyFrame.scheduler = validateSampler(params.sampler, options);
    keyFrame.timeStepSpacing = validateScheduler(params.scheduler, options);
  }

  if (params.startingImage) {
    keyFrame.hasStartingImage = true;
    keyFrame.strengthIsEnabled = true;
    keyFrame.strength = 1 - (Number(params.startingImageStrength) || 0.5);
  }

  if (params.controlNet) {
    keyFrame.currentControlNetsJob = getControlNet(params.controlNet);
  }

  // Set sizePreset to 'custom' if width/height are provided but sizePreset is not set
  let effectiveSizePreset = params.sizePreset;
  if (params.width && params.height && !params.sizePreset) {
    effectiveSizePreset = 'custom';
  }
  keyFrame.sizePreset = effectiveSizePreset;

  if (effectiveSizePreset === 'custom' && params.width && params.height) {
    keyFrame.width = validateCustomImageSize(params.width);
    keyFrame.height = validateCustomImageSize(params.height);
  }
  return keyFrame;
}

function applyVideoParams(
  inputKeyframe: Record<string, any>,
  params: VideoProjectParams,
  options: VideoModelOptions
) {
  if (!isVideoModel(params.modelId)) {
    throw new ApiError(400, {
      status: 'error',
      errorCode: 0,
      message: 'Video generation is only supported for video models.'
    });
  }
  validateVideoWorkflowAssets(params);
  const keyFrame: Record<string, any> = { ...inputKeyframe };
  if (params.referenceImage) {
    keyFrame.hasReferenceImage = true;
  }
  const referenceImageUrls = asReferenceUrlArray(params.referenceImageUrls);
  if (referenceImageUrls.length) {
    keyFrame.referenceImageURLs = referenceImageUrls;
  }
  if (params.referenceImageEnd) {
    keyFrame.hasReferenceImageEnd = true;
  }
  if (params.referenceAudio) {
    keyFrame.hasReferenceAudio = true;
  }
  const referenceAudioUrls = asReferenceUrlArray(params.referenceAudioUrls);
  if (referenceAudioUrls.length) {
    keyFrame.referenceAudioURLs = referenceAudioUrls;
  }
  if (params.referenceVideo) {
    keyFrame.hasReferenceVideo = true;
  }
  const referenceVideoUrls = asReferenceUrlArray(params.referenceVideoUrls);
  if (referenceVideoUrls.length) {
    keyFrame.referenceVideoURLs = referenceVideoUrls;
  }
  if (params.referenceAudioIdentity) {
    keyFrame.hasReferenceAudioIdentity = true;
  }
  if (params.generateAudio !== undefined) {
    keyFrame.generateAudio = params.generateAudio;
  }
  if (params.audioIdentityStrength !== undefined) {
    keyFrame.identityGuidanceScale = params.audioIdentityStrength;
  }

  // Video generation parameters
  // Note: fps must be processed before duration to correctly calculate frames for LTX-2.3 models
  if (params.fps !== undefined) {
    keyFrame.fps = params.fps;
  } else if (isSeedanceModel(params.modelId)) {
    keyFrame.fps = 24;
  }
  if (params.frames !== undefined) {
    keyFrame.frames = params.frames;
  }
  if (params.duration !== undefined) {
    const isSeedance = isSeedanceModel(params.modelId);
    const duration = validateVideoDuration(
      params.duration,
      isSeedance ? 4 : 1,
      getMaxVideoDuration(params.modelId)
    );
    // Use fps from params or default based on model type:
    // - WAN 2.2: fps doesn't affect frame count (always generates at 16fps)
    // - LTX-2.3: fps directly affects frame count (default 24fps if not specified)
    // - Seedance: fixed 24fps external API generation
    const fps = params.fps ?? 24;
    keyFrame.frames = calculateVideoFrames(params.modelId, duration, fps);
  }
  if (params.shift !== undefined) {
    keyFrame.shift = params.shift;
  }
  if (params.teacacheThreshold !== undefined) {
    const validatedThreshold = validateTeacacheThreshold(params.teacacheThreshold);
    if (validatedThreshold !== undefined) {
      keyFrame.teacacheThreshold = validatedThreshold;
    }
  }

  // S2V audio parameters
  if (params.audioStart !== undefined) {
    keyFrame.audioStart = params.audioStart;
  }
  if (params.audioDuration !== undefined) {
    keyFrame.audioDuration = params.audioDuration;
  }

  // Animate video parameters (for animate-move, animate-replace)
  if (params.videoStart !== undefined) {
    keyFrame.videoStart = params.videoStart;
  }

  // SAM2 subject detection coordinates for animate-replace workflows
  if (params.sam2Coordinates !== undefined) {
    keyFrame.sam2Coordinates = JSON.stringify(params.sam2Coordinates);
  }

  // Frame trimming for seamless stitching of transition videos
  if (params.trimEndFrame) {
    keyFrame.trimEndFrame = true;
  }

  // First/last frame strengths for LTX-2.3 keyframe interpolation (when referenceImageEnd is provided)
  if (params.firstFrameStrength !== undefined) {
    keyFrame.firstFrameStrength = params.firstFrameStrength;
  }
  if (params.lastFrameStrength !== undefined) {
    keyFrame.lastFrameStrength = params.lastFrameStrength;
  }

  // ControlNet parameters for LTX-2.3 v2v workflows
  if (params.controlNet) {
    keyFrame.currentControlNetsJob = getVideoControlNet(params.controlNet);
  }

  // Detailer LoRA strength for LTX-2.3 v2v IC-Control workflows
  if (params.detailerStrength !== undefined) {
    keyFrame.detailerStrength = params.detailerStrength;
  }

  // Validate and set video dimensions (minimum 480px for Wan 2.2 models)
  if (params.width && params.height) {
    keyFrame.width = validateVideoSize(params.width, 'width');
    keyFrame.height = validateVideoSize(params.height, 'height');
  }

  keyFrame.comfySampler = validateSampler(params.sampler, options);
  keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);

  return keyFrame;
}

function applyAudioParams(
  inputKeyframe: Record<string, any>,
  params: AudioProjectParams,
  options: AudioModelOptions
) {
  const keyFrame: Record<string, any> = { ...inputKeyframe };

  if (params.duration !== undefined) {
    keyFrame.duration = params.duration;
  }
  if (params.bpm !== undefined) {
    keyFrame.bpm = params.bpm;
  }
  if (params.timesignature !== undefined) {
    keyFrame.timesignature = params.timesignature;
  }
  if (params.language !== undefined) {
    keyFrame.language = params.language;
  }
  if (params.lyrics !== undefined) {
    keyFrame.lyrics = params.lyrics;
  }
  if (params.keyscale !== undefined) {
    keyFrame.keyscale = params.keyscale;
  }
  if (params.composerMode !== undefined) {
    keyFrame.composerMode = params.composerMode;
  }
  if (params.promptStrength !== undefined) {
    keyFrame.promptStrength = params.promptStrength;
  }
  if (params.creativity !== undefined) {
    keyFrame.creativity = params.creativity;
  }
  if (params.shift !== undefined) {
    keyFrame.shift = params.shift;
  }

  keyFrame.comfySampler = validateSampler(params.sampler, options);
  keyFrame.comfyScheduler = validateScheduler(params.scheduler, options);

  return keyFrame;
}

function createJobRequestMessage(id: string, params: ProjectParams, options: ModelOptions) {
  const template = getTemplate();
  const negativePrompt =
    isImageParams(params) || (isVideoParams(params) && !isSeedanceModel(params.modelId))
      ? params.negativePrompt
      : undefined;
  // Base keyFrame with common params
  let keyFrame: Record<string, any> = {
    ...template.keyFrames[0],
    steps: params.steps,
    guidanceScale: params.guidance,
    modelID: params.modelId,
    seed: params.seed,
    positivePrompt: params.positivePrompt,
    // Only include optional prompts if they have actual non-empty values
    // This allows the server to use its defaults when not specified
    ...(negativePrompt && { negativePrompt }),
    ...(params.stylePrompt && { stylePrompt: params.stylePrompt }),
    // LoRA IDs for LoRA loading (resolved to filenames by worker via config API)
    ...(params.loras && params.loras.length > 0 && { loras: params.loras }),
    ...(params.loraStrengths &&
      params.loraStrengths.length > 0 && { loraStrengths: params.loraStrengths })
  };
  if (isAudioParams(params) || (isVideoParams(params) && isSeedanceModel(params.modelId))) {
    delete keyFrame.negativePrompt;
  }

  switch (params.type) {
    case 'image':
      if (options.type !== 'image') {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message:
            'Invalid model type. Model does not support image generation. Please use a different model.'
        });
      }
      keyFrame = applyImageParams(keyFrame, params, options);
      break;
    case 'video':
      if (options.type !== 'video') {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message:
            'Invalid model type. Model does not support video generation. Please use a different model.'
        });
      }
      keyFrame = applyVideoParams(keyFrame, params, options);
      break;
    case 'audio':
      if (options.type !== 'audio') {
        throw new ApiError(400, {
          status: 'error',
          errorCode: 0,
          message:
            'Invalid model type. Model does not support audio generation. Please use a different model.'
        });
      }
      keyFrame = applyAudioParams(keyFrame, params, options);
      break;
    default:
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: 'Invalid project type. Must be "image", "video", or "audio".'
      });
  }

  const jobRequest: Record<string, any> = {
    ...template,
    keyFrames: [keyFrame],
    previews: isImageParams(params) ? params.numberOfPreviews || 0 : 0,
    numberOfImages: params.numberOfMedia || 1,
    jobID: id,
    disableSafety: !!params.disableNSFWFilter,
    tokenType: params.tokenType,
    outputFormat:
      params.outputFormat || (isAudioParams(params) ? 'mp3' : isVideoParams(params) ? 'mp4' : 'png')
  };

  if (params.network) {
    jobRequest.network = params.network;
  }
  if (params.appSource) {
    jobRequest.appSource = params.appSource;
  }

  return jobRequest;
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;
