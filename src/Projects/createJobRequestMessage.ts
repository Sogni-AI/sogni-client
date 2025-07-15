import { ProjectParams } from './types';
import { ControlNetParams, ControlNetParamsRaw } from './types/ControlNetParams';
import { validateNumber, validateCustomImageSize } from '../lib/validation';
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
        scheduler: 'DPM Solver Multistep (DPM-Solver++)',
        timeStepSpacing: 'Linear',
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
  const jobRequest: Record<string, any> = {
    ...template,
    keyFrames: [
      {
        ...template.keyFrames[0],
        scheduler: params.scheduler || null,
        timeStepSpacing: params.timeStepSpacing || null,
        steps: params.steps,
        guidanceScale: params.guidance,
        modelID: params.modelId,
        negativePrompt: params.negativePrompt,
        seed: params.seed,
        positivePrompt: params.positivePrompt,
        stylePrompt: params.stylePrompt,
        hasStartingImage: !!params.startingImage,
        strengthIsEnabled: !!params.startingImage,
        strength: !!params.startingImage
          ? 1 - (Number(params.startingImageStrength) || 0.5)
          : undefined,
        sizePreset: params.sizePreset
      }
    ],
    previews: params.numberOfPreviews || 0,
    numberOfImages: params.numberOfImages,
    jobID: id,
    disableSafety: !!params.disableNSFWFilter,
    tokenType: params.tokenType
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
  }
  return jobRequest;
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;
