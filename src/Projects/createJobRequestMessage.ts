import { ProjectParams } from './types';
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

function validateSize(value: any): number {
  const size = Number(value);
  if (isNaN(size) || size < 256 || size > 2048) {
    throw new Error('Width and height must be numbers between 256 and 2048');
  }
  return size;
}

function createJobRequestMessage(id: string, params: ProjectParams) {
  const template = getTemplate();
  const jobRequest: Record<string, any> = {
    ...template,
    keyFrames: [
      {
        ...template.keyFrames[0],
        scheduler: params.scheduler,
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
    disableSafety: !!params.disableNSFWFilter
  };
  if (params.network) {
    jobRequest.network = params.network;
  }
  if (params.sizePreset === 'custom') {
    jobRequest.keyFrames[0].width = validateSize(params.width);
    jobRequest.keyFrames[0].height = validateSize(params.height);
  }
  return jobRequest;
}

export type JobRequestRaw = ReturnType<typeof createJobRequestMessage>;

export default createJobRequestMessage;
