import {
  ProjectParams,
  isVideoModel,
  getVideoWorkflowType,
  VIDEO_WORKFLOW_ASSETS,
  VideoWorkflowType
} from './types';
import { ControlNetParams, ControlNetParamsRaw } from './types/ControlNetParams';
import {
  validateNumber,
  validateCustomImageSize,
  validateSampler,
  validateScheduler
} from '../lib/validation';

/**
 * Validate that the provided assets match the workflow requirements.
 * Throws an error if required assets are missing or forbidden assets are provided.
 */
function validateVideoWorkflowAssets(params: ProjectParams, workflowType: VideoWorkflowType): void {
  if (!workflowType) return;

  const requirements = VIDEO_WORKFLOW_ASSETS[workflowType];
  if (!requirements) return;

  const video = params.video;
  const assets = {
    referenceImage: !!video?.referenceImage,
    referenceImageEnd: !!video?.referenceImageEnd,
    referenceAudio: !!video?.referenceAudio,
    referenceVideo: !!video?.referenceVideo
  };

  // Check for missing required assets
  for (const [asset, requirement] of Object.entries(requirements)) {
    const assetKey = asset as keyof typeof assets;
    const hasAsset = assets[assetKey];

    if (requirement === 'required' && !hasAsset) {
      throw new Error(
        `${workflowType} workflow requires video.${assetKey}. Please provide this asset.`
      );
    }

    if (requirement === 'forbidden' && hasAsset) {
      throw new Error(
        `${workflowType} workflow does not support video.${assetKey}. Please remove this asset.`
      );
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

function createJobRequestMessage(id: string, params: ProjectParams) {
  const template = getTemplate();
  const isVideo = isVideoModel(params.modelId);
  const workflowType = getVideoWorkflowType(params.modelId);

  // Validate video workflow assets if this is a video model
  if (isVideo && workflowType) {
    validateVideoWorkflowAssets(params, workflowType);
  }

  // Base keyFrame with common params
  const keyFrame: Record<string, any> = {
    ...template.keyFrames[0],
    scheduler: validateSampler(params.sampler),
    timeStepSpacing: validateScheduler(params.scheduler),
    steps: params.steps,
    guidanceScale: params.guidance,
    modelID: params.modelId,
    negativePrompt: params.negativePrompt,
    seed: params.seed,
    positivePrompt: params.positivePrompt,
    stylePrompt: params.stylePrompt,
    sizePreset: params.sizePreset,
    hasContextImage1: !!params.contextImages?.[0],
    hasContextImage2: !!params.contextImages?.[1]
  };

  if (params.startingImage) {
    keyFrame.hasStartingImage = true;
    keyFrame.strengthIsEnabled = true;
    keyFrame.strength = 1 - (Number(params.startingImageStrength) || 0.5);
  }

  // VIDEO WORKFLOW FLAGS (WAN 2.2)
  // These are completely separate from startingImage
  if (isVideo && params.video) {
    const video = params.video;

    // Reference assets
    if (video.referenceImage) {
      keyFrame.hasReferenceImage = true;
    }
    if (video.referenceImageEnd) {
      keyFrame.hasReferenceImageEnd = true;
    }
    if (video.referenceAudio) {
      keyFrame.hasReferenceAudio = true;
    }
    if (video.referenceVideo) {
      keyFrame.hasReferenceVideo = true;
    }

    // Video generation parameters
    if (video.frames !== undefined) {
      keyFrame.frames = video.frames;
    }
    if (video.fps !== undefined) {
      keyFrame.fps = video.fps;
    }
    if (video.shift !== undefined) {
      keyFrame.shift = video.shift;
    }
  }

  const jobRequest: Record<string, any> = {
    ...template,
    keyFrames: [keyFrame],
    previews: params.numberOfPreviews || 0,
    numberOfImages: params.numberOfImages,
    jobID: id,
    disableSafety: !!params.disableNSFWFilter,
    tokenType: params.tokenType,
    outputFormat: params.outputFormat || (isVideo ? 'mp4' : 'png')
  };

  if (params.network) {
    jobRequest.network = params.network;
  }
  if (params.controlNet) {
    jobRequest.keyFrames[0].currentControlNetsJob = getControlNet(params.controlNet);
  }
  if (params.sizePreset === 'custom') {
    jobRequest.keyFrames[0].width = validateCustomImageSize(params.width);
    jobRequest.keyFrames[0].height = validateCustomImageSize(params.height);
  } else if (isVideo && params.width !== undefined && params.height !== undefined) {
    // For video models, allow width/height without requiring sizePreset='custom'
    jobRequest.keyFrames[0].width = params.width;
    jobRequest.keyFrames[0].height = params.height;
  }

  return jobRequest;
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;
