import {
  ImageProjectParams,
  isImageParams,
  isVideoParams,
  ProjectParams,
  VideoProjectParams
} from './types';
import { ControlNetParams, ControlNetParamsRaw } from './types/ControlNetParams';
import {
  validateNumber,
  validateCustomImageSize,
  validateSampler,
  validateScheduler
} from '../lib/validation';
import { getVideoWorkflowType, isVideoModel, VIDEO_WORKFLOW_ASSETS } from './utils';
import { ApiError } from '../ApiClient';

/**
 * Validate that the provided assets match the workflow requirements.
 * Throws an error if required assets are missing or forbidden assets are provided.
 */
function validateVideoWorkflowAssets(params: VideoProjectParams): void {
  const workflowType = getVideoWorkflowType(params.modelId);
  if (!workflowType) return;

  const requirements = VIDEO_WORKFLOW_ASSETS[workflowType];
  if (!requirements) return;
  // Check for missing required assets
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

function applyImageParams(inputKeyframe: Record<string, any>, params: ImageProjectParams) {
  const keyFrame: Record<string, any> = {
    ...inputKeyframe,
    scheduler: validateSampler(params.sampler),
    timeStepSpacing: validateScheduler(params.scheduler),
    sizePreset: params.sizePreset,
    hasContextImage1: !!params.contextImages?.[0],
    hasContextImage2: !!params.contextImages?.[1],
    hasContextImage3: !!params.contextImages?.[2]
  };

  if (params.startingImage) {
    keyFrame.hasStartingImage = true;
    keyFrame.strengthIsEnabled = true;
    keyFrame.strength = 1 - (Number(params.startingImageStrength) || 0.5);
  }

  if (params.controlNet) {
    keyFrame.currentControlNetsJob = getControlNet(params.controlNet);
  }
  if (params.sizePreset === 'custom') {
    keyFrame.width = validateCustomImageSize(params.width);
    keyFrame.height = validateCustomImageSize(params.height);
  }
  return keyFrame;
}

function applyVideoParams(inputKeyframe: Record<string, any>, params: VideoProjectParams) {
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
  if (params.referenceImageEnd) {
    keyFrame.hasReferenceImageEnd = true;
  }
  if (params.referenceAudio) {
    keyFrame.hasReferenceAudio = true;
  }
  if (params.referenceVideo) {
    keyFrame.hasReferenceVideo = true;
  }

  // Video generation parameters
  if (params.frames !== undefined) {
    keyFrame.frames = params.frames;
  }
  if (params.fps !== undefined) {
    keyFrame.fps = params.fps;
  }
  if (params.shift !== undefined) {
    keyFrame.shift = params.shift;
  }

  if (params.width && params.height) {
    keyFrame.width = params.width;
    keyFrame.height = params.height;
  }

  return keyFrame;
}

function createJobRequestMessage(id: string, params: ProjectParams) {
  const template = getTemplate();
  // Base keyFrame with common params
  let keyFrame: Record<string, any> = {
    ...template.keyFrames[0],
    steps: params.steps,
    guidanceScale: params.guidance,
    modelID: params.modelId,
    negativePrompt: params.negativePrompt,
    seed: params.seed,
    positivePrompt: params.positivePrompt,
    stylePrompt: params.stylePrompt
  };

  switch (params.type) {
    case 'image':
      keyFrame = applyImageParams(keyFrame, params);
      break;
    case 'video':
      keyFrame = applyVideoParams(keyFrame, params);
      break;
    default:
      throw new ApiError(400, {
        status: 'error',
        errorCode: 0,
        message: 'Invalid project type. Must be "image" or "video".'
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
    outputFormat: params.outputFormat || (isVideoParams(params) ? 'mp4' : 'png')
  };

  if (params.network) {
    jobRequest.network = params.network;
  }

  return jobRequest;
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;
